import { generateText } from "ai";
import type { z } from "zod";
import { geminiModel } from "@/lib/manager/gemini";

// Gemma models (unlike Gemini) don't support the Generative Language API's
// native responseSchema/JSON mode, so `ai`'s generateObject always falls
// back to prompt-based JSON — and Gemma reliably wraps that JSON in a
// closing ``` fence, which breaks strict parsing. Ask for raw JSON directly
// via generateText, strip any fence, then validate through the same Zod
// schema the rest of the app trusts for model output.
export async function generateStructured<T extends z.ZodType>(params: {
  schema: T;
  prompt: string;
}): Promise<z.infer<T>> {
  const { text } = await generateText({
    model: geminiModel(),
    prompt: `${params.prompt}\n\nRespond with ONLY the raw JSON object — no markdown code fences, no commentary, no leading or trailing text.`,
  });

  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  return params.schema.parse(JSON.parse(cleaned));
}
