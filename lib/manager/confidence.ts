import type { Source } from "@/lib/capabilities/sources";
import type { NumericCheckReport } from "@/lib/manager/numericCheck";

// Deterministic confidence scoring. The Manager LLM is never allowed to pick
// a confidence label out of thin air: every "High/Medium/Low" shown to the
// user (per-metric or overall) is computed here from signals Kraven already
// has - source count, source diversity, source kind, arithmetic consistency,
// and independent review agreement - never from a model's self-assessment.

export type ConfidenceLabel = "high" | "medium" | "low";

function domain(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// Confidence for a single claim backed by zero or more sources. Used by
// financial_analysis / competitive_analysis to label individual metrics.
export function claimConfidence(sources: Source[]): ConfidenceLabel {
  if (sources.length === 0) return "low";
  const distinctDomains = new Set(sources.map((s) => domain(s.url))).size;
  const fullPages = sources.filter((s) => s.kind === "page").length;
  if (distinctDomains >= 2 && fullPages >= 1) return "high";
  if (sources.length >= 1 && fullPages >= 1) return "medium";
  return "low";
}

export interface EvidenceSignals {
  totalSources: number;
  distinctDomains: number;
  fullPages: number;
  snippetsOnly: number;
}

// Summary of what was actually retrieved in the task, for grounding the
// report's own Confidence section in real numbers instead of a guess.
export function evidenceSignals(sources: Source[]): EvidenceSignals {
  return {
    totalSources: sources.length,
    distinctDomains: new Set(sources.map((s) => domain(s.url))).size,
    fullPages: sources.filter((s) => s.kind === "page").length,
    snippetsOnly: sources.filter((s) => s.kind === "snippet").length,
  };
}

export function describeEvidenceSignals(signals: EvidenceSignals): string {
  if (signals.totalSources === 0) return "No live sources were retrieved in this task; figures rely on model knowledge and must be labeled as estimates.";
  return `${signals.totalSources} source(s) retrieved from ${signals.distinctDomains} distinct domain(s) (${signals.fullPages} full page(s), ${signals.snippetsOnly} search-snippet-only).`;
}

export interface OverallConfidence {
  score: number; // 0-100
  label: ConfidenceLabel;
  reason: string;
}

// Overall confidence for the finished deliverable - computed once, after
// execution, from signals that already exist in the pipeline:
// - source diversity (distinct domains agreeing beats one source repeated)
// - arithmetic consistency (lib/manager/numericCheck.ts)
// - the independent reviewer's score (lib/capabilities/review.ts)
// This is metadata attached to the task record for the UI; it does not
// rewrite the report text.
export function computeOverallConfidence(params: {
  sources: Source[];
  numeric: NumericCheckReport;
  reviewScore: number | null;
}): OverallConfidence {
  const signals = evidenceSignals(params.sources);
  let score = 50;
  const notes: string[] = [];

  if (signals.totalSources === 0) {
    score -= 20;
    notes.push("no retrieved sources");
  } else {
    score += Math.min(20, signals.distinctDomains * 6);
    notes.push(`${signals.distinctDomains} independent domain(s)`);
    if (signals.fullPages === 0) {
      score -= 10;
      notes.push("snippet-only evidence");
    }
  }

  if (params.numeric.status === "checked" && params.numeric.checked > 0) {
    const consistency = params.numeric.consistent / params.numeric.checked;
    score += Math.round((consistency - 0.5) * 40);
    notes.push(`${params.numeric.consistent}/${params.numeric.checked} arithmetic claims verified`);
  }

  if (params.reviewScore != null) {
    score += Math.round((params.reviewScore - 70) * 0.3);
    notes.push(`independent review ${params.reviewScore}/100`);
  }

  score = Math.max(5, Math.min(95, Math.round(score)));
  const label: ConfidenceLabel = score >= 70 ? "high" : score >= 45 ? "medium" : "low";
  return { score, label, reason: notes.join("; ") };
}
