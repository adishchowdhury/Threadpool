import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAgentAccess, partitionByAccess, canViewAgent, evaluatePublish, effectiveVisibility } from "@/lib/discovery/access";
import { buildTaskContract, evaluateContract } from "@/lib/manager/contract";

const certified = { id: "c", visibility: "CERTIFIED" as const, isExternal: false, providerId: null };
const finovaPrivate = { id: "f", visibility: "PRIVATE" as const, isExternal: true, providerId: "finova" };
const market = { id: "m", visibility: "MARKETPLACE" as const, isExternal: true, providerId: "devco" };
const legacyExternal = { id: "l", visibility: null, isExternal: true, providerId: "finova" };

test("legacy rows: built-ins are certified, external agents fail closed to private", () => {
  assert.equal(effectiveVisibility({ isExternal: false }), "CERTIFIED");
  assert.equal(effectiveVisibility(legacyExternal), "PRIVATE");
});

test("another org can never route to or view a private agent", () => {
  const acme = { organizationId: "acme", dataSensitivity: "PUBLIC" as const };
  assert.deepEqual(evaluateAgentAccess(finovaPrivate, acme), { allowed: false, reason: "NOT_VISIBLE" });
  assert.deepEqual(evaluateAgentAccess(legacyExternal, acme), { allowed: false, reason: "NOT_VISIBLE" });
  assert.equal(canViewAgent(finovaPrivate, "acme"), false);
  assert.equal(canViewAgent(finovaPrivate, null), false);
  assert.equal(canViewAgent(finovaPrivate, "finova"), true);
});

test("certified and marketplace agents are visible to every org", () => {
  for (const org of ["acme", "finova", null]) {
    assert.equal(canViewAgent(certified, org), true);
    assert.equal(canViewAgent(market, org), true);
  }
});

test("data sensitivity: INTERNAL excludes third-party marketplace, SENSITIVE allows only own private agents", () => {
  const internal = { organizationId: "finova", dataSensitivity: "INTERNAL" as const };
  assert.equal(evaluateAgentAccess(certified, internal).allowed, true);
  assert.equal(evaluateAgentAccess(finovaPrivate, internal).allowed, true);
  assert.deepEqual(evaluateAgentAccess(market, internal), { allowed: false, reason: "DATA_SENSITIVITY" });

  const sensitive = { organizationId: "finova", dataSensitivity: "SENSITIVE" as const };
  assert.equal(evaluateAgentAccess(finovaPrivate, sensitive).allowed, true);
  assert.deepEqual(evaluateAgentAccess(certified, sensitive), { allowed: false, reason: "DATA_SENSITIVITY" });
  assert.deepEqual(evaluateAgentAccess(market, sensitive), { allowed: false, reason: "DATA_SENSITIVITY" });
});

test("partitionByAccess reports real excluded counts", () => {
  const out = partitionByAccess([certified, finovaPrivate, market], { organizationId: "acme", dataSensitivity: "INTERNAL" });
  assert.deepEqual(out.accessible.map((a) => a.id), ["c"]);
  assert.deepEqual(out.excluded, { notVisible: 1, dataSensitivity: 1 });
});

test("publishing requires Kraven calibration, not provider claims", () => {
  assert.equal(evaluatePublish({ isExternal: false, lifecycleStatus: "ACTIVE", status: "ACTIVE", sampleCount: 5 }).ok, false);
  assert.equal(evaluatePublish({ isExternal: true, lifecycleStatus: "PENDING", status: "INACTIVE", sampleCount: 0 }).ok, false);
  assert.equal(evaluatePublish({ isExternal: true, lifecycleStatus: "ACTIVE", status: "ACTIVE", sampleCount: 0 }).ok, false);
  assert.equal(evaluatePublish({ isExternal: true, lifecycleStatus: "ACTIVE", status: "ACTIVE", sampleCount: 3 }).ok, true);
});

const subtasks = [
  { type: "market_research", requiredCapability: "market_research", description: "size market" },
  { type: "web_research", requiredCapability: "web_research", description: "find sources" },
  { type: "report", requiredCapability: "report_generation", description: "write" },
];
const contract = buildTaskContract({ objective: "EV market", subtasks, qualityThreshold: 80, budget: 50, deadline: null, dataSensitivity: "PUBLIC" });

test("contract: satisfied only when every requirement, quality, budget and evidence hold", () => {
  const ok = evaluateContract(contract, {
    subtasks: subtasks.map((s) => ({ type: s.type, status: "DONE" })),
    qualityScore: 91, budgetUsed: 30, finishedAt: new Date(), sourceCount: 4,
  });
  assert.equal(ok.satisfied, true);
  assert.equal(ok.requirementsCompleted, 3);
  assert.equal(ok.deadlineMet, null);

  const bad = evaluateContract(contract, {
    subtasks: [{ type: "market_research", status: "DONE" }, { type: "web_research", status: "FAILED" }, { type: "report", status: "DONE" }],
    qualityScore: 70, budgetUsed: 60, finishedAt: new Date(), sourceCount: 0,
  });
  assert.equal(bad.satisfied, false);
  assert.equal(bad.requirementsCompleted, 2);
  assert.equal(bad.qualityMet, false);
  assert.equal(bad.budgetMet, false);
  assert.equal(bad.evidenceMet, false);
  assert.equal(bad.unmet.length, 4);
});

test("contract: deadline is enforced when set", () => {
  const c = buildTaskContract({ objective: "x", subtasks, qualityThreshold: 50, budget: 50, deadline: new Date("2026-01-01T00:00:00Z"), dataSensitivity: "PUBLIC" });
  const late = evaluateContract(c, { subtasks: [], qualityScore: 100, budgetUsed: 0, finishedAt: new Date("2026-01-02T00:00:00Z"), sourceCount: 1 });
  assert.equal(late.deadlineMet, false);
});

test("user-approved agents pass the sensitivity rule but never bypass tenant isolation", () => {
  const scope = { organizationId: "finova", dataSensitivity: "SENSITIVE" as const, approvedAgentIds: ["c", "m", "f"] };
  assert.equal(evaluateAgentAccess(certified, scope).allowed, true);
  assert.equal(evaluateAgentAccess(market, scope).allowed, true);
  // Another org's private agent stays excluded even if its id is in the list.
  const acme = { ...scope, organizationId: "acme" };
  assert.deepEqual(evaluateAgentAccess(finovaPrivate, acme), { allowed: false, reason: "NOT_VISIBLE" });
  // Not approved -> still blocked.
  assert.deepEqual(evaluateAgentAccess(market, { ...scope, approvedAgentIds: ["c"] }), { allowed: false, reason: "DATA_SENSITIVITY" });
  const out = partitionByAccess([certified, market], { organizationId: "finova", dataSensitivity: "INTERNAL", approvedAgentIds: ["m"] });
  assert.deepEqual(out.accessible.map((a) => a.id), ["c", "m"]);
});
