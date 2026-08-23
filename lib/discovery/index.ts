import { prisma } from "@/lib/prisma";
import { ensureAgentWallet } from "@/lib/economy/wallets";
import type { AgentDiscoveryProvider, DiscoverableAgent } from "@/lib/discovery/types";
import { LocalRegistryProvider } from "@/lib/discovery/localRegistryProvider";
import { ExternalMarketplaceProvider } from "@/lib/discovery/externalMarketplaceProvider";
import { AgentverseProvider } from "@/lib/discovery/agentverseProvider";

const local = new LocalRegistryProvider();
const external = new ExternalMarketplaceProvider();
const agentverse = new AgentverseProvider();

// Every downstream step (escrow, ledger, reputation) references agents by
// their row id in the `agent` table — so a candidate sourced from a live
// external provider (Agentverse, generic marketplace) has to exist there
// before it can be ranked/selected, not only once it's actually chosen.
// This upserts it in, keyed by the same id the provider already assigned,
// with a real wallet, so it's usable exactly like a locally-seeded agent.
async function syncExternalAgentToRegistry(agent: DiscoverableAgent, provider: string) {
  await prisma.agent.upsert({
    where: { id: agent.id },
    update: {
      name: agent.name,
      capabilities: JSON.stringify(agent.capabilities),
      price: agent.price,
      endpoint: agent.endpoint,
      status: agent.status,
      provider,
    },
    create: {
      id: agent.id,
      name: agent.name,
      capabilities: JSON.stringify(agent.capabilities),
      price: agent.price,
      endpoint: agent.endpoint,
      status: agent.status,
      provider,
      reputation: agent.reputation,
      successRate: agent.successRate,
      avgQuality: agent.avgQuality,
      avgLatencyMs: agent.avgLatencyMs,
      avgCost: agent.avgCost,
      totalJobs: agent.totalJobs,
    },
  });
  await ensureAgentWallet(agent.id);
}

// Aggregates all discovery providers, Agentverse first (per Kraven's
// "real marketplace is the first choice, local Gemini roster is the
// fallback" policy — see lib/manager/worker.ts for the execution-side half
// of that policy). The local seeded registry always participates so the
// system works with zero external credentials.
export async function discoverAgents(capability: string): Promise<DiscoverableAgent[]> {
  const [agentverseResults, externalResults, localResults] = await Promise.all([
    agentverse.discover(capability).catch(() => [] as DiscoverableAgent[]),
    external.discover(capability).catch(() => [] as DiscoverableAgent[]),
    local.discover(capability),
  ]);

  await Promise.all([
    ...agentverseResults.map((a) => syncExternalAgentToRegistry(a, "agentverse")),
    ...externalResults.map((a) => syncExternalAgentToRegistry(a, "external")),
  ]);

  const seen = new Set<string>();
  const merged: DiscoverableAgent[] = [];
  for (const a of [...agentverseResults, ...externalResults, ...localResults]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    merged.push(a);
  }
  return merged;
}

export type { AgentDiscoveryProvider, DiscoverableAgent };
