import { db } from "@/lib/db/client";
import { priceFromUsage } from "@/lib/agents/pricing";

// Single deterministic source for an agent's measured stats. Samples come
// from two places - benchmark calibration runs and real task executions -
// and both feed the same averages so the registry reflects everything we
// have actually observed about the agent. Nothing here is written by an LLM
// or by hand.
export async function refreshAgentStats(agentId: string) {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) return null;

  const [jobs, calibrations] = await Promise.all([
    db.agentPerformance.findMany({ where: { agentId } }),
    db.agentCalibration.findMany({ where: { agentId } }),
  ]);

  const samples = [
    ...jobs.map((j) => ({ qa: j.qaScore, latencyMs: j.actualLatencyMs, cost: j.actualCost, success: j.success })),
    // A calibration run is billed at the agent's listed price, same as a job.
    ...calibrations.map((c) => ({ qa: c.qaScore, latencyMs: c.latencyMs, cost: agent.price, success: c.passed })),
  ];
  // Price follows measured token usage; keep the current price until there is any.
  const price = priceFromUsage(calibrations) ?? agent.price;

  const n = samples.length;
  const mean = (f: (s: (typeof samples)[number]) => number) => (n > 0 ? samples.reduce((a, s) => a + f(s), 0) / n : 0);

  const successCount = samples.filter((s) => s.success).length;
  const successRate = n > 0 ? successCount / n : 0;
  const avgQuality = mean((s) => s.qa);
  const avgLatencyMs = mean((s) => s.latencyMs);
  const avgCost = n > 0 ? mean((s) => s.cost) : price;
  // Reputation: weighted blend of success rate and average quality, 0-100.
  const reputation = n > 0 ? Math.round(successRate * 50 + (avgQuality / 100) * 50) : 0;

  await db.agent.update({
    where: { id: agentId },
    data: { price, totalJobs: jobs.length, successCount, sampleCount: n, successRate, avgQuality, avgLatencyMs, avgCost, reputation },
  });

  return { sampleCount: n, successRate, avgQuality, avgLatencyMs, avgCost, reputation };
}
