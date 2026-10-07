import type { AgentDiscoveryProvider, DiscoverableAgent } from "@/lib/discovery/types";
import { LocalRegistryProvider } from "@/lib/discovery/localRegistryProvider";
import { partitionByAccess, type AccessScope } from "@/lib/discovery/access";

const local = new LocalRegistryProvider();

export interface DiscoveryResult {
  agents: DiscoverableAgent[];
  // Capability matches before tenant/data-sensitivity access control.
  matched: number;
  excluded: { notVisible: number; dataSensitivity: number };
}

// Discovery runs against the local seeded registry (Sarvam-backed agents)
// plus organization-registered agents, then applies tenant isolation and the
// task's data-sensitivity rules BEFORE any agent reaches filtering/ranking.
// Add further providers here behind the AgentDiscoveryProvider interface.
export async function discoverAgents(capability: string, scope: AccessScope): Promise<DiscoveryResult> {
  const found = await local.discover(capability);
  const { accessible, excluded } = partitionByAccess(found, scope);
  return { agents: accessible, matched: found.length, excluded };
}

export type { AgentDiscoveryProvider, DiscoverableAgent };
