import { prisma } from "@/lib/prisma";
import type { AgentDiscoveryProvider, DiscoverableAgent } from "@/lib/discovery/types";

export class LocalRegistryProvider implements AgentDiscoveryProvider {
  readonly source = "local-registry";

  async discover(capability: string): Promise<DiscoverableAgent[]> {
    const agents = await prisma.agent.findMany({
      where: { status: { not: "REVOKED" } },
    });

    return agents
      .map((a) => ({
        id: a.id,
        name: a.name,
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
      }))
      .filter((a) => a.capabilities.includes(capability));
  }
}
