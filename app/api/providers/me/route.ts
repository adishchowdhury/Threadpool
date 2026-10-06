import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { resolveSessionUser } from "@/lib/auth/session";
import { withoutExternalSecret } from "@/lib/agents/secrets";

export async function GET(request: Request) {
  const session = await resolveSessionUser(request);
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });

  const provider = await db.agentProvider.findFirst({ where: { ownerUserId: session.user.userId } });
  if (!provider) return NextResponse.json({ error: "You haven't created an organization yet." }, { status: 404 });

  const agents = await db.agent.findMany({ where: { providerId: provider.id } });
  const agentIds = agents.map((a) => a.id);
  const jobs = agentIds.length ? await db.agentPerformance.findMany({ where: { agentId: { in: agentIds } } }) : [];

  return NextResponse.json({
    provider,
    overview: {
      agents: agents.length,
      activeAgents: agents.filter((a) => a.status === "ACTIVE").length,
      tasksCompleted: jobs.length,
      successRate: jobs.length ? jobs.filter((j) => j.success).length / jobs.length : null,
      avgQaScore: jobs.length ? jobs.reduce((s, j) => s + j.qaScore, 0) / jobs.length : null,
      totalEarned: agents.reduce((s, a) => s + a.totalJobs * a.avgCost, 0),
    },
    agents: agents.map((a) => ({ ...withoutExternalSecret(a), capabilities: JSON.parse(a.capabilities) })),
  });
}

export async function PATCH(request: Request) {
  const session = await resolveSessionUser(request);
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });

  const provider = await db.agentProvider.findFirst({ where: { ownerUserId: session.user.userId } });
  if (!provider) return NextResponse.json({ error: "You haven't created an organization yet." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
  if (typeof body.description === "string") update.description = body.description;

  const updated = await db.agentProvider.update({ where: { id: provider.id }, data: update });
  return NextResponse.json({ provider: updated });
}
