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
