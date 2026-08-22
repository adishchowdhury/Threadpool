import { generateText } from "ai";
import { geminiModel, isGeminiConfigured } from "@/lib/manager/gemini";

function fallbackOutput(params: { type: string; description: string; taskPrompt: string; feedback?: string }): string {
  const header = `[LOCAL FALLBACK OUTPUT — Gemini unavailable]`;
  const feedbackNote = params.feedback ? `\nAddressing prior QA feedback: ${params.feedback}` : "";
  return (
    `${header}\n\n` +
    `## ${params.type.replace(/_/g, " ").toUpperCase()}\n\n` +
    `Task: ${params.taskPrompt}\n` +
    `Instruction: ${params.description}${feedbackNote}\n\n` +
    `This is a deterministic placeholder result standing in for a real ${params.type} deliverable. ` +
    `It demonstrates the workflow's structure (input -> execution -> output) without a live model call. ` +
    `In a fully configured run, this section would contain substantive ${params.type.replace(/_/g, " ")} content ` +
    `addressing the task above in detail, with concrete figures, findings, and reasoning.`
  );
}

// Thin, constrained wrapper around a Gemini call — one fixed prompt shape
// per worker, so the demo path stays predictable. Falls back to a clearly
// labeled deterministic placeholder if Gemini is unconfigured or errors.
export async function executeSubtask(params: {
  type: string;
  description: string;
  taskPrompt: string;
  feedback?: string;
}): Promise<{ output: string; actualLatencyMs: number; source: "gemini" | "local_fallback" }> {
  const start = Date.now();

  if (!isGeminiConfigured()) {
    return { output: fallbackOutput(params), actualLatencyMs: Date.now() - start, source: "local_fallback" };
  }

  try {
    const feedbackBlock = params.feedback
      ? `\n\nA previous attempt at this subtask FAILED quality review for this reason: "${params.feedback}". Address that specifically in this attempt.`
      : "";

    const { text } = await generateText({
      model: geminiModel(),
      prompt: `You are a specialized AI worker agent hired by Momentum's Manager Agent.
Your capability: ${params.type}.
Overall task: "${params.taskPrompt}"
Your specific instruction: ${params.description}${feedbackBlock}

Produce a concise, well-structured deliverable (markdown, a few paragraphs) for exactly this subtask. Do not solve the whole task — only your part.`,
    });
    return { output: text, actualLatencyMs: Date.now() - start, source: "gemini" };
  } catch {
    return { output: fallbackOutput(params), actualLatencyMs: Date.now() - start, source: "local_fallback" };
  }
}
