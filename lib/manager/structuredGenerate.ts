import { generateText } from "ai";
import { z } from "zod";
import { sarvamModel, SARVAM_MAX_OUTPUT_TOKENS, SARVAM_LARGE_OUTPUT_TOKENS, SARVAM_CALL_TIMEOUT_MS, sarvamCallTimeoutMs, type SarvamModelTier } from "@/lib/manager/sarvam";
import { BRIEF_REASONING_NOTE } from "@/lib/capabilities/llm";
import { clampTimeout } from "@/lib/runtime/deadline";

// Sarvam reasoning models may emit <think> blocks and fenced JSON, so ask for
// raw JSON directly via generateText, strip any fence, then validate through the same Zod
// schema the rest of the app trusts for model output.
//
// The prompt MUST spell out the literal expected JSON shape: earlier this
// only described the task in prose (no field names), so the model
// reasonably invented its own key names (e.g. "task"/"capability" instead
// of "type"/"requiredCapability"), Zod validation failed on every call, and
// every caller silently fell back to its local heuristic - invisibly,
// since callers only catch-and-fallback with no logging. Embedding the
// real schema keeps this in sync with schemas.ts automatically.
export async function generateStructuredWithUsage<T extends z.ZodType>(params: {
  schema: T;
  prompt: string;
  // Worker runtimes run structured steps on the hired agent's own tier and
  // persona; Manager judgments (planning, QA) use the default.
  tier?: SarvamModelTier;
  system?: string | null;
  // For big structured deliverables (see SARVAM_LARGE_OUTPUT_TOKENS).
  largeOutput?: boolean;
}): Promise<{ object: z.infer<T>; usage: { inputTokens: number; outputTokens: number } }> {
  const jsonSchema = z.toJSONSchema(params.schema);
  const basePrompt = `${params.prompt}\n\nRespond with ONLY a raw JSON object matching exactly this JSON Schema - the same field names, nesting, and types, no extra or missing fields, no markdown code fences, no commentary:\n\n${JSON.stringify(jsonSchema)}`;

  const usage = { inputTokens: 0, outputTokens: 0 };
  let lastError: unknown;
  // Reasoning tiers can exhaust the output budget thinking and return
  // nothing, or run out mid-JSON; retry once asking for brief reasoning
  // (see lib/capabilities/llm.ts). Schema violations are not retried here -
  // callers have their own fallbacks for those.
  // The economy tier serves sarvam-105b-conversations, which hard-caps
  // output at SARVAM_MAX_OUTPUT_TOKENS (8192) regardless of what's
  // requested - asking it for SARVAM_LARGE_OUTPUT_TOKENS doesn't degrade
  // gracefully, it's a 400 ("max_tokens exceeds the maximum output length").
  // Only sarvam-105b (standard/premium) actually supports the larger budget.
  // No tier given resolves to "economy" too (sarvamModel()'s own default).
  const resolvedTier = params.tier ?? "economy";
  const maxOutputTokens = params.largeOutput && resolvedTier !== "economy" ? SARVAM_LARGE_OUTPUT_TOKENS : SARVAM_MAX_OUTPUT_TOKENS;

  for (let attempt = 0; attempt < 2; attempt++) {
    // Only attempt 0 gets the full tier/output-sized budget. The retry is
    // explicitly told to keep reasoning brief, so it should come back fast -
    // giving it the same long budget let a single stalled large-output,
    // high-effort call (e.g. the final integration review) burn up to
    // 2x150s, most of the whole task's serverless duration limit, on its own.
    const timeoutMs = clampTimeout(attempt === 0 ? sarvamCallTimeoutMs({ tier: params.tier, largeOutput: params.largeOutput }) : SARVAM_CALL_TIMEOUT_MS);
    let res: Awaited<ReturnType<typeof generateText>>;
    try {
      res = await generateText({
        model: sarvamModel(params.tier),
        // Judgments (QA, planning) should be repeatable, not sampled.
        temperature: 0,
        maxOutputTokens,
        abortSignal: AbortSignal.timeout(timeoutMs),
        ...(params.system ? { system: params.system } : {}),
        prompt: attempt === 0 ? basePrompt : basePrompt + BRIEF_REASONING_NOTE,
      });
    } catch (err) {
      // A timeout/abort used to throw straight out of this function,
      // skipping the retry below entirely and forcing the caller's catch
      // block to give up on structured output after a single slow call.
      // Give it the same second chance a truncated/empty JSON response gets.
      lastError = err;
      continue;
    }
    usage.inputTokens += res.usage.inputTokens ?? 0;
    usage.outputTokens += res.usage.outputTokens ?? 0;
    const cleaned = res.text
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    let json: unknown;
    try {
      json = JSON.parse(cleaned);
    } catch (err) {
      lastError = err; // empty or truncated output
      continue;
    }
    return { object: params.schema.parse(json), usage };
  }
  throw lastError instanceof Error ? lastError : new Error("structured generation returned no JSON");
}

export async function generateStructured<T extends z.ZodType>(params: { schema: T; prompt: string }): Promise<z.infer<T>> {
  return (await generateStructuredWithUsage(params)).object;
}
