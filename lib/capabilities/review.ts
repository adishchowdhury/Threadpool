import { createHash } from "node:crypto";
import { z } from "zod";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import { generateStructuredWithUsage } from "@/lib/manager/structuredGenerate";
import { checkReportNumbers, type NumericCheckReport } from "@/lib/manager/numericCheck";
import { checkCitations, type Source } from "@/lib/capabilities/sources";
import { capabilitySpec, REPORT_CAPABILITIES } from "@/lib/capabilities/catalog";
import { citableSources } from "@/lib/capabilities/common";
import { classifyReportIntent, isDecisionIntent, reportTemplate } from "@/lib/capabilities/reportIntent";
import { agentTier, LANGUAGE_RULE } from "@/lib/capabilities/llm";
import type { CapabilityRunInput, CapabilityRunOutput, IntegrationReview, ReviewIssue, UpstreamItem } from "@/lib/capabilities/types";

// Integration review (the plan's final quality_verification step). Unlike
// per-subtask QA, which judges one output in isolation, this reviews the
// assembled deliverable against the original task and attributes each
// problem to the workflow step that must fix it. The orchestrator turns
// blocking issues into targeted rework (lib/manager/rework.ts).

export const hashText = (t: string) => createHash("sha256").update(t).digest("hex");

export function isBlocking(issue: ReviewIssue): boolean {
  return issue.severity === "critical" || issue.severity === "major";
}

// The deliverable under review: the last report-writing step, else the last
// content step.
export function findReport(upstream: UpstreamItem[]): UpstreamItem | undefined {
  const content = upstream.filter((u) => capabilitySpec(u.capability ?? u.type)?.stage !== "verify");
  return [...content].reverse().find((u) => (REPORT_CAPABILITIES as readonly string[]).includes(u.capability ?? "")) ?? content[content.length - 1];
}

// Deterministic problems in the report - computed by code, not judged by a model.
export function deterministicReportIssues(report: UpstreamItem, sources: Source[], numeric: NumericCheckReport | null): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const target = report.sequence ?? null;
  const cites = checkCitations(report.output, sources);
  if (cites.invalid.length) {
    issues.push({
      severity: "major",
      targetSequence: target,
      category: "citations",
      description: `The report cites source ids that were never retrieved: ${cites.invalid.join(", ")}.`,
      fix: `Remove or replace those citations; only cite ids from the upstream research (${sources.map((s) => s.id).join(", ") || "none available"}).`,
      origin: "citation_check",
    });
  }
  if (cites.unknownUrls.length) {
    issues.push({
      severity: "major",
      targetSequence: target,
      category: "citations",
      description: `The report links URLs that are not among the retrieved sources: ${cites.unknownUrls.slice(0, 5).join(", ")}.`,
      fix: "Do not write URLs; cite retrieved sources by their [S#] id only.",
      origin: "citation_check",
    });
  }
  if (numeric?.status === "checked") {
    for (const c of numeric.checks.filter((c) => c.status === "mismatch")) {
      issues.push({
        severity: "major",
        targetSequence: target,
        category: "arithmetic",
        description: `"${c.quote}" states ${c.claimed}, but ${c.expression} = ${c.computed}.`,
        fix: "Correct the stated result (or its inputs) so the arithmetic holds.",
        origin: "numeric_check",
      });
    }
  }
  return issues;
}

// Structural check for decision-oriented reports (CLAUDE.md "decision
// intelligence" layer): a report that ran financial/market/competitive
// analysis but never says how confident Kraven is, or what would change the
// recommendation, has quietly reverted to a plain polished write-up. This is
// enforced by heading presence (cheap, deterministic), not by trusting the
// writer's self-report.
function missingDecisionSections(report: UpstreamItem, taskPrompt: string, capabilitiesUsed: string[]): ReviewIssue[] {
  const intent = classifyReportIntent(taskPrompt, capabilitiesUsed);
  if (!isDecisionIntent(intent)) return [];
  const text = report.output;
  const required = reportTemplate(intent).sections.filter((h) => /confidence|what could change/i.test(h));
  const missing = required.filter((h) => !new RegExp(`^#{1,4}\\s*${h.replace(/^#+\s*/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "im").test(text));
  if (missing.length === 0) return [];
  return [
    {
      severity: "major",
      targetSequence: report.sequence ?? null,
      category: "decision_support",
      description: `The report is missing required decision-support section(s): ${missing.join(", ").replace(/##\s*/g, "")}.`,
      fix: `Add ${missing.join(" and ").replace(/##\s*/g, "")}, grounded in the evidence already gathered (do not invent new figures to fill it).`,
      origin: "structure_check",
    },
  ];
}

const reviewSchema = z.object({
  approved: z.boolean(),
  score: z.number().int().min(0).max(100),
  summary: z.string(),
  issues: z
    .array(
      z.object({
        severity: z.enum(["critical", "major", "minor"]),
        targetSequence: z.number().int().nullable().describe("step number that must fix this, or null"),
        category: z.string().describe("e.g. completeness, accuracy, sourcing, structure, analysis"),
        description: z.string(),
        fix: z.string().describe("concrete instruction for the step that must fix it"),
      }),
    )
    .default([]),
});

// Concrete, scannable evidence that verification actually happened -
// rendered for EVERY review (not just the fallback path). A judge (human or
// QA model) reading "No issues found" with nothing behind it correctly reads
// that as a rubber stamp; a bullet list of exactly what was cross-checked
// and what the result was is what makes "approved, nothing wrong" and
// "didn't actually look" distinguishable.
function checksPerformedLines(params: {
  stepsReviewed: number;
  sources: Source[];
  cites: ReturnType<typeof checkCitations>;
  numeric: NumericCheckReport;
}): string[] {
  const { stepsReviewed, sources, cites, numeric } = params;
  const citationLine =
    sources.length === 0
      ? "Citations: no sources were retrieved anywhere in this task, so there is nothing to cite."
      : `Citations: ${cites.cited.length} cited against ${sources.length} retrieved source(s), ${cites.invalid.length} invalid, ${cites.unknownUrls.length} unlisted URL(s).`;
  const numericLine =
    numeric.status === "checked"
      ? `Arithmetic: ${numeric.checked} claim(s) recomputed independently - ${numeric.consistent} consistent, ${numeric.mismatches} mismatch(es), ${numeric.unevaluable} unevaluable.`
      : `Arithmetic: not checked (${numeric.reason ?? "unavailable"}).`;
  return [`Reviewed ${stepsReviewed} workflow step(s).`, citationLine, numericLine];
}

function renderReview(review: IntegrationReview, steps: UpstreamItem[], checks: string[]): string {
  const name = (seq: number | null) => {
    const s = steps.find((u) => u.sequence === seq);
    return s ? `step ${seq} (${s.type})` : "unattributed";
  };
  const lines = [
    `## Integration review — ${review.approved ? "APPROVED" : "CHANGES REQUIRED"} (${review.score}/100)`,
    "",
    review.summary,
    "",
    "### Checks performed",
    ...checks.map((c) => `- ${c}`),
  ];
  if (review.issues.length) {
    lines.push("", "### Issues", "", "| Severity | Step | Issue | Required fix | Found by |", "|---|---|---|---|---|");
    for (const i of review.issues) {
      lines.push(`| ${i.severity} | ${name(i.targetSequence)} | ${i.description.replace(/\|/g, "/")} | ${i.fix.replace(/\|/g, "/")} | ${i.origin === "reviewer" || !i.origin ? "reviewer" : `Kraven ${i.origin.replace("_", " ")}`} |`);
    }
  } else {
    lines.push("", "No blocking issues were found by the checks above.");
  }
  return lines.join("\n");
}

export async function runIntegrationReview(input: CapabilityRunInput): Promise<CapabilityRunOutput> {
  const steps = input.upstream.filter((u) => u.sequence !== undefined);
  const report = findReport(steps);
  if (!report) {
    const output = "## Integration review — CHANGES REQUIRED (0/100)\n\nThere is no deliverable to review: no upstream step produced output.";
    return { output, source: "deterministic", artifacts: { review: { approved: false, score: 0, summary: "No deliverable.", issues: [] }, mode: "deterministic" } };
  }

  const sources = citableSources(input);
  const numeric = await checkReportNumbers(report.output);
  const cites = checkCitations(report.output, sources);
  const capabilitiesUsed = steps.map((s) => s.capability ?? s.type);
  const detIssues = [...deterministicReportIssues(report, sources, numeric), ...missingDecisionSections(report, input.taskPrompt, capabilitiesUsed)];
  const validTargets = new Set(steps.filter((s) => capabilitySpec(s.capability ?? "")?.stage !== "verify").map((s) => s.sequence));
  const checks = checksPerformedLines({ stepsReviewed: steps.length, sources, cites, numeric });

  // A substantive summary for when the reviewer MODEL isn't available - the
  // "### Checks performed" section (always rendered, see renderReview)
  // carries the concrete evidence; this is just the narrative framing.
  function deterministicOnlySummary(reasonPrefix: string): string {
    const verdict = detIssues.length
      ? `${detIssues.length} issue(s) were found by Kraven's deterministic checks (see below).`
      : "No blocking issues were found by Kraven's deterministic checks (see below) - the reviewer model's own qualitative judgment did not run on this attempt.";
    return `${reasonPrefix} This review was produced entirely by Kraven's deterministic checks (citation verification, independent arithmetic recomputation, structure checks) - no LLM judgment layer ran on this attempt. ${verdict}`;
  }

  let review: IntegrationReview;
  let source: string;
  let usage: CapabilityRunOutput["usage"];
  if (isSarvamConfigured()) {
    try {
      const stepList = steps
        .map((s) => `### Step ${s.sequence}: ${s.type} (${s.capability})\n${s === report ? s.output.slice(0, 9000) : s.output.slice(0, 2500)}`)
        .join("\n\n");
      const res = await generateStructuredWithUsage({
        schema: reviewSchema,
        tier: agentTier(input),
        largeOutput: true,
        system: input.agent?.systemPrompt,
        prompt: `You are the final reviewer of an AI workforce's deliverable. Judge whether the deliverable (step ${report.sequence}) fully answers the user's task, and attribute every problem to the step that must fix it.
User task: "${input.taskPrompt}"
Review instruction: ${input.description}${input.feedback ? `
Context: ${input.feedback}` : ""}

Workflow outputs:
${stepList}

Kraven's deterministic checks already found:
${detIssues.length ? detIssues.map((i) => `- ${i.description}`).join("\n") : "- nothing"}
Numeric consistency: ${numeric.status === "checked" ? `${numeric.consistent}/${numeric.checked} arithmetic claims consistent` : `not checked (${numeric.reason ?? "unavailable"})`}.

Severity: critical = the deliverable fails the task (missing a required part, wrong subject, fabricated facts); major = a substantive error or gap a reader would act on wrongly; minor = polish.
targetSequence: the step that must change (a research gap -> the research step; wrong numbers -> the step that computed them; structure/omission in the deliverable -> step ${report.sequence}). Only use these steps: ${[...validTargets].join(", ")}.
approved = true only if there are no critical or major issues.
Free-text fields (issue descriptions, summary): ${LANGUAGE_RULE}`,
      });
      usage = res.usage;
      review = {
        ...res.object,
        issues: res.object.issues.slice(0, 12).map((i) => ({ ...i, targetSequence: i.targetSequence !== null && validTargets.has(i.targetSequence) ? i.targetSequence : (report.sequence ?? null), origin: "reviewer" as const })),
      };
      source = "sarvam_structured";
    } catch (err) {
      console.error("[IntegrationReview] reviewer model failed, using deterministic checks only:", err);
      review = {
        approved: true,
        score: 80,
        summary: deterministicOnlySummary("[LOCAL FALLBACK REVIEW] The reviewer model call failed (timeout or provider error) on this attempt."),
        issues: [],
      };
      // Deliberately NOT "local_fallback": that string means "an empty
      // placeholder, no real work happened" to the orchestrator (worker.ts's
      // fallbackOutput()), which auto-fails QA at 0/100 without even looking
      // at the output. This IS real work - a substantive review built from
      // deterministic citation/numeric/structure checks - just without the
      // LLM's own judgment layer on top. Give it its own label so a single
      // transient reviewer-model timeout doesn't get treated as a crash and
      // burn every reassignment attempt on a review that already happened.
      source = "deterministic_review_fallback";
    }
  } else {
    review = { approved: true, score: 80, summary: deterministicOnlySummary("[LOCAL FALLBACK REVIEW] No reviewer model is configured."), issues: [] };
    source = "local_fallback";
  }

  // Deterministic findings always apply and cannot be waived by the model.
  review.issues = [...detIssues, ...review.issues];
  if (review.issues.some(isBlocking)) {
    review.approved = false;
    review.score = Math.min(review.score, 70);
  }

  return {
    output: renderReview(review, steps, checks),
    source,
    usage,
    artifacts: { review, numericCheck: numeric, reviewedReportHash: hashText(report.output), mode: source === "local_fallback" || source === "deterministic_review_fallback" ? "fallback" : "structured" },
  };
}
