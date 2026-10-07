import type { AgentVisibility } from "@/lib/discovery/access";

export interface DiscoverableAgent {
  id: string;
  name: string;
  role: string | null;
  capabilities: string[];
  price: number;
  endpoint: string | null;
  status: "ACTIVE" | "INACTIVE" | "REVOKED";
  reputation: number;
  successRate: number;
  avgQuality: number;
  avgLatencyMs: number;
  avgCost: number;
  totalJobs: number;
  // Measured samples behind the stat fields; 0 = unrated. When a
  // capability-specific AgentCapabilityStat row exists for the capability
  // this candidate was discovered for, these fields (and sampleCount) are
  // THAT row's numbers, not the agent-wide aggregate - see
  // localRegistryProvider.ts.
  sampleCount: number;
  isExternal: boolean;
  providerId: string | null;
  providerName: string | null;
  visibility?: AgentVisibility;
}

// Adapter-based agent marketplace. LocalRegistryProvider always works with
// zero external credentials; further providers plug in behind this interface.
export interface AgentDiscoveryProvider {
  readonly source: string;
  discover(capability: string): Promise<DiscoverableAgent[]>;
}
