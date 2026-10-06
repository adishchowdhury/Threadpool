import { test } from "node:test";
import assert from "node:assert/strict";
import { fitPlanToBudget, heuristicPlan, normalizePlan, workflowSignature } from "@/lib/manager/planner";
import type { TaskPlan } from "@/lib/manager/schemas";

const caps = (p: TaskPlan) => p.subtasks.map((s) => s.requiredCapability);

function assertDag(p: TaskPlan) {
  p.subtasks.forEach((s, i) => {
    assert.equal(s.sequence, i, "sequences are contiguous");
    for (const d of s.dependsOnSequence) assert.ok(d < s.sequence, `step ${i} depends only on earlier steps`);
  });
  const last = p.subtasks[p.subtasks.length - 1];
  assert.equal(last.requiredCapability, "quality_verification");
  assert.equal(p.subtasks.filter((s) => s.requiredCapability === "quality_verification").length, 1);
}

test("EV market + top-5 comparison routes through research, competitive and data analysis", () => {
  const { plan } = normalizePlan(heuristicPlan("Analyze the Indian EV market and compare the top 5 companies."));
  assert.deepEqual(caps(plan), ["web_research", "competitive_analysis", "data_analysis", "report_generation", "quality_verification"]);
  assertDag(plan);
  const [web, comp, data, report] = plan.subtasks;
  assert.deepEqual(comp.dependsOnSequence, [web.sequence], "competitive analysis consumes the web research");
  assert.deepEqual(data.dependsOnSequence, [web.sequence, comp.sequence], "data analysis consumes research and comparables");
  assert.deepEqual(report.dependsOnSequence, [0, 1, 2]);
});

test("the fintech default task does not get competitive/data steps it does not need", () => {
  const { plan } = normalizePlan(
    heuristicPlan("Analyze the fintech startup market, identify three promising segments, estimate key financial metrics, and produce a concise investment-style report."),
  );
  assert.deepEqual(caps(plan), ["web_research", "market_research", "financial_analysis", "report_generation", "quality_verification"]);
});

test("a task that supplies its own data and asks no market question skips web research", () => {
  const { plan } = normalizePlan(heuristicPlan("Calculate the average and growth per region:\n```csv\nregion,y1,y2\nN,10,12\nS,20,25\nE,5,9\n```"));
  assert.ok(!caps(plan).includes("web_research"));
  assert.ok(caps(plan).includes("data_analysis"));
});

test("normalizePlan repairs forward/self dependencies and adds report + final review", () => {
  const raw: TaskPlan = {
    summary: "x",
    subtasks: [
      { type: "comp", requiredCapability: "competitive_analysis", description: "d", sequence: 5, dependsOnSequence: [5, 9] },
      { type: "web", requiredCapability: "web_research", description: "d", sequence: 2, dependsOnSequence: [5] },
      { type: "qa", requiredCapability: "quality_verification", description: "d", sequence: 7, dependsOnSequence: [] },
    ],
  };
  const { plan, adjustments } = normalizePlan(raw);
  assert.deepEqual(caps(plan), ["web_research", "competitive_analysis", "report_generation", "quality_verification"]);
  assertDag(plan);
  assert.deepEqual(plan.subtasks[0].dependsOnSequence, [], "forward dependency removed");
  assert.deepEqual(plan.subtasks[1].dependsOnSequence, [0], "self/unknown removed, research input wired");
  assert.ok(adjustments.length > 0);
});

test("fitPlanToBudget drops lowest-priority steps and rewires dependents", () => {
  const { plan } = normalizePlan(heuristicPlan("Analyze the Indian EV market and compare the top 5 companies."));
  const floor = new Map([
    ["web_research", 3],
    ["competitive_analysis", 4],
    ["data_analysis", 2],
    ["report_generation", 3],
    ["quality_verification", 2],
  ]);
  const roomy = fitPlanToBudget(plan, floor, 50);
  assert.equal(roomy.dropped.length, 0);
  assert.equal(roomy.estimatedMinCost, 14);

  const tight = fitPlanToBudget(plan, floor, 12);
  assert.deepEqual(tight.dropped.map((d) => d.capability), ["data_analysis"], "data analysis has the lowest budget priority here");
  assert.ok(tight.estimatedMinCost <= 12);
  assertDag(tight.plan);
  const report = tight.plan.subtasks.find((s) => s.requiredCapability === "report_generation")!;
  assert.deepEqual(report.dependsOnSequence, [0, 1]);
});

test("fitPlanToBudget drops optional steps nobody can be hired for, never synthesis/review", () => {
  const { plan } = normalizePlan(heuristicPlan("Analyze the Indian EV market and compare the top 5 companies."));
  const floor = new Map([
    ["web_research", 3],
    ["data_analysis", 2],
    ["report_generation", 3],
    ["quality_verification", 2],
  ]);
  const fit = fitPlanToBudget(plan, floor, 1);
  assert.ok(fit.dropped.some((d) => d.capability === "competitive_analysis" && /no hireable agent/.test(d.reason)));
  assert.ok(caps(fit.plan).includes("report_generation"));
  assert.ok(caps(fit.plan).includes("quality_verification"));
  assert.equal(caps(fit.plan).filter((c) => c === "web_research" || c === "data_analysis").length, 1, "keeps at least one content step");
});

test("workflowSignature identifies the workflow shape", () => {
  const { plan } = normalizePlan(heuristicPlan("Analyze the Indian EV market and compare the top 5 companies."));
  assert.equal(workflowSignature(plan), "competitive_analysis+data_analysis+report_generation+web_research");
});
