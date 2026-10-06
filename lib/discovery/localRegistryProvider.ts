import { db } from "@/lib/db/client";
import type { AgentDiscoveryProvider, DiscoverableAgent } from "@/lib/discovery/types";

export class LocalRegistryProvider implements AgentDiscoveryProvider {
  readonly source = "local-registry";

  async discover(capability: string): Promise<DiscoverableAgent[]> {
    const agents = await db.agent.findMany({
      where: { status: "ACTIVE" },
    });

    return agents
      .map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role ?? null,
        capabilities: JSON.parse(a.capabilities) as string[],
        price: a.price,
        endpoint: a.endpoint,
        status: a.status,
        reputation: a.reputation,
        successRate: a.successRate,
        avgQuality: a.avgQuality,
        avgLatencyMs: a.avgLatencyMs,
        avgCost: a.avgCost,
        totalJobs: a.totalJobs,
        sampleCount: a.sampleCount ?? 0,
      }))
      .filter((a) => a.capabilities.includes(capability));
  }
}
