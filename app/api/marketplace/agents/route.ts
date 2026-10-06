import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { withoutExternalSecret } from "@/lib/agents/secrets";

// §21/§30: public discovery - the same fields GET /api/agents already
// exposes (built-in + external, never secrets), extended with provider name
// and lifecycle status so the UI can show "External · {provider}".
export async function GET() {
  const agents = await db.agent.findMany({ where: { listed: { not: false } }, orderBy: { name: "asc" } });
  const providerIds = [...new Set(agents.map((a) => a.providerId).filter((id): id is string => Boolean(id)))];
  const providers = providerIds.length ? await db.agentProvider.findMany({ where: { id: { in: providerIds } } }) : [];
  const providerNameById = new Map(providers.map((p) => [p.id, p.name]));

  return NextResponse.json({
    agents: agents.map((a) => ({
      ...withoutExternalSecret(a),
      capabilities: JSON.parse(a.capabilities),
      providerName: a.providerId ? providerNameById.get(a.providerId) ?? null : null,
    })),
  });
}
