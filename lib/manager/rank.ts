import type { DiscoverableAgent } from "@/lib/discovery/types";
import { prisma } from "@/lib/prisma";

const WEIGHTS = {
  capabilityMatch: 0.3,
  quality: 0.2,
  successRate: 0.15,
  reputation: 0.1,
  latencyEfficiency: 0.1,
  costEfficiency: 0.1,
  historicalSimilarity: 0.05,
} as const;

export interface RankedCandidate {
  agent: DiscoverableAgent;
  bidAmount: number;
  scoreBreakdown: {
    capabilityMatch: number;
    quality: number;
    successRate: number;
    reputation: number;
    latencyEfficiency: number;
    costEfficiency: number;
    historicalSimilarity: number;
  };
  totalScore: number;
  explanation: string;
}

function normalizeInverse(value: number, min: number, max: number): number {
  if (max === min) return 100;
  return 100 * (1 - (value - min) / (max - min));
}

// Deterministic scoring function. Gemini may have proposed which capability
// is needed; this comparison — and the resulting selection — is pure math
// over numbers already stored in the DB.
export async function rankCandidates(params: {
  candidates: DiscoverableAgent[];
  bids: Map<string, number>; // agentId -> bid amount
  requiredCapability: string;
  taskType: string;
}): Promise<RankedCandidate[]> {
  const { candidates, bids, requiredCapability, taskType } = params;
  if (candidates.length === 0) return [];

  const latencies = candidates.map((a) => a.avgLatencyMs || 1);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);

  const costs = candidates.map((a) => bids.get(a.id) ?? a.price);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);

  // Historical similarity: how much prior successful experience this agent
  // has specifically with this task type — deterministic ratio, not a model.
  const historyCounts = await Promise.all(
    candidates.map(async (a) => {
      const [total, success] = await Promise.all([
        prisma.agentPerformance.count({ where: { agentId: a.id, taskType } }),
        prisma.agentPerformance.count({ where: { agentId: a.id, taskType, success: true } }),
      ]);
      return total > 0 ? (success / total) * 100 : 30; // neutral-low prior for no history
    }),
  );

  const ranked: RankedCandidate[] = candidates.map((agent, i) => {
    const bidAmount = bids.get(agent.id) ?? agent.price;
    const capabilityMatch = agent.capabilities.includes(requiredCapability) ? 100 : 0;
    const quality = agent.avgQuality;
    const successRate = agent.successRate * 100;
    const reputation = agent.reputation;
    const latencyEfficiency = normalizeInverse(agent.avgLatencyMs || 1, minLatency, maxLatency);
    const costEfficiency = normalizeInverse(bidAmount, minCost, maxCost);
    const historicalSimilarity = historyCounts[i];

    const totalScore =
      capabilityMatch * WEIGHTS.capabilityMatch +
      quality * WEIGHTS.quality +
      successRate * WEIGHTS.successRate +
      reputation * WEIGHTS.reputation +
      latencyEfficiency * WEIGHTS.latencyEfficiency +
      costEfficiency * WEIGHTS.costEfficiency +
      historicalSimilarity * WEIGHTS.historicalSimilarity;

    const explanation =
      `Selected ${agent.name} because: ` +
      `Capability match: ${capabilityMatch.toFixed(0)}%, ` +
      `Quality: ${quality.toFixed(0)}, ` +
      `Success rate: ${successRate.toFixed(0)}%, ` +
      `Cost: ${bidAmount} tokens, ` +
      `Latency: ${(agent.avgLatencyMs / 1000).toFixed(0)}s`;

    return {
      agent,
      bidAmount,
      scoreBreakdown: { capabilityMatch, quality, successRate, reputation, latencyEfficiency, costEfficiency, historicalSimilarity },
      totalScore: Math.round(totalScore * 100) / 100,
      explanation,
    };
  });

  return ranked.sort((a, b) => b.totalScore - a.totalScore);
}
