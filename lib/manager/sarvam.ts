import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function isSarvamConfigured() {
  return Boolean(process.env.SARVAM_API_KEY);
}

// Sarvam's chat endpoint only serves sarvam-105b (128K ctx, reasoning) and
// sarvam-105b-conversations (32K ctx, tuned for fast real-time dialogue).
// Tiers back the local agent registry's pricing: a higher-priced agent
// genuinely runs with more reasoning effort (slower, costlier, more
// thorough), not just a bigger number. Keep in sync with REGISTRY_AGENTS'
// `model` field in lib/db/reset.ts.
export const SARVAM_MODEL_TIERS = {
  economy: { model: "sarvam-105b-conversations", reasoningEffort: null },
  standard: { model: "sarvam-105b", reasoningEffort: "low" },
  premium: { model: "sarvam-105b", reasoningEffort: "high" },
} as const;

export type SarvamModelTier = keyof typeof SARVAM_MODEL_TIERS;

// generateText() has no default timeout: an LLM call that the gateway
// never closes (a dropped connection it keeps "open", a stalled stream) used
// to hang for the rest of the serverless invocation's lifetime, stalling the
// whole task until the platform's own hard execution limit killed the
// function mid-await - which looked in production like a task stuck "in
// progress" for minutes before failing with no diagnosable reason. Every
// Sarvam call is bounded by this so a stall surfaces as an ordinary caught
// error within seconds, letting the existing retry/reassignment and
// local-fallback paths (worker.ts, structuredGenerate.ts) handle it like any
// other failed attempt.
export const SARVAM_CALL_TIMEOUT_MS = 45_000;

// A flat 45s budget is enough for an economy-tier call, but it was cutting
// off "reasoning_effort: high" calls (the premium tier) and large-output
// calls (SARVAM_LARGE_OUTPUT_TOKENS, e.g. the final integration review)
// before the model could realistically finish - a 16K-token, high-effort
// generation routinely needs well over 45s. The abort was firing as
// designed, but the result was premium-tier agents and the review step
// systematically producing "[EXECUTION ERROR]"/placeholder output on every
// attempt (never a genuine provider outage), burning through
// retry/reassignment attempts and driving total task time up instead of
// down. Size the budget to what the call actually asked for instead.
export function sarvamCallTimeoutMs(params: { tier?: SarvamModelTier; largeOutput?: boolean } = {}): number {
  const spec = SARVAM_MODEL_TIERS[params.tier ?? "economy"] ?? SARVAM_MODEL_TIERS.economy;
  if (spec.reasoningEffort === "high") return params.largeOutput ? 150_000 : 100_000;
  if (spec.reasoningEffort === "low") return 70_000;
  return SARVAM_CALL_TIMEOUT_MS;
}

export function sarvamModel(tier: SarvamModelTier = "economy") {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error("SARVAM_API_KEY is not set");
  }
  const spec = SARVAM_MODEL_TIERS[tier] ?? SARVAM_MODEL_TIERS.economy;
  const sarvam = createOpenAICompatible({
    name: "sarvam",
    baseURL: "https://api.sarvam.ai/v1",
    // Sarvam's docs list both headers on the chat endpoint.
    headers: { Authorization: `Bearer ${apiKey}`, "api-subscription-key": apiKey },
    transformRequestBody: (body) =>
      spec.reasoningEffort ? { ...body, reasoning_effort: spec.reasoningEffort } : body,
  });
  return sarvam(spec.model);
}

// Sarvam's default completion budget (2048 tokens) is shared with the
// reasoning trace, so reasoning tiers can spend all of it thinking and
// return an empty answer. Give every call enough headroom for both.
export const SARVAM_MAX_OUTPUT_TOKENS = 8192;

// Large structured deliverables (a multi-competitor comparison, a full
// review) plus a reasoning trace can exceed the default; verified that the
// API accepts this ceiling. Only billed for tokens actually produced.
export const SARVAM_LARGE_OUTPUT_TOKENS = 16384;

// Sarvam's published pay-as-you-go rates for sarvam-105b, in INR per 1M
// tokens (https://www.sarvam.ai/api-pricing, checked 2026-10-05). The page
// lists only the 105B model, so sarvam-105b-conversations is priced at the
// same rate here - confirm against your Sarvam invoice. Reasoning tokens are
// counted in output tokens.
export const SARVAM_PRICING_INR_PER_M_TOKENS = { input: 29.28, output: 73.2 } as const;

export function sarvamCostInr(usage: { inputTokens: number; outputTokens: number }): number {
  return (
    (usage.inputTokens * SARVAM_PRICING_INR_PER_M_TOKENS.input + usage.outputTokens * SARVAM_PRICING_INR_PER_M_TOKENS.output) /
    1_000_000
  );
}
