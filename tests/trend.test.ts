import { test } from "node:test";
import assert from "node:assert/strict";
import { qualityTrend } from "@/lib/agents/profile";

const mk = (at: number, qa: number) => ({ at, source: "production" as const, capability: "x", qa, latencyMs: 1, cost: 1, success: true });

test("quality trend compares older vs newer measured runs", () => {
  assert.equal(qualityTrend([mk(1, 70), mk(2, 72)]).direction, "insufficient_data");
  assert.equal(qualityTrend([mk(1, 70), mk(2, 72), mk(3, 85), mk(4, 90)]).direction, "improving");
  assert.equal(qualityTrend([mk(4, 60), mk(1, 90), mk(2, 88), mk(3, 62)]).direction, "declining");
  assert.equal(qualityTrend([mk(1, 80), mk(2, 81), mk(3, 80), mk(4, 82)]).direction, "steady");
});
