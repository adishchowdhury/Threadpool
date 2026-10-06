import { createHash } from "node:crypto";
import { z } from "zod";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import { generateStructuredWithUsage } from "@/lib/manager/structuredGenerate";
import { checkReportNumbers, type NumericCheckReport } from "@/lib/manager/numericCheck";
import { checkCitations, type Source } from "@/lib/capabilities/sources";
import { capabilitySpec, REPORT_CAPABILITIES } from "@/lib/capabilities/catalog";
import { citableSources } from "@/lib/capabilities/common";
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

function renderReview(review: IntegrationReview, steps: UpstreamItem[]): string {
  const name = (seq: number | null) => {
    const s = steps.find((u) => u.sequence === seq);
    return s ? `step ${seq} (${s.type})` : "unattributed";
  };
  const lines = [
    `## Integration review — ${review.approved ? "APPROVED" : "CHANGES REQUIRED"} (${review.score}/100)`,
    "",
    review.summary,
  ];
  if (review.issues.length) {
    lines.push("", "| Severity | Step | Issue | Required fix | Found by |", "|---|---|---|---|---|");
    for (const i of review.issues) {
      lines.push(`| ${i.severity} | ${name(i.targetSequence)} | ${i.description.replace(/\|/g, "/")} | ${i.fix.replace(/\|/g, "/")} | ${i.origin === "reviewer" || !i.origin ? "reviewer" : `Kraven ${i.origin.replace("_", " ")}`} |`);
    }
  } else lines.push("", "No issues found.");
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
  const detIssues = deterministicReportIssues(report, sources, numeric);
  const validTargets = new Set(steps.filter((s) => capabilitySpec(s.capability ?? "")?.stage !== "verify").map((s) => s.sequence));

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
      review = { approved: true, score: 80, summary: "[LOCAL FALLBACK REVIEW] Reviewer model unavailable; only Kraven's deterministic checks were applied.", issues: [] };
      source = "local_fallback";
    }
  } else {
    review = { approved: true, score: 80, summary: "[LOCAL FALLBACK REVIEW] Sarvam unavailable; only Kraven's deterministic checks were applied.", issues: [] };
    source = "local_fallback";
  }

  // Deterministic findings always apply and cannot be waived by the model.
  review.issues = [...detIssues, ...review.issues];
  if (review.issues.some(isBlocking)) {
    review.approved = false;
    review.score = Math.min(review.score, 70);
  }

  return {
    output: renderReview(review, steps),
    source,
    usage,
    artifacts: { review, numericCheck: numeric, reviewedReportHash: hashText(report.output), mode: source === "local_fallback" ? "fallback" : "structured" },
  };
}
