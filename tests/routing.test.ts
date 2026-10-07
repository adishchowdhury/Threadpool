import { test } from "node:test";
import assert from "node:assert/strict";
import { filterCandidatesStaged } from "@/lib/manager/filter";
import { applyValuePreference, scoreCandidates } from "@/lib/manager/scoring";
import { evaluateTransaction } from "@/lib/economy/circuitBreaker";
import { CAPABILITY_IDS, CAPABILITY_CATALOG } from "@/lib/capabilities/catalog";
import type { DiscoverableAgent } from "@/lib/discovery/types";

function agent(id: string, price: number, quality: number, caps = ["competitive_analysis"]): DiscoverableAgent {
  return {
    id,
    name: id,
    role: null,
    capabilities: caps,
    price,
    endpoint: null,
    status: "ACTIVE",
    reputation: quality,
    successRate: quality / 100,
    avgQuality: quality,
    avgLatencyMs: 10_000,
    avgCost: price,
    totalJobs: 5,
    sampleCount: 5,
    isExternal: false,
    providerId: null,
    providerName: null,
  };
}

test("downstream reserve keeps budget for later steps", () => {
  const pool = [agent("premium", 9, 92), agent("standard", 4, 88)];
  const { eligible, stages } = filterCandidatesStaged(pool, 20, 80, /* spendCap */ 6);
  assert.deepEqual(eligible.map((a) => a.id), ["standard"]);
  assert.deepEqual(stages.find((s) => s.stage === "downstream reserve"), { stage: "downstream reserve", count: 1 });
});

test("reserve relaxes to the cheapest affordable agent instead of failing", () => {
  const pool = [agent("premium", 9, 92), agent("standard", 7, 88)];
  const { eligible, stages } = filterCandidatesStaged(pool, 20, 80, 5);
  assert.deepEqual(eligible.map((a) => a.id), ["standard"]);
  assert.equal(stages.find((s) => s.stage === "downstream reserve")?.relaxed, true);
});

test("no reserve stage when nothing needs to be held back", () => {
  const { stages } = filterCandidatesStaged([agent("a", 3, 90)], 20, 80);
  assert.ok(!stages.some((s) => s.stage === "downstream reserve"));
});

function rank(pool: DiscoverableAgent[]) {
  return scoreCandidates({ candidates: pool, prices: new Map(), requiredCapability: "competitive_analysis", history: new Map() })
    .map((s) => ({ agent: s.agent, bidAmount: s.price, scoreBreakdown: s.scoreBreakdown, totalScore: s.totalScore, explanation: "" }))
    .sort((a, b) => b.totalScore - a.totalScore);
}

test("premium agent is not hired when a cheaper one is near-equivalent", () => {
  // Make the premium slightly better overall but much more expensive.
  const premium = { ...agent("premium", 5, 93), avgLatencyMs: 9_000 };
  const standard = agent("standard", 4, 90);
  const ranked = rank([premium, standard]);
  const gap = ranked[0].totalScore - ranked[1].totalScore;
  const out = applyValuePreference(ranked, 80, Math.max(gap, 0.01));
  assert.equal(out[0].agent.id, "standard");
  assert.match(out[0].explanation, /Premium not required/);
});

test("premium agent is kept when the quality gap is real or the cheap one misses the bar", () => {
  const ranked = rank([agent("premium", 9, 95), agent("cheap", 2, 60)]);
  assert.equal(applyValuePreference(ranked, 80)[0].agent.id, ranked[0].agent.id);
});

test("Circuit Breaker authorizes escrow for every plannable capability, still blocks oversized requests", () => {
  for (const c of CAPABILITY_IDS) {
    assert.deepEqual(evaluateTransaction({ amount: 4, purpose: c, taskRemainingBudget: 50, agentStatus: "ACTIVE", escrowAvailable: 50 }), { decision: "APPROVE" }, c);
  }
  assert.equal(evaluateTransaction({ amount: 10_000, purpose: "web_research", taskRemainingBudget: 8, agentStatus: "ACTIVE", escrowAvailable: 8 }).decision, "BLOCK");
  assert.equal(evaluateTransaction({ amount: 2, purpose: "unbounded_payment_request", taskRemainingBudget: 8, agentStatus: "ACTIVE", escrowAvailable: 8 }).decision, "BLOCK");
});

test("Circuit Breaker: a demoted agent can't be hired but is paid escrow it already earned; a revoked one gets nothing", () => {
  const base = { amount: 4, purpose: "web_research", taskRemainingBudget: 50, escrowAvailable: 4 };
  assert.equal(evaluateTransaction({ ...base, agentStatus: "INACTIVE" }).decision, "BLOCK", "lock defaults to the strict rule");
  assert.equal(evaluateTransaction({ ...base, agentStatus: "INACTIVE", operation: "LOCK" }).decision, "BLOCK");
  assert.equal(evaluateTransaction({ ...base, agentStatus: "INACTIVE", operation: "RELEASE" }).decision, "APPROVE");
  assert.equal(evaluateTransaction({ ...base, agentStatus: "REVOKED", operation: "RELEASE" }).decision, "BLOCK");
  assert.equal(evaluateTransaction({ ...base, agentStatus: "REVOKED", operation: "LOCK" }).decision, "BLOCK");
  // Paying a demoted agent never relaxes the amount checks.
  assert.equal(evaluateTransaction({ ...base, amount: 5, agentStatus: "INACTIVE", operation: "RELEASE" }).decision, "BLOCK");
  assert.equal(evaluateTransaction({ ...base, amount: 10_000, agentStatus: "INACTIVE", operation: "RELEASE" }).decision, "BLOCK");
});

test("every capability lists only tools that exist", async () => {
  const { TOOL_REGISTRY } = await import("@/lib/tools/registry");
  for (const c of CAPABILITY_IDS) for (const t of CAPABILITY_CATALOG[c].tools) assert.ok(TOOL_REGISTRY.has(t), `${c} -> ${t}`);
});
