import { test } from "node:test";
import assert from "node:assert/strict";
import { describeIncompleteStep, renderLimitationsNote } from "@/lib/manager/incompleteSteps";

const RAW = "The output provides some relevant statistics, but it fails to substantively address the core instruction: it does not present sourced findings that tie X to Y... Therefore, the output does not adequately fulfill the instruction.";

test("an incomplete step is described in plain words and keeps the raw reason only as detail", () => {
  const step = describeIncompleteStep({ type: "web_research", requiredCapability: "web_research", kind: "quality", reason: RAW });
  assert.match(step.summary, /^Web research didn't reach the required quality/);
  assert.equal(step.detail, RAW);
  assert.ok(!step.summary.includes("fails to substantively"), "reviewer prose must not leak into the headline");
});

test("every skip kind has its own plain wording", () => {
  const kinds = ["quality", "attempts", "no_agent", "time", "safeguard"] as const;
  const summaries = kinds.map((kind) => describeIncompleteStep({ type: "data_analysis", requiredCapability: "data_analysis", kind, reason: "r" }).summary);
  for (const s of summaries) assert.match(s, /^Data analysis /);
  assert.equal(new Set(summaries).size, 4, "quality and attempts intentionally share wording");
});

test("the report note is short, comes as a footer block, and never contains the raw reviewer text", () => {
  const note = renderLimitationsNote([describeIncompleteStep({ type: "web_research", requiredCapability: "web_research", kind: "quality", reason: RAW })]);
  assert.match(note, /^---\n\n\*\*About this report:\*\* one step couldn't be completed/);
  assert.ok(!note.includes("substantively"));
  assert.ok(note.length < 400, `note is ${note.length} chars`);
  assert.equal(renderLimitationsNote([]), "");
});
