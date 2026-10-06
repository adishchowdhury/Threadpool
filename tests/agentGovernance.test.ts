import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFailureStreak, CONSECUTIVE_FAILURE_DEMOTION_THRESHOLD } from "@/lib/economy/reputation";

// Pure, deterministic rolling-failure-rate demotion logic - no DB, mirroring
// circuitBreaker.ts's style. Called after every subtask attempt (success or
// failure) via lib/economy/reputation.ts's recordPerformanceAndUpdateReputation.

test("a success resets the streak to zero regardless of its prior value", () => {
  const outcome = evaluateFailureStreak({ consecutiveFailures: 2, status: "ACTIVE", success: true });
  assert.equal(outcome.consecutiveFailures, 0);
  assert.equal(outcome.demote, false);
});

test("a single failure increments the streak but does not demote", () => {
  const outcome = evaluateFailureStreak({ consecutiveFailures: 0, status: "ACTIVE", success: false });
  assert.equal(outcome.consecutiveFailures, 1);
  assert.equal(outcome.demote, false);
});

test(`reaching the threshold (${CONSECUTIVE_FAILURE_DEMOTION_THRESHOLD}) while ACTIVE triggers demotion`, () => {
  const outcome = evaluateFailureStreak({
    consecutiveFailures: CONSECUTIVE_FAILURE_DEMOTION_THRESHOLD - 1,
    status: "ACTIVE",
    success: false,
  });
  assert.equal(outcome.consecutiveFailures, CONSECUTIVE_FAILURE_DEMOTION_THRESHOLD);
  assert.equal(outcome.demote, true);
});

test("an already-INACTIVE agent is never re-demoted by this rule (nothing further to demote)", () => {
  const outcome = evaluateFailureStreak({
    consecutiveFailures: CONSECUTIVE_FAILURE_DEMOTION_THRESHOLD + 5,
    status: "INACTIVE",
    success: false,
  });
  assert.equal(outcome.demote, false, "the streak still climbs, but an INACTIVE agent has no ACTIVE status to drop from");
});

test("a REVOKED agent is never touched by rolling demotion (permanent, separate from the Circuit Breaker's revoke)", () => {
  const outcome = evaluateFailureStreak({ consecutiveFailures: 10, status: "REVOKED", success: false });
  assert.equal(outcome.demote, false);
});

test("the streak climbs monotonically across repeated failures until it crosses the threshold exactly once", () => {
  // Mirrors applyFailureRateGovernance's real DB write: once demoted, the
  // agent's actual status becomes INACTIVE, so this rule has nothing left
  // to demote on subsequent failures - it is not re-evaluated forever.
  let state: { consecutiveFailures: number; status: "ACTIVE" | "INACTIVE" } = { consecutiveFailures: 0, status: "ACTIVE" };
  const demotions: number[] = [];
  for (let i = 1; i <= 5; i++) {
    const outcome = evaluateFailureStreak({ ...state, success: false });
    if (outcome.demote) demotions.push(i);
    state = { consecutiveFailures: outcome.consecutiveFailures, status: outcome.demote ? "INACTIVE" : state.status };
  }
  assert.deepEqual(demotions, [CONSECUTIVE_FAILURE_DEMOTION_THRESHOLD], "demotion fires exactly at the threshold crossing, not before or repeatedly after");
});

test("a recovery (success) between failures resets progress toward the threshold", () => {
  let outcome = evaluateFailureStreak({ consecutiveFailures: 0, status: "ACTIVE", success: false });
  outcome = evaluateFailureStreak({ consecutiveFailures: outcome.consecutiveFailures, status: "ACTIVE", success: false });
  // One success right before the threshold should reset the climb.
  outcome = evaluateFailureStreak({ consecutiveFailures: outcome.consecutiveFailures, status: "ACTIVE", success: true });
  assert.equal(outcome.consecutiveFailures, 0);

  outcome = evaluateFailureStreak({ consecutiveFailures: outcome.consecutiveFailures, status: "ACTIVE", success: false });
  outcome = evaluateFailureStreak({ consecutiveFailures: outcome.consecutiveFailures, status: "ACTIVE", success: false });
  assert.equal(outcome.demote, false, "the reset streak needs its own full run to threshold, not credit from before the reset");
});
