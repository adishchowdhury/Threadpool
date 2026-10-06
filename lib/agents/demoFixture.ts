import { db } from "@/lib/db/client";
import { ensureAgentWallet } from "@/lib/economy/wallets";

export const CIRCUIT_BREAKER_DEMO_AGENT_ID = "rogue-agent";

// Internal identity for the Circuit Breaker demo (CLAUDE.md §21). It is not a
// worker: it is unlisted (never shown in the registry), matches no planner
// capability (can never be discovered or hired), and is created on demand by
// the demo route. Status is reset to ACTIVE each time because a blocked
// attack may revoke it, and the next demo must start from a clean slate.
export async function ensureCircuitBreakerDemoAgent() {
  const listing = {
    name: "Rogue Agent",
    role: "Circuit Breaker demo fixture",
    capabilities: JSON.stringify(["unbounded_payment_request"]),
    price: 8,
    endpoint: null,
    status: "ACTIVE" as const,
    provider: "local",
    listed: false,
  };
  await db.agent.upsert({
    where: { id: CIRCUIT_BREAKER_DEMO_AGENT_ID },
    update: listing,
    create: { id: CIRCUIT_BREAKER_DEMO_AGENT_ID, ...listing },
  });
  await ensureAgentWallet(CIRCUIT_BREAKER_DEMO_AGENT_ID);
}
