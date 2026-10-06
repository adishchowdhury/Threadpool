import type { AgentDiscoveryProvider, DiscoverableAgent } from "@/lib/discovery/types";
import { LocalRegistryProvider } from "@/lib/discovery/localRegistryProvider";

const local = new LocalRegistryProvider();

// Discovery runs against the local seeded registry (Sarvam-backed agents).
// Add further providers here behind the AgentDiscoveryProvider interface.
export async function discoverAgents(capability: string): Promise<DiscoverableAgent[]> {
  return local.discover(capability);
}

export type { AgentDiscoveryProvider, DiscoverableAgent };
