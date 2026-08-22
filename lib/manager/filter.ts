import type { DiscoverableAgent } from "@/lib/discovery/types";

// Deterministic capability/price/availability filter — runs before ranking.
// Gemini never decides who is even eligible; this does.
export function filterCandidates(candidates: DiscoverableAgent[], remainingBudget: number): DiscoverableAgent[] {
  return candidates.filter((a) => a.status === "ACTIVE" && a.price > 0 && a.price <= remainingBudget);
}
