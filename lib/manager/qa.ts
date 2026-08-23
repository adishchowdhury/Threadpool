import { qaVerdictSchema, type QaVerdict } from "@/lib/manager/schemas";
import { isGeminiConfigured } from "@/lib/manager/gemini";
import { generateStructured } from "@/lib/manager/structuredGenerate";

// Deterministic rubric — always runs, independent of any LLM.
function rubricCheck(output: string): { passed: boolean; reason: string | null } {
  if (output.trim().length < 40) {
    return { passed: false, reason: "output too short to be a substantive deliverable" };
  }
  return { passed: true, reason: null };
}

function fallbackVerdict(output: string, qualityThreshold: number): QaVerdict {
  const rubric = rubricCheck(output);
  const score = rubric.passed ? Math.min(95, 60 + Math.floor(output.length / 20)) : 20;
  return {
    passed: rubric.passed && score >= qualityThreshold,
    score,
    reason: rubric.reason ?? `[LOCAL FALLBACK QA] length-based heuristic score ${score} vs threshold ${qualityThreshold}`,
  };
}

// QA is deliberately separate from the worker that produced the output.
// Combines a deterministic rubric (always applied) with a Gemini qualitative
// judgment when available. The Manager reads this verdict — never a raw
// model response — to decide pay/retry/reassign/terminate.
export async function verifySubtaskOutput(params: {
  type: string;
  description: string;
  output: string;
  qualityThreshold: number;
}): Promise<{ verdict: QaVerdict; source: "gemini" | "local_fallback" }> {
  const rubric = rubricCheck(params.output);
  if (!rubric.passed) {
    return { verdict: { passed: false, score: 15, reason: rubric.reason! }, source: "local_fallback" };
  }

  if (!isGeminiConfigured()) {
    return { verdict: fallbackVerdict(params.output, params.qualityThreshold), source: "local_fallback" };
  }

  try {
    const object = await generateStructured({
      schema: qaVerdictSchema,
      prompt: `You are Kraven's independent QA agent, separate from the worker that produced this output.
Judge whether the following output adequately fulfills its instruction. Score 0-100.
The quality threshold to PASS is ${params.qualityThreshold}.

Subtask capability: ${params.type}
Instruction: ${params.description}

Output to review:
"""
${params.output}
"""

Return passed=true only if score >= ${params.qualityThreshold} AND the output substantively addresses the instruction.`,
    });
    return { verdict: object, source: "gemini" };
  } catch (err) {
    console.error("[QA] Gemini quality review failed, using local fallback verdict:", err);
    return { verdict: fallbackVerdict(params.output, params.qualityThreshold), source: "local_fallback" };
  }
}
