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
  // Measured samples behind the stat fields; 0 = unrated.
  sampleCount: number;
}

// Adapter-based agent marketplace. LocalRegistryProvider always works with
// zero external credentials; further providers plug in behind this interface.
export interface AgentDiscoveryProvider {
  readonly source: string;
  discover(capability: string): Promise<DiscoverableAgent[]>;
}
