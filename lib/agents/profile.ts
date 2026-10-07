// Pure aggregation for agent profiles and the arena. Four sources of truth are
// kept apart and never blended here:
//   benchmark   - Kraven's own controlled calibration runs (AgentCalibration)
//   production  - real task executions (AgentPerformance)
//   userRatings - ratings from orgs that actually used the agent (AgentRating)
//   claims      - what the developer says (description/capabilities/price)
// Only benchmark and production are measurements.

export interface RawSample {
  capability: string;
  qa: number;
  latencyMs: number;
  cost: number | null; // null = not recorded for this source
  success: boolean;
  domain?: string | null;
}

export interface SampleSummary {
  samples: number;
  avgQuality: number | null;
  successRate: number | null;
  medianLatencyMs: number | null;
  avgCost: number | null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function summarize(samples: RawSample[]): SampleSummary {
  const n = samples.length;
  if (n === 0) return { samples: 0, avgQuality: null, successRate: null, medianLatencyMs: null, avgCost: null };
  const costs = samples.map((s) => s.cost).filter((c): c is number => c !== null);
  return {
    samples: n,
    avgQuality: samples.reduce((a, s) => a + s.qa, 0) / n,
    successRate: samples.filter((s) => s.success).length / n,
    medianLatencyMs: median(samples.map((s) => s.latencyMs)),
    avgCost: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
  };
}

export function summarizeBy(samples: RawSample[], key: "capability" | "domain"): Record<string, SampleSummary> {
  const groups = new Map<string, RawSample[]>();
  for (const s of samples) {
    const k = key === "capability" ? s.capability : s.domain ?? "general";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  return Object.fromEntries([...groups].map(([k, v]) => [k, summarize(v)]));
}

export function summarizeRatings(ratings: number[]): { count: number; average: number | null } {
  return { count: ratings.length, average: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null };
}

// Strengths/weaknesses are derived from measured per-domain quality relative
// to the agent's own overall measured quality - never from declared tags.
export function strengthsAndWeaknesses(
  overall: SampleSummary,
  byDomain: Record<string, SampleSummary>,
  minSamples = 2,
  margin = 5,
): { strongIn: string[]; weakIn: string[] } {
  const strongIn: string[] = [];
  const weakIn: string[] = [];
  if (overall.avgQuality === null) return { strongIn, weakIn };
  for (const [domain, s] of Object.entries(byDomain)) {
    if (domain === "general" || s.samples < minSamples || s.avgQuality === null) continue;
    if (s.avgQuality >= overall.avgQuality + margin) strongIn.push(domain);
    else if (s.avgQuality <= overall.avgQuality - margin) weakIn.push(domain);
  }
  return { strongIn, weakIn };
}

// ── Improvement over time ─────────────────────────────────────────────
export interface TimedSample extends RawSample {
  at: number; // epoch ms
  source: "benchmark" | "production";
}

export interface TrendResult {
  direction: "improving" | "declining" | "steady" | "insufficient_data";
  earlierAvg: number | null;
  recentAvg: number | null;
  delta: number | null;
  samples: number;
}

// Compares the older half of an agent's measured results with the newer half.
// Needs enough runs to mean anything; a change under `margin` points is "steady".
export function qualityTrend(samples: TimedSample[], minSamples = 4, margin = 3): TrendResult {
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  if (sorted.length < minSamples) return { direction: "insufficient_data", earlierAvg: null, recentAvg: null, delta: null, samples: sorted.length };
  const mid = Math.floor(sorted.length / 2);
  const avg = (xs: TimedSample[]) => xs.reduce((a, s) => a + s.qa, 0) / xs.length;
  const earlierAvg = avg(sorted.slice(0, mid));
  const recentAvg = avg(sorted.slice(mid));
  const delta = recentAvg - earlierAvg;
  return { direction: delta > margin ? "improving" : delta < -margin ? "declining" : "steady", earlierAvg, recentAvg, delta, samples: sorted.length };
}

// ── Arena ─────────────────────────────────────────────────────────────
export type ArenaDimension = "quality" | "reliability" | "speed" | "value";

export interface ArenaEntry {
  agentId: string;
  name: string;
  samples: number;
  avgQuality: number;
  successRate: number;
  medianLatencyMs: number;
  price: number;
}

// "Best" depends on what the task needs: quality, reliability, speed, or
// quality per token. Entries with no measured samples are excluded - an
// unmeasured agent cannot rank.
export function arenaRank(entries: ArenaEntry[], dimension: ArenaDimension): Array<ArenaEntry & { rank: number; metric: number }> {
  const metricOf = (e: ArenaEntry): number => {
    switch (dimension) {
      case "quality": return e.avgQuality;
      case "reliability": return e.successRate * 100;
      case "speed": return e.medianLatencyMs > 0 ? 1_000_000 / e.medianLatencyMs : 0;
      case "value": return e.avgQuality / Math.max(e.price, 1);
    }
  };
  return entries
    .filter((e) => e.samples > 0)
    .map((e) => ({ ...e, metric: metricOf(e) }))
    .sort((a, b) => b.metric - a.metric || b.avgQuality - a.avgQuality)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}
