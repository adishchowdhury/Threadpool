import { db } from "@/lib/db/client";
import { priceFromUsage } from "@/lib/agents/pricing";

// Single deterministic source for an agent's measured stats. Samples come
// from two places - benchmark calibration runs and real task executions -
// and both feed the same averages so the registry reflects everything we
// have actually observed about the agent. Nothing here is written by an LLM
// or by hand.
type Sample = { capability: string | null; qa: number; latencyMs: number; cost: number; success: boolean };

function aggregate(samples: Sample[], fallbackCost: number) {
  const n = samples.length;
  const mean = (f: (s: Sample) => number) => (n > 0 ? samples.reduce((a, s) => a + f(s), 0) / n : 0);
  const successCount = samples.filter((s) => s.success).length;
  const successRate = n > 0 ? successCount / n : 0;
  const avgQuality = mean((s) => s.qa);
  const avgLatencyMs = mean((s) => s.latencyMs);
  const avgCost = n > 0 ? mean((s) => s.cost) : fallbackCost;
  // Reputation: weighted blend of success rate and average quality, 0-100.
  const reputation = n > 0 ? Math.round(successRate * 50 + (avgQuality / 100) * 50) : 0;
  return { sampleCount: n, successCount, successRate, avgQuality, avgLatencyMs, avgCost, reputation };
}

// Single deterministic source for an agent's measured stats - both the
// agent-level aggregate (used as the cold-start prior) AND a per-capability
// breakdown (lib/db/models.ts's AgentCapabilityStat), from the exact same
// underlying samples. AgentPerformance/AgentCalibration rows already carry
// exactly one capability each, so this is a strict superset of the old
// agent-only aggregate - an agent excellent at one capability and mediocre
// at another is no longer blended into a single misleading number.
export async function refreshAgentStats(agentId: string) {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) return null;

  const [jobs, calibrations] = await Promise.all([
    db.agentPerformance.findMany({ where: { agentId } }),
    db.agentCalibration.findMany({ where: { agentId } }),
  ]);

  const samples: Sample[] = [
    ...jobs.map((j) => ({
      capability: (JSON.parse(j.capabilities) as string[])[0] ?? null,
      qa: j.qaScore,
      latencyMs: j.actualLatencyMs,
      cost: j.actualCost,
      success: j.success,
    })),
    // A calibration run is billed at the agent's listed price, same as a job.
    ...calibrations.map((c) => ({ capability: c.capability, qa: c.qaScore, latencyMs: c.latencyMs, cost: agent.price, success: c.passed })),
  ];
  // Price follows measured token usage for Kraven-run (Sarvam) agents only -
  // an external agent's price is the provider's own declared ask.
  const price = agent.isExternal ? agent.price : priceFromUsage(calibrations) ?? agent.price;

  const overall = aggregate(samples, price);

  await db.agent.update({
    where: { id: agentId },
    data: {
      price,
      totalJobs: jobs.length,
      successCount: overall.successCount,
      sampleCount: overall.sampleCount,
      successRate: overall.successRate,
      avgQuality: overall.avgQuality,
      avgLatencyMs: overall.avgLatencyMs,
      avgCost: overall.avgCost,
      reputation: overall.reputation,
    },
  });

  const byCapability = new Map<string, Sample[]>();
  for (const s of samples) {
    if (!s.capability) continue;
    if (!byCapability.has(s.capability)) byCapability.set(s.capability, []);
    byCapability.get(s.capability)!.push(s);
  }
  for (const [capability, capSamples] of byCapability) {
    const stat = aggregate(capSamples, price);
    await db.agentCapabilityStat.upsert({
      where: { agentId, capability },
      update: {
        sampleCount: stat.sampleCount,
        successRate: stat.successRate,
        avgQuality: stat.avgQuality,
        avgLatencyMs: stat.avgLatencyMs,
        avgCost: stat.avgCost,
        reputation: stat.reputation,
      },
      create: {
        agentId,
        capability,
        sampleCount: stat.sampleCount,
        successRate: stat.successRate,
        avgQuality: stat.avgQuality,
        avgLatencyMs: stat.avgLatencyMs,
        avgCost: stat.avgCost,
        reputation: stat.reputation,
      },
    });
  }

  return { sampleCount: overall.sampleCount, successRate: overall.successRate, avgQuality: overall.avgQuality, avgLatencyMs: overall.avgLatencyMs, avgCost: overall.avgCost, reputation: overall.reputation };
}
