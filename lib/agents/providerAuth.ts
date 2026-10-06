import { db } from "@/lib/db/client";
import { resolveSessionUser } from "@/lib/auth/session";

export interface AuthedProvider {
  id: string;
  name: string;
  status: string;
  ownerUserId: string;
}

// Resolves the signed-in user (lib/auth/session.ts) and loads their org. 404s
// (not 401) when the user is legitimately authenticated but hasn't created
// an org yet - the UI uses that to show the "create your organization" form.
export async function requireProviderForUser(request: Request): Promise<{ provider: AuthedProvider } | { error: string; status: number }> {
  const session = await resolveSessionUser(request);
  if ("error" in session) return session;

  const provider = await db.agentProvider.findFirst({ where: { ownerUserId: session.user.userId } });
  if (!provider) return { error: "You haven't created an organization yet.", status: 404 };
  if (provider.status !== "ACTIVE") return { error: `Your organization is ${provider.status.toLowerCase()}`, status: 403 };

  return { provider: { id: provider.id, name: provider.name, status: provider.status, ownerUserId: provider.ownerUserId } };
}

// Loads an agent and 403s if it doesn't belong to this provider - so one
// org can never read/modify another's agent, secrets included.
export async function requireOwnedAgent(
  providerId: string,
  agentId: string,
): Promise<{ agent: Awaited<ReturnType<typeof db.agent.findUnique>> } | { error: string; status: number }> {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent || !agent.isExternal) return { error: "Agent not found", status: 404 };
  if (agent.providerId !== providerId) return { error: "You do not own this agent", status: 403 };
  return { agent };
}
