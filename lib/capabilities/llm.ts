import { generateText } from "ai";
import { sarvamModel, SARVAM_MAX_OUTPUT_TOKENS, SARVAM_CALL_TIMEOUT_MS, type SarvamModelTier } from "@/lib/manager/sarvam";
import type { CapabilityRunInput } from "@/lib/capabilities/types";

export type Usage = { inputTokens: number; outputTokens: number };

export function addUsage(a: Usage | undefined, b: Usage | undefined): Usage {
  return { inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0), outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0) };
}

export function agentTier(input: Pick<CapabilityRunInput, "agent">): SarvamModelTier {
  const t = input.agent?.tier;
  return t === "economy" || t === "standard" || t === "premium" ? t : "economy";
}

// Sarvam's reasoning tiers sometimes spend the whole output budget thinking
// and return an empty answer. One retry with an explicit instruction to keep
// the reasoning short recovers almost all of these; usage of both calls is
// billed to the job.
export const BRIEF_REASONING_NOTE =
  "\n\nIMPORTANT: a previous attempt spent its entire output budget on reasoning and returned nothing. Keep your reasoning brief and write the answer.";

export async function generateWithReasoningGuard(params: { tier: SarvamModelTier; system?: string | null; prompt: string }): Promise<{ text: string; usage: Usage }> {
  let usage: Usage | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await generateText({
      model: sarvamModel(params.tier),
      maxOutputTokens: SARVAM_MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(SARVAM_CALL_TIMEOUT_MS),
      ...(params.system ? { system: params.system } : {}),
      prompt: attempt === 0 ? params.prompt : params.prompt + BRIEF_REASONING_NOTE,
    });
    usage = addUsage(usage, { inputTokens: res.usage.inputTokens ?? 0, outputTokens: res.usage.outputTokens ?? 0 });
    const text = res.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (text) return { text, usage };
  }
  return { text: "", usage: usage! };
}

// Free-text generation on the hired agent's model tier and persona.
export async function generateWorkerText(input: Pick<CapabilityRunInput, "agent">, prompt: string): Promise<{ text: string; usage: Usage }> {
  return generateWithReasoningGuard({ tier: agentTier(input), system: input.agent?.systemPrompt, prompt });
}

export function feedbackBlock(feedback?: string): string {
  return feedback
    ? `\n\nA previous version of this work was sent back by quality review for this reason: "${feedback}". Fix that specifically in this version.`
    : "";
}

// Sarvam's chat model is already multilingual; the only thing stopping it
// from answering in the user's own language is nobody telling it to. Shared
// by every worker-facing prompt so a task submitted (by voice or text) in
// Hindi, Tamil, Bengali, etc. gets a deliverable in that language rather than
// defaulting to English.
export const LANGUAGE_RULE =
  "Write your output in the same language the overall task is written in. If the task is in a language other than English, respond entirely in that language (not a translation appended after English) - do not switch to English unless the task itself is in English.";

export const MAX_UPSTREAM_CHARS = 9000;

export function upstreamBlock(upstream: CapabilityRunInput["upstream"]): string {
  if (upstream.length === 0) return "";
  return (
    "\n\nMaterial produced by earlier workers (your input - build on it, do not repeat it verbatim):\n" +
    upstream.map((u) => `--- ${u.type} ---\n${u.output.slice(0, MAX_UPSTREAM_CHARS)}`).join("\n\n")
  );
}
