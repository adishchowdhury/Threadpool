import type { AgentDiscoveryProvider, DiscoverableAgent } from "@/lib/discovery/types";

// P1 stub. Pluggable external marketplace adapter — wire a real HTTP client
// here when an external agent marketplace API key is available. Until then
// discover() returns empty so callers fall back to LocalRegistryProvider.
export class ExternalMarketplaceProvider implements AgentDiscoveryProvider {
  readonly source = "external-marketplace";

  async discover(_capability: string): Promise<DiscoverableAgent[]> {
    if (!process.env.EXTERNAL_MARKETPLACE_API_KEY) return [];
    // TODO(P1): call the real external marketplace API and map its
    // response into DiscoverableAgent[].
    return [];
  }
}
