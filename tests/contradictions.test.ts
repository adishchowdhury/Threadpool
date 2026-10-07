import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFigureClaims, findContradictions, describeContradiction } from "@/lib/manager/contradictions";
import { inferDomain } from "@/lib/manager/domain";
import { blendHistory, NO_HISTORY_SCORE } from "@/lib/manager/scoring";
import { arenaRank, strengthsAndWeaknesses, summarize, summarizeBy } from "@/lib/agents/profile";

test("extracts labelled figures with scale and unit", () => {
  const c = extractFigureClaims("The India EV charging market size is $4.5 billion. Annual growth rate: 22%.");
  const size = c.find((x) => x.label.includes("market size"));
  assert.equal(size?.value, 4.5e9);
  assert.equal(size?.unit, "money");
  assert.equal(c.find((x) => x.unit === "%")?.value, 22);
});

test("flags a material disagreement on the same quantity", () => {
  const out = findContradictions("Our market size is $9 billion.", [{ type: "market_research", output: "The market size is $4 billion." }]);
  assert.equal(out.length, 1);
  assert.match(describeContradiction(out[0]), /market_research/);
});

test("does not flag rounding-level differences, different quantities, or different units", () => {
  assert.equal(findContradictions("Market size is $4.2 billion.", [{ type: "a", output: "Market size is $4 billion." }]).length, 0);
  assert.equal(findContradictions("Funding volume is $9 billion.", [{ type: "a", output: "Market size is $4 billion." }]).length, 0);
  assert.equal(findContradictions("Market size is 30%.", [{ type: "a", output: "Market size is $4 billion." }]).length, 0);
  assert.equal(findContradictions("No figures here.", [{ type: "a", output: "Market size is $4 billion." }]).length, 0);
});

test("domain inference is deterministic and defaults to general", () => {
  assert.equal(inferDomain("Should we enter the Indian EV charging market?"), "ev_mobility");
  assert.equal(inferDomain("Analyze the fintech payments landscape"), "fintech");
  assert.equal(inferDomain("Write a poem"), "general");
});

test("blendHistory averages task-type and domain experience", () => {
  assert.equal(blendHistory(null, null), NO_HISTORY_SCORE);
  assert.equal(blendHistory(80, null), 80);
  assert.equal(blendHistory(100, 60), 80);
});

test("profile separates strengths and weaknesses by measured domain quality", () => {
  const samples = [
    ...[90, 94].map((q) => ({ capability: "x", qa: q, latencyMs: 1000, cost: 2, success: true, domain: "fintech" })),
    ...[60, 64].map((q) => ({ capability: "x", qa: q, latencyMs: 1000, cost: 2, success: true, domain: "energy" })),
    { capability: "x", qa: 80, latencyMs: 1000, cost: 2, success: true, domain: "saas" },
  ];
  const sw = strengthsAndWeaknesses(summarize(samples), summarizeBy(samples, "domain"));
  assert.deepEqual(sw.strongIn, ["fintech"]);
  assert.deepEqual(sw.weakIn, ["energy"]); // saas has too few samples to judge
});

test("arena ranks per dimension and excludes unmeasured agents", () => {
  const e = (agentId: string, samples: number, q: number, sr: number, lat: number, price: number) => ({ agentId, name: agentId, samples, avgQuality: q, successRate: sr, medianLatencyMs: lat, price });
  const pool = [e("x", 5, 96, 0.95, 20000, 5), e("y", 5, 94, 0.98, 30000, 2), e("z", 5, 91, 0.97, 8000, 1), e("new", 0, 0, 0, 0, 1)];
  assert.equal(arenaRank(pool, "quality")[0].agentId, "x");
  assert.equal(arenaRank(pool, "reliability")[0].agentId, "y");
  assert.equal(arenaRank(pool, "speed")[0].agentId, "z");
  assert.equal(arenaRank(pool, "value")[0].agentId, "z");
  assert.ok(!arenaRank(pool, "quality").some((r) => r.agentId === "new"));
});
