import type { DiscoverableAgent } from "@/lib/discovery/types";
import { db } from "@/lib/db/client";
import { applyValuePreference, blendHistory, scoreCandidates, type ScoreBreakdown } from "@/lib/manager/scoring";

export interface RankedCandidate {
  agent: DiscoverableAgent;
  bidAmount: number;
  scoreBreakdown: ScoreBreakdown;
  totalScore: number;
  explanation: string;
}

// Deterministic ranking. Sarvam may have proposed which capability is
// needed; this comparison - and the resulting selection - is pure math
// (lib/manager/scoring.ts) over numbers already stored in the DB.
export async function rankCandidates(params: {
  candidates: DiscoverableAgent[];
  bids: Map<string, number>; // agentId -> bid amount
  requiredCapability: string;
  taskType: string;
  qualityThreshold?: number;
  domain?: string;
}): Promise<RankedCandidate[]> {
  const { candidates, bids, requiredCapability, taskType } = params;
  if (candidates.length === 0) return [];

  // Historical similarity: success ratio on this specific task type -
  // deterministic, not a model. Agents with no history get NO_HISTORY_SCORE.
  const history = new Map<string, number>();
  await Promise.all(
    candidates.map(async (a) => {
      const ratio = async (where: Record<string, unknown>) => {
        const [total, success] = await Promise.all([
          db.agentPerformance.count({ where: { agentId: a.id, ...where } }),
          db.agentPerformance.count({ where: { agentId: a.id, ...where, success: true } }),
        ]);
        return total > 0 ? (success / total) * 100 : null;
      };
      const domain = params.domain && params.domain !== "general" ? params.domain : null;
      history.set(a.id, blendHistory(await ratio({ taskType }), domain ? await ratio({ domain }) : null));
    }),
  );

  const ranked = scoreCandidates({ candidates, prices: bids, requiredCapability, history })
    .map((s) => ({
      agent: s.agent,
      bidAmount: s.price,
      scoreBreakdown: s.scoreBreakdown,
      totalScore: s.totalScore,
      explanation:
        `Selected ${s.agent.name}${s.agent.isExternal ? ` (external · ${s.agent.providerName ?? "independent provider"})` : ""} because: ` +
        `Capability match: ${s.scoreBreakdown.capabilityMatch.toFixed(0)}%, ` +
        `Quality: ${s.scoreBreakdown.quality.toFixed(0)}, ` +
        `Success rate: ${s.scoreBreakdown.successRate.toFixed(0)}%, ` +
        `Cost: ${s.price} tokens, ` +
        `Latency: ${(s.effectiveLatencyMs / 1000).toFixed(0)}s` +
        (s.agent.sampleCount === 0 ? " (unrated - scored from pool prior)" : ` (${s.agent.sampleCount} measured samples)`),
    }))
    .sort((a, b) => b.totalScore - a.totalScore);

  return params.qualityThreshold !== undefined ? applyValuePreference(ranked, params.qualityThreshold) : ranked;
}
