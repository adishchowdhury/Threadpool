import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { requireProviderForUser, requireOwnedAgent } from "@/lib/agents/providerAuth";

// §27: provider-facing performance history, reusing AgentPerformance (no new
// observability table - every execution, built-in or external, already
// lands there via lib/economy/reputation.ts).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProviderForUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const owned = await requireOwnedAgent(auth.provider.id, id);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const jobs = await db.agentPerformance.findMany({ where: { agentId: id, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
  const capStats = await db.agentCapabilityStat.findMany({ where: { agentId: id } });

  const n = jobs.length;
  return NextResponse.json({
    last30Days: {
      tasksCompleted: n,
      successRate: n ? jobs.filter((j) => j.success).length / n : null,
      avgQaScore: n ? jobs.reduce((s, j) => s + j.qaScore, 0) / n : null,
      avgLatencyMs: n ? jobs.reduce((s, j) => s + j.actualLatencyMs, 0) / n : null,
      avgCost: n ? jobs.reduce((s, j) => s + j.actualCost, 0) / n : null,
      qaFailures: jobs.filter((j) => !j.success).length,
    },
    byCapability: capStats,
    recent: jobs.slice(0, 20),
  });
}
