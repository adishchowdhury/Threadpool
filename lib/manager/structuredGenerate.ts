import { generateText } from "ai";
import { z } from "zod";
import { geminiModel } from "@/lib/manager/gemini";

// Gemma models (unlike Gemini) don't support the Generative Language API's
// native responseSchema/JSON mode, so `ai`'s generateObject always falls
// back to prompt-based JSON — and Gemma reliably wraps that JSON in a
// closing ``` fence, which breaks strict parsing. Ask for raw JSON directly
// via generateText, strip any fence, then validate through the same Zod
// schema the rest of the app trusts for model output.
//
// The prompt MUST spell out the literal expected JSON shape: earlier this
// only described the task in prose (no field names), so the model
// reasonably invented its own key names (e.g. "task"/"capability" instead
// of "type"/"requiredCapability"), Zod validation failed on every call, and
// every caller silently fell back to its local heuristic — invisibly,
// since callers only catch-and-fallback with no logging. Embedding the
// real schema keeps this in sync with schemas.ts automatically.
export async function generateStructured<T extends z.ZodType>(params: {
  schema: T;
  prompt: string;
}): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(params.schema);

  const { text } = await generateText({
    model: geminiModel(),
    prompt: `${params.prompt}\n\nRespond with ONLY a raw JSON object matching exactly this JSON Schema — the same field names, nesting, and types, no extra or missing fields, no markdown code fences, no commentary:\n\n${JSON.stringify(jsonSchema)}`,
  });

  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  return params.schema.parse(JSON.parse(cleaned));
}
