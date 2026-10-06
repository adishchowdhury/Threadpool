import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCredential, CREDENTIAL_OPERATIONS, type CredentialSnapshot } from "@/lib/economy/credentials";

// Exercises the pure, deterministic credential evaluator - the second,
// independent gate alongside the Circuit Breaker (circuitBreaker.test-style
// coverage). No DB: evaluateCredential takes an explicit snapshot and `now`,
// exactly like circuitBreaker.ts's evaluateTransaction takes plain numbers.

function makeCredential(overrides: Partial<CredentialSnapshot> = {}): CredentialSnapshot {
  return {
    id: "cred_1",
    taskId: "task_1",
    agentId: "agent_1",
    status: "ACTIVE",
    allowedOperations: JSON.stringify(CREDENTIAL_OPERATIONS),
    spent: 0,
    maxSpend: 8,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

test("allows an operation within the allowed set and under the spend ceiling", () => {
  const result = evaluateCredential(makeCredential(), { operation: "LOCK_ESCROW", amount: 5 });
  assert.equal(result.decision, "ALLOW");
});

test("denies when no credential exists", () => {
  const result = evaluateCredential(null, { operation: "LOCK_ESCROW", amount: 5 });
  assert.equal(result.decision, "DENY");
  if (result.decision === "DENY") assert.match(result.reason, /not found/);
});

test("denies an operation not in allowedOperations, independent of amount/budget", () => {
  const credential = makeCredential({ allowedOperations: JSON.stringify(["LOCK_ESCROW"]) });
  const result = evaluateCredential(credential, { operation: "RELEASE_ESCROW", amount: 1 });
  assert.equal(result.decision, "DENY");
  if (result.decision === "DENY") assert.match(result.reason, /not permitted/);
});

test("denies when spent + requested exceeds maxSpend - the rogue-agent scenario", () => {
  // Mirrors the §19/§21 demo: authorized 8, agent requests 10,000.
  const credential = makeCredential({ maxSpend: 8, spent: 0 });
  const result = evaluateCredential(credential, { operation: "RELEASE_ESCROW", amount: 10_000 });
  assert.equal(result.decision, "DENY");
  if (result.decision === "DENY") assert.match(result.reason, /exceeds credential ceiling/);
});

test("denies once cumulative spend would exceed the ceiling, even for a legitimate-looking request", () => {
  const credential = makeCredential({ maxSpend: 8, spent: 6 });
  const result = evaluateCredential(credential, { operation: "RELEASE_ESCROW", amount: 5 });
  assert.equal(result.decision, "DENY");
});

test("denies a REVOKED credential regardless of amount or operation", () => {
  const credential = makeCredential({ status: "REVOKED" });
  const result = evaluateCredential(credential, { operation: "LOCK_ESCROW", amount: 1 });
  assert.equal(result.decision, "DENY");
  if (result.decision === "DENY") assert.match(result.reason, /revoked/);
});

test("denies a CONSUMED credential", () => {
  const credential = makeCredential({ status: "CONSUMED" });
  const result = evaluateCredential(credential, { operation: "LOCK_ESCROW", amount: 1 });
  assert.equal(result.decision, "DENY");
});

test("lazily expires: an ACTIVE credential past its expiresAt is denied and flagged for persistence", () => {
  const credential = makeCredential({ status: "ACTIVE", expiresAt: new Date(Date.now() - 1000) });
  const result = evaluateCredential(credential, { operation: "LOCK_ESCROW", amount: 1 });
  assert.equal(result.decision, "DENY");
  if (result.decision === "DENY") {
    assert.match(result.reason, /expired/);
    assert.equal(result.expired, true);
  }
});

test("a not-yet-expired ACTIVE credential is unaffected by lazy expiry", () => {
  const credential = makeCredential({ status: "ACTIVE", expiresAt: new Date(Date.now() + 60_000) });
  const result = evaluateCredential(credential, { operation: "LOCK_ESCROW", amount: 1 });
  assert.equal(result.decision, "ALLOW");
});

test("evaluates against an explicit `now`, independent of the system clock", () => {
  const credential = makeCredential({ expiresAt: new Date(1_000_000) });
  const stillValid = evaluateCredential(credential, { operation: "LOCK_ESCROW", amount: 1 }, 500_000);
  const nowExpired = evaluateCredential(credential, { operation: "LOCK_ESCROW", amount: 1 }, 2_000_000);
  assert.equal(stillValid.decision, "ALLOW");
  assert.equal(nowExpired.decision, "DENY");
});

test("the credential gate is scoped per-operation: granting LOCK_ESCROW does not imply RELEASE_ESCROW", () => {
  const lockOnly = makeCredential({ allowedOperations: JSON.stringify(["LOCK_ESCROW"]) });
  assert.equal(evaluateCredential(lockOnly, { operation: "LOCK_ESCROW", amount: 1 }).decision, "ALLOW");
  assert.equal(evaluateCredential(lockOnly, { operation: "RELEASE_ESCROW", amount: 1 }).decision, "DENY");
});
