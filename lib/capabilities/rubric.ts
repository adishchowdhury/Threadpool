import { REPORT_CAPABILITIES } from "@/lib/capabilities/catalog";
import { checkCitations, type Source } from "@/lib/capabilities/sources";
import type { SubtaskArtifacts } from "@/lib/capabilities/types";

// Capability-aware deterministic QA checks. They run before (and override)
// the QA model: a deliverable that fabricates a citation or reports a figure
// nothing computed fails regardless of how good it reads. Each failure is a
// concrete instruction, because it is sent back to the worker as revision
// feedback.

export const MAX_UNGROUNDED_NUMBERS = 2;
export const MAX_UNCITED_SOURCED_CLAIMS = 1;

export interface RubricResult {
  failures: string[];
  notes: string[];
}

export function capabilityRubric(capability: string, output: string, artifacts: SubtaskArtifacts | undefined, knownSources: Source[]): RubricResult {
  const failures: string[] = [];
  const notes: string[] = [];
  const a = artifacts ?? {};

  switch (capability) {
    case "web_research": {
      if (!a.webSearch?.available || (a.sources?.length ?? 0) === 0) {
        notes.push("no live sources could be retrieved; the deliverable is explicitly labeled unsourced");
        if (a.citationCheck && a.citationCheck.cited.length + a.citationCheck.invalid.length > 0) failures.push("cites sources although none were retrieved");
        break;
      }
      const cc = a.citationCheck;
      if (!/^#{1,4}\s*sourced findings/im.test(output)) failures.push('missing the "Sourced findings" section');
      if (cc?.invalid.length) failures.push(`cites source ids that were never retrieved (${cc.invalid.join(", ")}); cite only ${a.sources!.map((s) => s.id).join(", ")}`);
      if (cc && cc.cited.length === 0) failures.push("no finding is tagged with a retrieved source id - every sourced finding must end with [S#]");
      if (cc && cc.uncitedSourcedClaims.length > MAX_UNCITED_SOURCED_CLAIMS) {
        failures.push(`${cc.uncitedSourcedClaims.length} statements under "Sourced findings" carry no source tag (e.g. "${cc.uncitedSourcedClaims[0].slice(0, 80)}"); tag them or move them to the Analysis section`);
      }
      if (cc?.unknownUrls.length) failures.push(`writes URLs that were not retrieved (${cc.unknownUrls.slice(0, 3).join(", ")})`);
      break;
    }
    case "competitive_analysis": {
      if (a.mode === "structured") {
        if ((a.competitors?.length ?? 0) < 2) failures.push("compares fewer than two competitors");
        if ((a.dataPoints?.length ?? 0) === 0) failures.push("provides no comparable metrics - give at least one metric per competitor, using the same metric names, marked sourced or estimate");
        const unsourced = a.competitors?.filter((c) => c.evidence.length === 0).length ?? 0;
        if (knownSources.length > 0 && unsourced > 0) notes.push(`${unsourced} competitor profile(s) cite no retrieved source although ${knownSources.length} were available`);
        const sourcedFigures = a.dataPoints?.filter((d) => d.basis === "sourced").length ?? 0;
        if (a.dataPoints?.length) notes.push(`comparable figures: ${sourcedFigures} verified against the cited page, ${a.dataPoints.length - sourcedFigures} labeled as estimates`);
        const incomplete = a.competitors?.filter((c) => [c.strengths, c.weaknesses, c.opportunities, c.threats].some((q) => q.length === 0)) ?? [];
        if (incomplete.length) failures.push(`SWOT incomplete for ${incomplete.map((c) => c.name).join(", ")} - give each competitor strengths, weaknesses, opportunities and threats`);
        const swot = a.swot;
        if (swot && [swot.strengths, swot.weaknesses, swot.opportunities, swot.threats].some((s) => s.length === 0)) failures.push("SWOT has an empty quadrant");
        if (a.citationCheck?.invalid.length) notes.push(`removed citations to never-retrieved sources: ${a.citationCheck.invalid.join(", ")}`);
        if (knownSources.length === 0) {
          notes.push("no sources could be retrieved anywhere in this workflow, so clearly-labeled estimates are the expected basis - judge the labeling and reasoning, not the absence of sources");
        }
      } else if (a.mode !== "fallback") {
        const cc = checkCitations(output, knownSources);
        if (cc.invalid.length) failures.push(`cites source ids that were never retrieved (${cc.invalid.join(", ")})`);
      }
      break;
    }
    case "financial_analysis": {
      if (a.mode === "structured") {
        if ((a.financialMetrics?.length ?? 0) === 0) failures.push("produced no financial metrics");
        const unjustifiedEstimates = a.financialMetrics?.filter((m) => m.basis === "estimate" && m.assumptions.length === 0) ?? [];
        if (unjustifiedEstimates.length) {
          failures.push(
            `${unjustifiedEstimates.length} metric(s) marked "estimate" with no assumptions listed (${unjustifiedEstimates.map((m) => m.name).join(", ")}) - every estimate must state what it's derived from`,
          );
        }
        const observedCount = a.financialMetrics?.filter((m) => m.basis === "observed").length ?? 0;
        if (a.financialMetrics?.length) notes.push(`${observedCount} metric(s) observed from sources, ${a.financialMetrics.length - observedCount} estimated with stated assumptions`);
        if (knownSources.length === 0 && observedCount === 0) {
          notes.push("no sources could be retrieved anywhere in this workflow, so clearly-labeled estimates are the expected basis - judge the labeling and reasoning, not the absence of sources");
        }
      } else if (a.mode !== "fallback") {
        const cc = checkCitations(output, knownSources);
        if (cc.invalid.length) failures.push(`cites source ids that were never retrieved (${cc.invalid.join(", ")})`);
      }
      break;
    }
    case "data_analysis": {
      const ok = a.analysis?.filter((r) => r.ok).length ?? 0;
      if ((a.datasets?.length ?? 0) > 0 && ok === 0) failures.push("data was available but no analysis operation computed successfully");
      if ((a.ungroundedNumbers?.length ?? 0) > MAX_UNGROUNDED_NUMBERS) {
        failures.push(`the findings quote figures that are not in the data or the computed results (${a.ungroundedNumbers!.slice(0, 6).join(", ")}); quote only computed figures`);
      }
      if ((a.datasets?.length ?? 0) === 0) notes.push("no numeric data was available; nothing was computed");
      break;
    }
    case "quality_verification": {
      if (!a.review) failures.push("review did not produce a structured verdict");
      break;
    }
    default: {
      const cc = checkCitations(output, knownSources);
      if (cc.invalid.length) failures.push(`cites source ids that were never retrieved (${cc.invalid.join(", ")}); only ${knownSources.map((s) => s.id).join(", ") || "no ids"} exist`);
      if ((REPORT_CAPABILITIES as readonly string[]).includes(capability) && cc.unknownUrls.length) {
        failures.push(`links URLs that are not among the retrieved sources (${cc.unknownUrls.slice(0, 3).join(", ")}); cite by [S#] id instead`);
      }
    }
  }
  return { failures, notes };
}
