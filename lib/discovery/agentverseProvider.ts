import type { AgentDiscoveryProvider, DiscoverableAgent } from "@/lib/discovery/types";

export class AgentverseProvider implements AgentDiscoveryProvider {
  readonly source = "agentverse";

  async discover(capability: string): Promise<DiscoverableAgent[]> {
    const apiKey = process.env.AGENTVERSE_API_KEY;
    if (!apiKey) {
      console.log("[Agentverse] API key missing. Skipping agent discovery.");
      return [];
    }

    try {
      console.log(`[Agentverse] Fetching agents from Agentverse for capability: ${capability}`);
      const response = await fetch("https://agentverse.ai/v2/agents", {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        console.error(`[Agentverse] API returned error: ${response.statusText}`);
        return [];
      }

      const data = await response.json();
      const agents: any[] = data.agents || [];

      return agents
        .map((a: any) => ({
          id: a.address || a.id,
          name: a.name || "Agentverse Agent",
          capabilities: Array.isArray(a.capabilities) ? a.capabilities : [capability],
          price: a.price ? Number(a.price) : 5, // Default/fallback price
          endpoint: a.endpoint || null,
          status: "ACTIVE" as const,
          reputation: 80,
          successRate: 0.9,
          avgQuality: 85,
          avgLatencyMs: 200,
          avgCost: a.price ? Number(a.price) : 5,
          totalJobs: 1,
        }))
        .filter((a) => a.capabilities.includes(capability));
    } catch (error) {
      console.error("[Agentverse Discovery Error]", error);
      return [];
    }
  }
}
