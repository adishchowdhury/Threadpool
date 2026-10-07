import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { resolveSessionUser } from "@/lib/auth/session";
import { resolveOrCreatePersonalOrg } from "@/lib/auth/rbac";
import { canViewAgent } from "@/lib/discovery/access";
import { arenaRank, type ArenaDimension } from "@/lib/agents/profile";

const DIMENSIONS: ArenaDimension[] = ["quality", "reliability", "speed", "value"];

// Per-capability comparison of the agents the caller may see, using only
// measured per-capability stats. The point is fit-for-purpose ("fastest",
// "best value", "most reliable"), not one global leaderboard.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const capability = url.searchParams.get("capability");
  if (!capability) return NextResponse.json({ error: "capability is required" }, { status: 400 });

  const session = await resolveSessionUser(request);
  const organizationId = "error" in session ? null : await resolveOrCreatePersonalOrg(session.user);

  const agents = (await db.agent.findMany({ where: { listed: { not: false }, status: "ACTIVE" } })).filter(
    (a) => (JSON.parse(a.capabilities) as string[]).includes(capability) && canViewAgent(a, organizationId),
  );
  const stats = agents.length ? await db.agentCapabilityStat.findMany({ where: { agentId: { in: agents.map((a) => a.id) }, capability } }) : [];
  const statById = new Map(stats.map((s) => [s.agentId, s]));
  const entries = agents.map((a) => {
    const s = statById.get(a.id);
    return { agentId: a.id, name: a.name, samples: s?.sampleCount ?? 0, avgQuality: s?.avgQuality ?? 0, successRate: s?.successRate ?? 0, medianLatencyMs: s?.avgLatencyMs ?? 0, price: a.price };
  });

  return NextResponse.json({
    capability,
    unmeasured: entries.filter((e) => e.samples === 0).map((e) => e.name),
    rankings: Object.fromEntries(DIMENSIONS.map((d) => [d, arenaRank(entries, d)])),
  });
}
