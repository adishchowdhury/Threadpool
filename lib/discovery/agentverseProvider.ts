import type { AgentDiscoveryProvider, DiscoverableAgent } from "@/lib/discovery/types";

const SEARCH_URL = "https://agentverse.ai/v1/search/agents";

// Momentum's capability vocabulary (see lib/manager/planner.ts) mapped to a
// natural-language query for Agentverse's full-text agent search — there's
// no structured "capability" field on the marketplace side to filter by.
const CAPABILITY_SEARCH_TEXT: Record<string, string> = {
  market_research: "market research",
  financial_analysis: "financial analysis",
  data_extraction: "data extraction scraping",
  writing: "writing content",
  report_generation: "report generation",
  summarization: "summarization summarize",
  quality_verification: "quality assurance verification",
  review: "review critique",
};

interface AgentverseSearchAgent {
  address: string;
  name: string;
  description: string;
  readme: string;
  status: string;
  unresponsive: boolean;
  type: string;
  category: string;
  rating: number | null;
  total_interactions: number;
  recent_interactions: number;
  recent_success_rate: number | null;
}

// Prices a real Agentverse agent from the only trustworthy signals the
// marketplace actually exposes about it — rating and interaction volume.
// We deliberately do NOT invent a claimed underlying LLM for these (the
// search API doesn't disclose one); that would be fabricating data.
function priceFromMarketplaceSignals(agent: AgentverseSearchAgent): number {
  const rating = agent.rating ?? 2.5; // unrated -> treat as median
  const usageBoost = Math.min(2, Math.log10(Math.max(agent.total_interactions, 1)) - 1); // 0 at <=10 interactions, up to +2
  const raw = 2 + rating * 1.4 + Math.max(0, usageBoost);
  return Math.max(2, Math.min(12, Math.round(raw)));
}

function toReputation(agent: AgentverseSearchAgent): number {
  const rating = agent.rating ?? 2.5;
  return Math.round(Math.min(100, Math.max(30, (rating / 5) * 100)));
}

// Simple in-memory cache so a task with several subtasks sharing a
// capability (or repeated demo runs) doesn't re-hit the live search API on
// every single discover() call. Not persisted — fine for a dev/demo process.
const cache = new Map<string, { at: number; results: DiscoverableAgent[] }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export class AgentverseProvider implements AgentDiscoveryProvider {
  readonly source = "agentverse";

  async discover(capability: string): Promise<DiscoverableAgent[]> {
    const apiKey = process.env.AGENTVERSE_API_KEY;
    if (!apiKey) {
      console.log("[Agentverse] API key missing. Skipping agent discovery.");
      return [];
    }

    const cached = cache.get(capability);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.results;
    }

    const searchText = CAPABILITY_SEARCH_TEXT[capability];
    if (!searchText) {
      // Not one of Momentum's known capabilities — nothing sensible to search for.
      return [];
    }

    try {
      console.log(`[Agentverse] Searching live marketplace for capability: ${capability} ("${searchText}")`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(SEARCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          search_text: searchText,
          sort: "relevancy",
          direction: "desc",
          offset: 0,
          limit: 10,
          filters: { state: ["active"] },
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        console.error(`[Agentverse] Search API returned ${response.status}: ${response.statusText}`);
        return [];
      }

      const data = (await response.json()) as { agents: AgentverseSearchAgent[] };
      const agents = data.agents ?? [];

      const results: DiscoverableAgent[] = agents
        // Only agents that are actually reachable/responsive make usable candidates.
        .filter((a) => a.status === "active" && !a.unresponsive)
        .slice(0, 3)
        .map((a) => {
          const price = priceFromMarketplaceSignals(a);
          return {
            id: `agentverse:${a.address}`,
            name: a.name || "Agentverse Agent",
            capabilities: [capability],
            price,
            endpoint: a.address, // real Agentverse agent address, not an HTTP URL
            status: "ACTIVE" as const,
            reputation: toReputation(a),
            successRate: a.recent_success_rate ?? Math.min(0.97, Math.max(0.5, (a.rating ?? 2.5) / 5)),
            avgQuality: toReputation(a),
            avgLatencyMs: 15000, // Chat Protocol round-trip is inherently slower than a direct API call
            avgCost: price,
            totalJobs: a.total_interactions,
          };
        });

      cache.set(capability, { at: Date.now(), results });
      return results;
    } catch (error) {
      console.error("[Agentverse Discovery Error]", error);
      return [];
    }
  }
}
