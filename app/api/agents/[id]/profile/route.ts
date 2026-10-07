import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { resolveSessionUser } from "@/lib/auth/session";
import { resolveOrCreatePersonalOrg } from "@/lib/auth/rbac";
import { canViewAgent } from "@/lib/discovery/access";
import { qualityTrend, summarize, summarizeBy, summarizeRatings, strengthsAndWeaknesses, type RawSample, type TimedSample } from "@/lib/agents/profile";

// Multidimensional agent profile with the four sources of truth kept apart.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await resolveSessionUser(request);
  const organizationId = "error" in session ? null : await resolveOrCreatePersonalOrg(session.user);

  const agent = await db.agent.findUnique({ where: { id } });
  // Same 404 for "missing" and "not yours" - no existence leak.
  if (!agent || agent.listed === false || !canViewAgent(agent, organizationId)) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const [calibrations, jobs, ratings] = await Promise.all([
    db.agentCalibration.findMany({ where: { agentId: id } }),
    db.agentPerformance.findMany({ where: { agentId: id } }),
    db.agentRating.findMany({ where: { agentId: id } }),
  ]);

  const benchmark: RawSample[] = calibrations.map((c) => ({ capability: c.capability, qa: c.qaScore, latencyMs: c.latencyMs, cost: null, success: c.passed }));
  const production: RawSample[] = jobs.map((j) => ({
    capability: (JSON.parse(j.capabilities) as string[])[0] ?? "unknown",
    qa: j.qaScore,
    latencyMs: j.actualLatencyMs,
    cost: j.actualCost,
    success: j.success,
    domain: j.domain,
  }));

  const timed: TimedSample[] = [
    ...calibrations.map((c) => ({ capability: c.capability, qa: c.qaScore, latencyMs: c.latencyMs, cost: null, success: c.passed, at: new Date(c.createdAt).getTime(), source: "benchmark" as const })),
    ...jobs.map((j) => ({
      capability: (JSON.parse(j.capabilities) as string[])[0] ?? "unknown",
      qa: j.qaScore,
      latencyMs: j.actualLatencyMs,
      cost: j.actualCost,
      success: j.success,
      domain: j.domain,
      at: new Date(j.createdAt).getTime(),
      source: "production" as const,
    })),
  ].sort((a, b) => a.at - b.at);
  const point = (t: TimedSample) => ({ at: t.at, source: t.source, capability: t.capability, qa: t.qa, success: t.success });

  const productionOverall = summarize(production);
  const productionByDomain = summarizeBy(production, "domain");
  return NextResponse.json({
    agent: { id: agent.id, name: agent.name, visibility: agent.visibility ?? (agent.isExternal ? "PRIVATE" : "CERTIFIED") },
    benchmark: { source: "Kraven benchmark", overall: summarize(benchmark), byCapability: summarizeBy(benchmark, "capability") },
    production: {
      source: "Production tasks",
      overall: productionOverall,
      byCapability: summarizeBy(production, "capability"),
      byDomain: productionByDomain,
      ...strengthsAndWeaknesses(productionOverall, productionByDomain),
    },
    improvement: {
      trend: qualityTrend(timed),
      timeline: timed.slice(-40).map(point), // oldest -> newest, capped, for the chart
      recent: [...timed].reverse().slice(0, 8).map(point),
    },
    userRatings: { source: "Ratings from organizations that used this agent", ...summarizeRatings(ratings.map((r) => r.rating)) },
    developerClaims: { source: "Provider-declared (unverified)", description: agent.role, capabilities: JSON.parse(agent.capabilities), price: agent.price },
  });
}
