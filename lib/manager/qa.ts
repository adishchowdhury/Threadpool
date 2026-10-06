import { qaVerdictSchema, type QaVerdict } from "@/lib/manager/schemas";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import { generateStructured } from "@/lib/manager/structuredGenerate";
import { capabilityRubric } from "@/lib/capabilities/rubric";
import type { Source } from "@/lib/capabilities/sources";
import type { SubtaskArtifacts } from "@/lib/capabilities/types";

// Deterministic rubric - always runs, independent of any LLM.
function rubricCheck(output: string): { passed: boolean; reason: string | null } {
  if (output.trim().length < 40) {
    return { passed: false, reason: "output too short to be a substantive deliverable" };
  }
  return { passed: true, reason: null };
}

const ERROR_PATTERNS = /^\s*\[(EXECUTION ERROR|LOCAL FALLBACK)\]|^\s*(error|sorry|i (cannot|can't|am unable to))\b/i;

// Deterministic heuristics cannot judge whether an output actually answers
// the task - that requires understanding meaning, which is exactly what's
// unavailable when there's no LLM to fall back to. So this stays
// conservative: it only catches structural signs that something went wrong
// (near-empty, degenerate repetition, a surfaced error/refusal), and does
// NOT treat length as evidence of correctness. A long, fluent, wrong answer
// (e.g. "bananas improve market liquidity...") will slip through local
// fallback QA - that gap is closed by the real Sarvam QA pass when
// configured, not by heuristics pretending to read for meaning.
function structuralIssues(output: string): string[] {
  const issues: string[] = [];
  const trimmed = output.trim();

  if (ERROR_PATTERNS.test(trimmed)) {
    issues.push("output looks like an error or refusal message, not a deliverable");
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 8) {
    issues.push("too few words to be a substantive deliverable");
  }

  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
  if (words.length >= 8 && uniqueWords.size / words.length < 0.3) {
    issues.push("output is mostly repeated words/phrases, not substantive content");
  }

  const sentences = trimmed.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);
  if (sentences.length === 0) {
    issues.push("output has no sentence structure");
  }

  return issues;
}

// Conservative fallback used only when no QA model is configured. It cannot
// verify semantic correctness, so it never scores above the quality
// threshold's immediate neighborhood on structure alone: "passed" here means
// "nothing structurally wrong was found", not "this is correct".
function fallbackVerdict(output: string, qualityThreshold: number): QaVerdict {
  const rubric = rubricCheck(output);
  if (!rubric.passed) {
    return {
      passed: false,
      score: 20,
      reason: rubric.reason!,
      issues: [rubric.reason!],
    };
  }

  const issues = structuralIssues(output);
  if (issues.length > 0) {
    return {
      passed: false,
      score: 25,
      reason: `[LOCAL FALLBACK QA] structural checks failed: ${issues.join("; ")}`,
      issues,
    };
  }

  // No structural red flags. This is NOT a semantic pass - it's a flat,
  // bounded score, not one that keeps climbing with output length like the
  // old heuristic did. A borderline-length output (just past the 40-char
  // floor) gets a lower score than a solidly substantive one, but neither
  // scales further with length beyond that one distinction. The flat cap
  // (82) sits just above Kraven's default quality threshold (80) so a
  // genuinely substantive deliverable can still clear it without a QA
  // model configured, while unusually high thresholds still require real
  // semantic QA to pass.
  const trimmed = output.trim();
  const score = trimmed.length >= 150 ? 82 : 60;
  return {
    passed: score >= qualityThreshold,
    score,
    reason: `[LOCAL FALLBACK QA] no structural defects found; semantic correctness was not verified (no QA model configured)`,
    issues: [],
  };
}

// What the QA model should judge for capabilities whose output is not a
// plain deliverable.
const QA_FOCUS: Record<string, string> = {
  quality_verification:
    "This output is a REVIEW of other workers' deliverable. Judge the review itself: is it rigorous, specific, and are its issues correctly attributed with actionable fixes? A review that (correctly) rejects weak work can score highly.",
  web_research:
    "Judge whether the sourced findings actually address the assignment and are kept separate from the model's own analysis. Citation validity has already been verified by code.",
  data_analysis:
    "All figures were computed by a deterministic engine. Judge whether the chosen analyses answer the assignment and whether the interpretation is sound and appropriately cautious.",
  competitive_analysis:
    "Judge whether the right competitors are compared on meaningful dimensions and whether the SWOT and takeaways are specific rather than generic.",
};

// QA is deliberately separate from the worker that produced the output.
// Combines deterministic checks (always applied, cannot be overridden) with a
// Sarvam qualitative judgment when available. The Manager reads this verdict -
// never a raw model response - to decide pay/retry/reassign/terminate.
export async function verifySubtaskOutput(params: {
  type: string;
  description: string;
  output: string;
  qualityThreshold: number;
  artifacts?: SubtaskArtifacts;
  knownSources?: Source[];
}): Promise<{ verdict: QaVerdict; source: "sarvam" | "rubric" | "local_fallback"; notes: string[] }> {
  const rubric = rubricCheck(params.output);
  if (!rubric.passed) {
    return { verdict: { passed: false, score: 15, reason: rubric.reason!, issues: [rubric.reason!] }, source: "rubric", notes: [] };
  }

  const capability = capabilityRubric(params.type, params.output, params.artifacts, params.knownSources ?? []);
  if (capability.failures.length > 0) {
    const reason = `Deterministic checks failed: ${capability.failures.join("; ")}.`;
    return { verdict: { passed: false, score: 40, reason, issues: capability.failures }, source: "rubric", notes: capability.notes };
  }

  // Web research when retrieval itself was impossible (search backend down or
  // blocking, every page unreachable): the deliverable says so plainly and
  // cites nothing; a retry cannot fix the environment, and failing would
  // turn an outage into a failed task. Accepted at the bar, never above it.
  if (params.type === "web_research" && params.artifacts?.webSearch && !params.artifacts.webSearch.available) {
    return {
      verdict: {
        passed: true,
        score: params.qualityThreshold,
        reason: `No live sources could be retrieved (${params.artifacts.webSearch.reason ?? "unknown"}); the researcher reported this without citing anything. Downstream work is unsourced and labeled as such.`,
        issues: [],
      },
      source: "rubric",
      notes: capability.notes,
    };
  }

  // Data analysis with nothing to analyse: the analyst checked every input
  // and said so honestly; retrying it cannot create data. Accept at the bar
  // and let the final review attribute the gap to the step that should have
  // supplied the data (which triggers rework there).
  if (params.type === "data_analysis" && (params.artifacts?.datasets?.length ?? 0) === 0 && params.artifacts?.mode === "deterministic") {
    return {
      verdict: {
        passed: true,
        score: params.qualityThreshold,
        reason: "No analysable data was supplied upstream; the analyst reported this without inventing figures. The gap belongs to the upstream step.",
        issues: [],
      },
      source: "rubric",
      notes: capability.notes,
    };
  }

  if (!isSarvamConfigured()) {
    return { verdict: fallbackVerdict(params.output, params.qualityThreshold), source: "local_fallback", notes: capability.notes };
  }

  try {
    const object = await generateStructured({
      schema: qaVerdictSchema,
      prompt: `You are Kraven's independent QA agent, separate from the worker that produced this output.
Judge whether the following output adequately fulfills its instruction. Score 0-100.
The quality threshold to PASS is ${params.qualityThreshold}.

Subtask capability: ${params.type}
Instruction: ${params.description}
${QA_FOCUS[params.type] ? `Focus: ${QA_FOCUS[params.type]}\n` : ""}${capability.notes.length ? `Context from Kraven's checks: ${capability.notes.join("; ")}\n` : ""}
Output to review:
"""
${params.output}
"""

Return passed=true only if score >= ${params.qualityThreshold} AND the output substantively addresses the instruction.
If it fails, "reason" must say concretely what to change, and "issues" must list each specific problem.`,
    });
    // The pass/fail line is Kraven's, not the model's: enforce the threshold.
    const verdict = { ...object, passed: object.passed && object.score >= params.qualityThreshold };
    return { verdict, source: "sarvam", notes: capability.notes };
  } catch (err) {
    console.error("[QA] Sarvam quality review failed, using local fallback verdict:", err);
    return { verdict: fallbackVerdict(params.output, params.qualityThreshold), source: "local_fallback", notes: capability.notes };
  }
}
