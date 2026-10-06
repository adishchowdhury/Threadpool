import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTaskSanity } from "@/lib/manager/sanityCheck";

// These tests run without SARVAM_API_KEY set, so checkTaskSanity always
// resolves through the deterministic heuristic fallback - no network calls.

test("sanity check: accepts a coherent market-research task", async () => {
  const v = await checkTaskSanity("Research the Indian EV market");
  assert.equal(v.valid, true);
});

test("sanity check: accepts a coherent comparison task", async () => {
  const v = await checkTaskSanity("Compare PostgreSQL and MongoDB");
  assert.equal(v.valid, true);
});

test("sanity check: accepts a build/creative task", async () => {
  const v = await checkTaskSanity("Build a landing page for a SaaS product");
  assert.equal(v.valid, true);
});

test("sanity check: accepts the default fintech demo prompt", async () => {
  const v = await checkTaskSanity(
    "Analyze the fintech startup market, identify three promising segments, estimate key financial metrics, and produce a concise investment-style report.",
  );
  assert.equal(v.valid, true);
});

test("sanity check: rejects keyboard-mash gibberish", async () => {
  const v = await checkTaskSanity("asdfgh qwoeiur zzz");
  assert.equal(v.valid, false);
});

test("sanity check: rejects a bare greeting", async () => {
  const v = await checkTaskSanity("hello");
  assert.equal(v.valid, false);
});

// "I like pizza" / "do something" are coherent English, not gibberish - telling
// them apart from a real task requires understanding meaning, which the
// deterministic fallback explicitly does not attempt (see sanityCheck.ts);
// only the Sarvam-backed path can reject these. This documents that limit
// rather than asserting behavior the fallback cannot provide.
test("sanity check: deterministic fallback accepts well-formed but non-actionable text (documented limitation; Sarvam path rejects it)", async () => {
  const v = await checkTaskSanity("I like pizza");
  assert.equal(v.valid, true);
  assert.equal(v.source, "local_fallback");
});

test("sanity check: does not reject unusual-but-legitimate domain terms", async () => {
  const v = await checkTaskSanity("Summarize recent advances in CRISPR-Cas9 gene editing for oncology");
  assert.equal(v.valid, true);
});

test("sanity check source is reported as local_fallback without an API key", async () => {
  const v = await checkTaskSanity("Research the Indian EV market");
  assert.equal(v.source, "local_fallback");
});
