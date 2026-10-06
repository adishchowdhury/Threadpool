import { db } from "@/lib/db/client";
import { ensureSystemWallets, ensureAgentWallet } from "@/lib/economy/wallets";
import { ensureDemoUser } from "@/lib/db/demoUser";
import { ROSTER } from "@/lib/agents/roster";
import { CIRCUIT_BREAKER_DEMO_AGENT_ID } from "@/lib/agents/demoFixture";
import { refreshAgentStats } from "@/lib/agents/stats";

// Registers the roster listings. Agents carry no hand-written performance
// numbers: stats are derived from measured samples (calibration runs that
// survive resets, plus job history) via refreshAgentStats. An agent with no
// samples yet is simply unrated (sampleCount 0).
export async function seedRegistry() {
  await ensureDemoUser();
  await ensureSystemWallets();

  const listings = ROSTER;

  // Calibration is meaningless for agents no longer in the roster.
  await db.agentCalibration.deleteMany({ where: { agentId: { notIn: [...listings.map((l) => l.id), CIRCUIT_BREAKER_DEMO_AGENT_ID] } } });

  for (const a of listings) {
    const listing = {
      name: a.name,
      role: a.role,
      capabilities: JSON.stringify(a.capabilities),
      endpoint: null,
      status: "ACTIVE" as const,
      provider: "local",
      model: a.tier,
      systemPrompt: a.systemPrompt || null,
    };
    await db.agent.upsert({
      where: { id: a.id },
      update: listing,
      create: { id: a.id, ...listing, price: 0 },
    });
    await ensureAgentWallet(a.id);
    await refreshAgentStats(a.id);
  }

  // The roster is the source of truth for seeded agents: retire any seeded
  // agent that is no longer listed so it cannot be discovered or hired.
  await db.agent.updateMany({
    where: { provider: "local", listed: { not: false }, id: { notIn: listings.map((l) => l.id) } },
    data: { status: "INACTIVE" },
  });
}

// Wipes all task/economy/event state and reseeds a clean registry + system
// wallets - used by `/api/reset` for repeatable, resettable judge demos.
// Measured calibration is intentionally kept: it is data about the agents,
// not about any task, and re-measuring costs real model calls.
//
// External agents/providers are marketplace SUPPLY, not task-run state - a
// demo reset must not wipe a provider's registration, calibration or
// accumulated performance history, or the "performance persists across
// tasks and improves routing" story breaks on every reset. Only their
// task-scoped financial/run records (ledger, escrow, bids, subtasks,
// events) are wiped like everyone else's.
export async function resetDatabase() {
  const externalAgentIds = (await db.agent.findMany({ where: { isExternal: true } })).map((a) => a.id);

  await db.$transaction([
    db.agentLedger.deleteMany(),
    db.centralLedger.deleteMany(),
    db.agentEscrow.deleteMany(),
    db.centralEscrow.deleteMany(),
    db.bid.deleteMany(),
    db.agentPerformance.deleteMany({ where: { agentId: { notIn: externalAgentIds } } }),
    db.subtask.deleteMany(),
    db.securityEvent.deleteMany(),
    db.event.deleteMany(),
    db.task.deleteMany(),
    db.workflowMemory.deleteMany(),
    db.wallet.deleteMany({ where: { agentId: { notIn: externalAgentIds } } }),
    db.agent.deleteMany({ where: { isExternal: { not: true } } }),
  ]);

  await seedRegistry();
}
