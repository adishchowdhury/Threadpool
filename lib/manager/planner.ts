import { generateObject } from "ai";
import { taskPlanSchema, type TaskPlan } from "@/lib/manager/schemas";
import { geminiModel, isGeminiConfigured } from "@/lib/manager/gemini";

// Deterministic local fallback — used when Gemini is unconfigured or the
// call fails. Clearly labeled as a fallback everywhere it surfaces (events,
// UI), per the "never fake an external call" rule.
function fallbackPlan(prompt: string): TaskPlan {
  return {
    summary: prompt.length > 140 ? `${prompt.slice(0, 137)}...` : prompt,
    subtasks: [
      {
        type: "market_research",
        requiredCapability: "market_research",
        description: `Research the market context for: ${prompt}`,
        sequence: 0,
        dependsOnSequence: [],
      },
      {
        type: "financial_analysis",
        requiredCapability: "financial_analysis",
        description: `Estimate key financial metrics relevant to: ${prompt}`,
        sequence: 1,
        dependsOnSequence: [0],
      },
      {
        type: "report_writing",
        requiredCapability: "report_generation",
        description: `Write an investment-style report synthesizing the research and financial analysis for: ${prompt}`,
        sequence: 2,
        dependsOnSequence: [0, 1],
      },
      {
        type: "quality_review",
        requiredCapability: "quality_verification",
        description: `Verify the report is complete, accurate, and well-structured.`,
        sequence: 3,
        dependsOnSequence: [2],
      },
    ],
  };
}

export async function decomposeTask(params: {
  prompt: string;
  budget: number;
}): Promise<{ plan: TaskPlan; source: "gemini" | "local_fallback" }> {
  if (!isGeminiConfigured()) {
    return { plan: fallbackPlan(params.prompt), source: "local_fallback" };
  }

  try {
    const { object } = await generateObject({
      model: geminiModel(),
      schema: taskPlanSchema,
      prompt: `You are the Manager Agent for Momentum, an autonomous AI workforce optimizer.
Decompose the following user task into 2-5 concrete subtasks, each requiring exactly one capability
from this fixed list: market_research, financial_analysis, data_extraction, writing, report_generation,
summarization, quality_verification, review.

Always include exactly one quality_verification subtask as the final step, depending on all
content-producing subtasks before it.

User task: "${params.prompt}"
Hard token budget: ${params.budget}

Keep the plan lean — the fewer subtasks that still cover the task well, the better, since each one costs tokens.`,
    });
    return { plan: object, source: "gemini" };
  } catch {
    return { plan: fallbackPlan(params.prompt), source: "local_fallback" };
  }
}
