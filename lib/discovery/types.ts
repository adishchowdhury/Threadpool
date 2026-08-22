export interface DiscoverableAgent {
  id: string;
  name: string;
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
}

// Adapter-based agent marketplace. LocalRegistryProvider always works with
// zero external credentials; ExternalMarketplaceProvider is a pluggable
// stub that degrades to Local when no API credentials are configured.
export interface AgentDiscoveryProvider {
  readonly source: string;
  discover(capability: string): Promise<DiscoverableAgent[]>;
}
