import type { DiscoverableAgent } from "@/lib/discovery/types";

export interface FilterStage {
  stage: string;
  count: number;
  // True when this stage would have left nobody and was not applied.
  relaxed?: boolean;
}

// Deterministic staged filter - runs before ranking. Sarvam never decides who
// is even eligible; this does. Every count is computed from the real pool.
//   availability -> budget feasibility -> downstream reserve -> quality requirement
// The downstream-reserve stage keeps enough budget for the cheapest staffing
// of every later step in the workflow, so an expensive early hire cannot
// starve the steps after it. If honoring the reserve would leave nobody, the
// stage is relaxed to the cheapest affordable agent(s) - the least damaging
// choice - and reported as relaxed.
// The quality stage only applies to agents we have actually measured: an
// unrated agent has no observed quality to compare, so it stays eligible
// (and is scored from the pool prior in rank.ts) until it has a track record.
// If the quality stage would empty the pool it is relaxed rather than failing.
export function filterCandidatesStaged(
  candidates: DiscoverableAgent[],
  remainingBudget: number,
  qualityThreshold: number,
  spendCap: number = remainingBudget,
): { eligible: DiscoverableAgent[]; stages: FilterStage[] } {
  const stages: FilterStage[] = [{ stage: "capability match", count: candidates.length }];

  const available = candidates.filter((a) => a.status === "ACTIVE");
  stages.push({ stage: "availability", count: available.length });

  const affordable = available.filter((a) => a.price > 0 && a.price <= remainingBudget);
  stages.push({ stage: "budget", count: affordable.length });

  let withinReserve = affordable;
  if (spendCap < remainingBudget) {
    const fits = affordable.filter((a) => a.price <= spendCap);
    if (fits.length === 0 && affordable.length > 0) {
      const cheapest = Math.min(...affordable.map((a) => a.price));
      withinReserve = affordable.filter((a) => a.price === cheapest);
      stages.push({ stage: "downstream reserve", count: 0, relaxed: true });
    } else {
      withinReserve = fits;
      stages.push({ stage: "downstream reserve", count: fits.length });
    }
  }

  const qualified = withinReserve.filter((a) => a.sampleCount === 0 || a.avgQuality >= qualityThreshold);
  // If nobody clears the quality bar, don't fail the whole task before any
  // work is attempted: keep the affordable pool and let QA gate payment. The
  // stage is reported as relaxed, with the real count that qualified (0).
  const relaxed = qualified.length === 0 && withinReserve.length > 0;
  const eligible = relaxed ? withinReserve : qualified;
  stages.push({ stage: "quality", count: qualified.length, ...(relaxed ? { relaxed: true } : {}) });

  return { eligible, stages };
}

export function filterCandidates(candidates: DiscoverableAgent[], remainingBudget: number, qualityThreshold: number): DiscoverableAgent[] {
  return filterCandidatesStaged(candidates, remainingBudget, qualityThreshold).eligible;
}
