// How a workflow step that could not be completed is described to the user.
// The raw reason (a reviewer's full paragraph, a Circuit Breaker message) is
// kept for the audit trail and shown behind a "details" toggle, but is never
// the headline: users need to know which step, why in plain words, and what it
// means for the report.

export type SkipKind = "quality" | "no_agent" | "time" | "safeguard" | "attempts";

export interface IncompleteStep {
  type: string;
  requiredCapability: string;
  kind: SkipKind;
  // Plain-language one-liner: what happened to this step.
  summary: string;
  // The raw technical reason, for the details view and audit trail.
  detail: string;
  // Back-compat for consumers that only read `reason`.
  reason: string;
}

const humanize = (slug: string) => {
  const text = slug.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const SUMMARIES: Record<SkipKind, string> = {
  quality: "didn't reach the required quality after several attempts, so its output wasn't used and wasn't paid for.",
  attempts: "didn't reach the required quality after several attempts, so its output wasn't used and wasn't paid for.",
  no_agent: "had no available agent that fit the budget and quality bar, so it was skipped.",
  time: "ran out of time before it could finish, so it was skipped.",
  safeguard: "was stopped by a spending safeguard, and the funds were returned to your budget.",
};

export function describeIncompleteStep(step: { type: string; requiredCapability: string; kind?: SkipKind | null; reason: string }): IncompleteStep {
  const kind: SkipKind = step.kind ?? "quality";
  return {
    type: step.type,
    requiredCapability: step.requiredCapability,
    kind,
    summary: `${humanize(step.type)} ${SUMMARIES[kind]}`,
    detail: step.reason,
    reason: step.reason,
  };
}

// The short note appended to the report itself (the markdown is also what
// gets copied or downloaded). At the end, not the start: the deliverable
// leads, the caveat follows.
export function renderLimitationsNote(steps: IncompleteStep[]): string {
  if (steps.length === 0) return "";
  const lines = steps.map((s) => `- ${s.summary}`);
  return [
    "---",
    "",
    `**About this report:** ${steps.length === 1 ? "one step" : `${steps.length} steps`} couldn't be completed. Everything else was produced and quality-checked as normal; conclusions that depend on the missing part are less certain.`,
    "",
    ...lines,
  ].join("\n");
}
