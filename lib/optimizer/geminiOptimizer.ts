import { generateText } from "ai";
import { geminiModel, isGeminiConfigured } from "../manager/gemini";
import { PromptOptimizer, PromptOptimizationInput, OptimizedTask, optimizedTaskSchema } from "./types";

export class GeminiPromptOptimizer implements PromptOptimizer {
  async optimize(input: PromptOptimizationInput): Promise<OptimizedTask> {
    if (!isGeminiConfigured()) {
      throw new Error("Gemini API key not configured for fallback.");
    }

    const systemPrompt = `You are an expert Prompt Optimization Engine. Your task is to transform a vague or ambiguous user prompt into a strictly structured task specification JSON matching the requested schema.
Ensure you detect all ambiguities and constraints. Do not hallucinate values. If a constraint is missing, list it under ambiguities.`;

    const userPrompt = `Optimize the following user prompt: "${input.prompt}"`;

    const response = await generateText({
      model: geminiModel(),
      system: systemPrompt + "\nYour response must start with '{' and end with '}' and be a valid JSON object. No explanations or markdown formatting.",
      prompt: userPrompt,
    });

    const parsed = JSON.parse(response.text.trim());
    return optimizedTaskSchema.parse(parsed);
  }
}
