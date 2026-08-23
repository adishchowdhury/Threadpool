import { createGoogleGenerativeAI } from "@ai-sdk/google";

export function isGeminiConfigured() {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

// Model tiers backing the local agent registry's pricing: a higher-priced
// agent genuinely runs a more capable (and slower/costlier) real model, not
// just a bigger number. Keep in sync with REGISTRY_AGENTS' `model` field in
// lib/db/reset.ts.
export const GEMINI_MODEL_TIERS = {
  economy: "gemini-3.1-flash-lite",
  standard: "gemini-3.5-flash",
  premium: "gemini-3.1-pro-preview",
} as const;

export type GeminiModelTier = keyof typeof GEMINI_MODEL_TIERS;

export function geminiModel(tier: GeminiModelTier = "economy") {
  if (!isGeminiConfigured()) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
  }
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
  return google(GEMINI_MODEL_TIERS[tier] ?? GEMINI_MODEL_TIERS.economy);
}
