import { db } from "@/lib/db/client";
import { resolveSessionUser } from "@/lib/auth/session";
import { resolveOrCreatePersonalOrg } from "@/lib/auth/rbac";
import { canViewAgent, effectiveVisibility } from "@/lib/discovery/access";
import { withoutExternalSecret } from "@/lib/agents/secrets";

// Registry listing for the caller: Kraven-certified + published marketplace
// agents + the caller's own organization's private agents. Another org's
// private agents are never returned. An unauthenticated caller (Firebase
// configured, no valid token) sees only the public classes.
export async function listAgentsVisibleTo(request: Request) {
  const session = await resolveSessionUser(request);
  const organizationId = "error" in session ? null : await resolveOrCreatePersonalOrg(session.user);

  const all = await db.agent.findMany({ where: { listed: { not: false } }, orderBy: { name: "asc" } });
  const agents = all.filter((a) => canViewAgent(a, organizationId));

  const providerIds = [...new Set(agents.map((a) => a.providerId).filter((id): id is string => Boolean(id)))];
  const providers = providerIds.length ? await db.agentProvider.findMany({ where: { id: { in: providerIds } } }) : [];
  const providerNameById = new Map(providers.map((p) => [p.id, p.name]));

  return agents.map((a) => ({
    ...withoutExternalSecret(a),
    // Resolve legacy null rows so clients always see CERTIFIED / PRIVATE / MARKETPLACE.
    visibility: effectiveVisibility(a),
    capabilities: JSON.parse(a.capabilities),
    providerName: a.providerId ? providerNameById.get(a.providerId) ?? null : null,
  }));
}
