import type { AgentDiscoveryProvider, DiscoverableAgent } from "@/lib/discovery/types";
import { LocalRegistryProvider } from "@/lib/discovery/localRegistryProvider";
import { ExternalMarketplaceProvider } from "@/lib/discovery/externalMarketplaceProvider";
import { AgentverseProvider } from "@/lib/discovery/agentverseProvider";

const local = new LocalRegistryProvider();
const external = new ExternalMarketplaceProvider();
const agentverse = new AgentverseProvider();

// Aggregates all discovery providers. External results are included when
// available (e.g. a real marketplace key is set); the local seeded registry
// always participates so the system works with zero external credentials.
export async function discoverAgents(capability: string): Promise<DiscoverableAgent[]> {
  const [localResults, externalResults, agentverseResults] = await Promise.all([
    local.discover(capability),
    external.discover(capability).catch(() => [] as DiscoverableAgent[]),
    agentverse.discover(capability).catch(() => [] as DiscoverableAgent[]),
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
