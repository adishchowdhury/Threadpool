import { test } from "node:test";
import assert from "node:assert/strict";
import { verifySubtaskOutput } from "@/lib/manager/qa";

// These tests run without SARVAM_API_KEY set, so verifySubtaskOutput always
// resolves through the deterministic rubric/local-fallback path - no network
// calls, no flakiness.

test("fallback QA: empty output fails", async () => {
  const { verdict } = await verifySubtaskOutput({
    type: "report_generation",
    description: "write a report",
    output: "",
    qualityThreshold: 70,
  });
  assert.equal(verdict.passed, false);
});

test("fallback QA: very short output fails", async () => {
  const { verdict } = await verifySubtaskOutput({
    type: "report_generation",
    description: "write a report",
    output: "Too short.",
    qualityThreshold: 70,
  });
  assert.equal(verdict.passed, false);
});

test("fallback QA: obvious error output fails", async () => {
  const output = "[EXECUTION ERROR] Agent agent_1 failed to execute: connection timed out after waiting for the upstream service to respond";
  const { verdict } = await verifySubtaskOutput({
    type: "report_generation",
    description: "write a report",
    output,
    qualityThreshold: 70,
  });
  assert.equal(verdict.passed, false);
});

test("fallback QA: long but repetitive/meaningless output fails despite its length", async () => {
  const output = Array(80).fill("market liquidity market liquidity banana liquidity").join(" ");
  assert.ok(output.length > 150, "sanity: this is long enough to have fooled the old length-based heuristic");
  const { verdict } = await verifySubtaskOutput({
    type: "report_generation",
    description: "write a report",
    output,
    qualityThreshold: 70,
  });
  assert.equal(verdict.passed, false, "repetitive filler must not pass merely because it is long");
});

test("fallback QA: reasonable substantive output can pass at the default demo threshold", async () => {
  const output =
    "The fintech market shows strong growth across three segments: digital lending, payments infrastructure, and wealthtech. " +
    "Digital lending platforms have expanded loan origination volume by double digits year over year, driven by improved underwriting models. " +
    "Payments infrastructure providers are consolidating around a handful of API-first platforms that reduce integration time for merchants. " +
    "Wealthtech products are gaining share among younger investors who prefer low-fee, app-based portfolio management. " +
    "Key financial metrics across the segments suggest healthy unit economics, though customer acquisition costs remain elevated in payments. " +
    "Overall, the sector presents several promising investment opportunities for allocators willing to tolerate near-term volatility.";
  const { verdict } = await verifySubtaskOutput({
    type: "report_generation",
    description: "produce a fintech market report",
    output,
    qualityThreshold: 80,
  });
  assert.equal(verdict.passed, true);
});

test("fallback QA never claims a passing score reflects verified correctness", async () => {
  const output = "A perfectly coherent, well-formed, plausible-sounding paragraph that happens to answer the wrong question entirely but reads fine on its own, with enough length and sentence variety to clear every structural bar Kraven's deterministic fallback can check for.";
  const { verdict } = await verifySubtaskOutput({
    type: "report_generation",
    description: "produce a fintech market report",
    output,
    qualityThreshold: 80,
  });
  // Deterministic heuristics cannot verify semantic correctness - this only
  // asserts the verdict is honest about that, not that it rejects the output.
  assert.match(verdict.reason, /semantic correctness was not verified/);
});
