import { createGoogleGenerativeAI } from "@ai-sdk/google";

export function isGeminiConfigured() {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

export function geminiModel() {
  if (!isGeminiConfigured()) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
  }
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
  return google("gemini-3.1-flash-lite");
}
