import { effectiveVisibility } from "@/lib/discovery/access";
import { db } from "@/lib/db/client";
import type { AgentDiscoveryProvider, DiscoverableAgent } from "@/lib/discovery/types";

export class LocalRegistryProvider implements AgentDiscoveryProvider {
  readonly source = "local-registry";

  async discover(capability: string): Promise<DiscoverableAgent[]> {
    const agents = await db.agent.findMany({
      where: { status: "ACTIVE" },
    });

    const matched = agents
      .map((a) => ({ agent: a, capabilities: JSON.parse(a.capabilities) as string[] }))
      .filter((a) => a.capabilities.includes(capability));

    const providerIds = [...new Set(matched.map((a) => a.agent.providerId).filter((id): id is string => Boolean(id)))];
    const providers = providerIds.length
      ? await db.agentProvider.findMany({ where: { id: { in: providerIds } } })
      : [];
    const providerNameById = new Map(providers.map((p) => [p.id, p.name]));

    // Capability-specific stats (lib/agents/stats.ts) override the agent-wide
    // aggregate when there's measured data for THIS capability - an agent
    // great at one capability and mediocre at another should be scored on the
    // capability actually being hired for, not a blended number. Agents with
    // no capability-specific rows yet fall back to the agent aggregate, which
    // doubles as the cold-start prior scoring.ts already shrinks toward.
    const agentIds = matched.map((a) => a.agent.id);
    const capStats = agentIds.length
      ? await db.agentCapabilityStat.findMany({ where: { agentId: { in: agentIds }, capability } })
      : [];
    const capStatByAgentId = new Map(capStats.filter((s) => s.sampleCount > 0).map((s) => [s.agentId, s]));

    return matched.map(({ agent: a, capabilities }) => {
      const cap = capStatByAgentId.get(a.id);
      return {
        id: a.id,
        name: a.name,
        role: a.role ?? null,
        capabilities,
        price: a.price,
        endpoint: a.endpoint,
        status: a.status,
        reputation: cap?.reputation ?? a.reputation,
        successRate: cap?.successRate ?? a.successRate,
        avgQuality: cap?.avgQuality ?? a.avgQuality,
        avgLatencyMs: cap?.avgLatencyMs ?? a.avgLatencyMs,
        avgCost: cap?.avgCost ?? a.avgCost,
        totalJobs: a.totalJobs,
        sampleCount: cap?.sampleCount ?? a.sampleCount ?? 0,
        isExternal: a.isExternal ?? false,
        providerId: a.providerId ?? null,
        visibility: effectiveVisibility(a),
        providerName: a.providerId ? providerNameById.get(a.providerId) ?? null : null,
      };
    });
  }
}
