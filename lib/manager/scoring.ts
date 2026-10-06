import type { DiscoverableAgent } from "@/lib/discovery/types";

// Pure (no DB, no server imports) deterministic scoring, shared by the
// server-side router (rank.ts) and the marketplace panel so both always show
// the same number for the same inputs.

export const WEIGHTS = {
  capabilityMatch: 0.3,
  quality: 0.2,
  successRate: 0.15,
  reputation: 0.1,
  latencyEfficiency: 0.1,
  costEfficiency: 0.1,
  historicalSimilarity: 0.05,
} as const;

// historicalSimilarity for an agent with no recorded history on a task type.
export const NO_HISTORY_SCORE = 30;

// Cold-start handling. An agent's stats are only as trustworthy as the number
// of measured samples behind them, so each stat is shrunk toward a prior in
// proportion to how little we know: effective = (n*observed + K*prior)/(n+K).
// The prior is the mean of the agents in this pool that HAVE been measured;
// when nobody has been measured yet it is the uninformative midpoint, so no
// agent gets a head start from numbers nobody observed.
const PRIOR_STRENGTH = 1; // K: pseudo-samples worth of belief in the prior (one measurement already outweighs it ~50/50)
const UNINFORMATIVE_PRIOR = { quality: 50, successRate: 50, reputation: 50 };

type Stat = "quality" | "successRate" | "reputation" | "latencyMs";
type Pool = Pick<DiscoverableAgent, "avgQuality" | "successRate" | "reputation" | "avgLatencyMs" | "sampleCount">;

function statOf(agent: Pool, stat: Stat): number {
  switch (stat) {
    case "quality": return agent.avgQuality;
    case "successRate": return agent.successRate * 100;
    case "reputation": return agent.reputation;
    case "latencyMs": return agent.avgLatencyMs;
  }
}

function effectiveStats(candidates: Pool[]) {
  const rated = candidates.filter((a) => a.sampleCount > 0);
  const priorOf = (stat: Stat): number | null =>
    rated.length > 0 ? rated.reduce((s, a) => s + statOf(a, stat), 0) / rated.length : null;
  const prior = { quality: priorOf("quality"), successRate: priorOf("successRate"), reputation: priorOf("reputation"), latencyMs: priorOf("latencyMs") };

  return candidates.map((a) => {
    const shrink = (stat: Stat) => {
      const p = prior[stat] ?? (stat === "latencyMs" ? 0 : UNINFORMATIVE_PRIOR[stat]);
      return (a.sampleCount * statOf(a, stat) + PRIOR_STRENGTH * p) / (a.sampleCount + PRIOR_STRENGTH);
    };
    return { quality: shrink("quality"), successRate: shrink("successRate"), reputation: shrink("reputation"), latencyMs: shrink("latencyMs") };
  });
}

function normalizeInverse(value: number, min: number, max: number): number {
  if (max === min) return 100;
  return 100 * (1 - (value - min) / (max - min));
}

export interface ScoreBreakdown {
  capabilityMatch: number;
  quality: number;
  successRate: number;
  reputation: number;
  latencyEfficiency: number;
  costEfficiency: number;
  historicalSimilarity: number;
}

export interface ScoredCandidate {
  agent: DiscoverableAgent;
  price: number;
  effectiveLatencyMs: number;
  scoreBreakdown: ScoreBreakdown;
  totalScore: number;
}

export function scoreCandidates(params: {
  candidates: DiscoverableAgent[];
  prices: Map<string, number>; // agentId -> price (e.g. bid); falls back to listed price
  requiredCapability: string;
  history: Map<string, number>; // agentId -> historicalSimilarity 0-100; falls back to NO_HISTORY_SCORE
}): ScoredCandidate[] {
  const { candidates, prices, requiredCapability, history } = params;
  if (candidates.length === 0) return [];

  const eff = effectiveStats(candidates);
  const latencies = eff.map((e) => e.latencyMs || 1);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);
  const costs = candidates.map((a) => prices.get(a.id) ?? a.price);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);

  return candidates.map((agent, i) => {
    const price = costs[i];
    const scoreBreakdown: ScoreBreakdown = {
      capabilityMatch: agent.capabilities.includes(requiredCapability) ? 100 : 0,
      quality: eff[i].quality,
      successRate: eff[i].successRate,
      reputation: eff[i].reputation,
      latencyEfficiency: normalizeInverse(eff[i].latencyMs || 1, minLatency, maxLatency),
      costEfficiency: normalizeInverse(price, minCost, maxCost),
      historicalSimilarity: history.get(agent.id) ?? NO_HISTORY_SCORE,
    };
    const total =
      scoreBreakdown.capabilityMatch * WEIGHTS.capabilityMatch +
      scoreBreakdown.quality * WEIGHTS.quality +
      scoreBreakdown.successRate * WEIGHTS.successRate +
      scoreBreakdown.reputation * WEIGHTS.reputation +
      scoreBreakdown.latencyEfficiency * WEIGHTS.latencyEfficiency +
      scoreBreakdown.costEfficiency * WEIGHTS.costEfficiency +
      scoreBreakdown.historicalSimilarity * WEIGHTS.historicalSimilarity;
    return { agent, price, effectiveLatencyMs: eff[i].latencyMs, scoreBreakdown, totalScore: Math.round(total * 100) / 100 };
  });
}

// Two candidates whose routing scores are within this many points are
// treated as equivalent for the job; the cheaper one is hired.
export const VALUE_MARGIN = 3;

// "Is the premium agent actually necessary?" - deterministic answer. When a
// cheaper candidate scores within VALUE_MARGIN of the top candidate and is
// expected to clear the quality bar, the extra spend buys no meaningful
// expected quality, so the cheaper one moves to the front (with the reason
// appended to its explanation).
export function applyValuePreference<
  T extends { agent: { name: string }; bidAmount: number; totalScore: number; scoreBreakdown: ScoreBreakdown; explanation: string },
>(ranked: T[], qualityThreshold: number, margin = VALUE_MARGIN): T[] {
  if (ranked.length < 2) return ranked;
  const top = ranked[0];
  const value = ranked
    .slice(1)
    .filter((r) => r.bidAmount < top.bidAmount && top.totalScore - r.totalScore <= margin && r.scoreBreakdown.quality >= qualityThreshold)
    .sort((a, b) => a.bidAmount - b.bidAmount || b.totalScore - a.totalScore)[0];
  if (!value) return ranked;
  const note = ` Premium not required: ${top.agent.name} scored only ${(top.totalScore - value.totalScore).toFixed(1)} pts higher at ${top.bidAmount} tokens vs ${value.bidAmount}.`;
  return [{ ...value, explanation: value.explanation + note }, ...ranked.filter((r) => r !== value)];
}
