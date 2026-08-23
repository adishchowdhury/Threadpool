import fs from "fs";
import path from "path";
import { PromptOptimizer, PromptOptimizationInput, OptimizedTask } from "./types";
import { LocalPromptOptimizer } from "./localOptimizer";
import { GeminiPromptOptimizer } from "./geminiOptimizer";

export * from "./types";

export interface PreCheckResult {
  optimizationRequired: boolean;
  complexity: "low" | "high";
  reason: string[];
}

/**
 * Lightweight, cheap deterministic pre-check on the raw prompt.
 * Determines if we bypass or run the local Qwen3 optimizer.
 */
export function getOptimizationDecision(prompt: string): PreCheckResult {
  const p = prompt.trim().toLowerCase();
  const wordCount = p.split(/\s+/).length;

  // Trivial prompt bypass check
  const bypassKeywords = ["say", "hello", "hi", "birthday", "joke", "poem", "congratulate"];
  const isBypass = bypassKeywords.some(key => p.includes(key));

  if (isBypass) {
    return {
      optimizationRequired: false,
      complexity: "low",
      reason: ["simple creative / casual task"]
    };
  }

  const reasons: string[] = [];

  // Ambiguity / vague indicators
  const vagueIndicators = [
    "report on", "analyze", "make a", "find the", "write an app", "create a script", 
    "fintech", "market growth", "competitors", "investment"
  ];
  const matchedVague = vagueIndicators.filter(ind => p.includes(ind));

  // Complex task type indicators
  const complexityIndicators = [
    "compare", "optimize", "evaluate", "predict", "benchmark", "verify", "audit", "integrate"
  ];
  const matchedComplexity = complexityIndicators.filter(ind => p.includes(ind));

  // Short queries or vague generic goals
  if (wordCount <= 6) {
    reasons.push("short prompt length");
  }
  if (matchedVague.length > 0) {
    reasons.push(`vague indicators: ${matchedVague.join(", ")}`);
  }
  if (matchedComplexity.length > 0) {
    reasons.push(`complex requirements: ${matchedComplexity.join(", ")}`);
  }

  // Task heuristic decision
  const hasMultipleClauses = p.includes(",") || p.includes("and") || p.includes("then");
  if (hasMultipleClauses && wordCount > 10) {
    reasons.push("multiple clauses indicating subtasks");
  }

  // Completed checking requirements

  // If prompt is very long (highly detailed), bypass optimization unless it matches specific complexity keywords and doesn't look fully spec'd.
  if (wordCount > 25 && matchedComplexity.length === 0) {
    return {
      optimizationRequired: false,
      complexity: "high",
      reason: ["highly detailed prompt"]
    };
  }

  if (reasons.length > 0) {
    // A brief prompt is complex to solve because of high ambiguity, but we flag the prompt itself as simple task complexity unless it contains multiple clauses/complex requirements
    return {
      optimizationRequired: true,
      complexity: (wordCount > 12 || matchedComplexity.length > 0 || hasMultipleClauses) ? "high" : "low",
      reason: reasons
    };
  }

  return {
    optimizationRequired: false,
    complexity: "low",
    reason: ["clear structured task"]
  };
}

export function needsOptimization(prompt: string): boolean {
  return getOptimizationDecision(prompt).optimizationRequired;
}

export class PromptOptimizationRouter implements PromptOptimizer {
  private localOptimizer: LocalPromptOptimizer | null = null;
  private geminiOptimizer: GeminiPromptOptimizer;

  constructor() {
    const isEnabled = process.env.PROMPT_MODEL_ENABLED !== "false";
    if (isEnabled) {
      this.localOptimizer = new LocalPromptOptimizer();
    }
    this.geminiOptimizer = new GeminiPromptOptimizer();
  }

  async optimize(input: PromptOptimizationInput): Promise<OptimizedTask> {
    const isEnabled = process.env.PROMPT_MODEL_ENABLED !== "false";
    
    if (isEnabled && this.localOptimizer) {
      try {
        console.log("[Prompt Router] Running local prompt optimization...");
        return await this.localOptimizer.optimize(input);
      } catch (err: any) {
        console.warn(`[Prompt Router] Local optimizer failed: ${err.message}. Falling back to Gemini...`);
        // Return fallback status payload
        return {
          objective: input.prompt,
          taskType: "other",
          requiredCapabilities: ["general_assistance"],
          scope: { geography: null, timeframe: null, domain: null },
          constraints: { budget: null, deadline: null, format: null },
          outputRequirements: { format: null, sections: [] },
          verificationRequirements: {
            required: false,
            sourceGrounding: false,
            externalValidation: false,
            crossAgentVerification: false
          },
          ambiguities: ["Local Qwen model unavailable (fallback to default)"],
          assumptions: [`Error: ${err.message}`]
        };
      }
    }

    // Fallback to Gemini optimizer
    try {
      console.log("[Prompt Router] Running Gemini prompt optimization fallback...");
      return await this.geminiOptimizer.optimize(input);
    } catch (err: any) {
      console.error("[Prompt Router] All optimizers failed. Constructing default structured task.", err.message);
      return this.createDefaultTask(input.prompt);
    }
  }

  private createDefaultTask(prompt: string): OptimizedTask {
    return {
      objective: prompt,
      taskType: "other",
      requiredCapabilities: ["general_assistance"],
      scope: { geography: null, timeframe: null, domain: null },
      constraints: { budget: null, deadline: null, format: null },
      outputRequirements: { format: null, sections: [] },
      verificationRequirements: {
        required: false,
        sourceGrounding: false,
        externalValidation: false,
        crossAgentVerification: false
      },
      ambiguities: ["Unoptimized prompt (Router Fallback)"],
      assumptions: ["Executed raw input prompt directly"]
    };
  }
}
