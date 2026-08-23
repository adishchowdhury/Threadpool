import path from "path";
import fs from "fs";
import { getLlama, LlamaChatSession, LlamaJsonSchemaGrammar } from "node-llama-cpp";
import { PromptOptimizer, PromptOptimizationInput, OptimizedTask, optimizedTaskSchema } from "./types";

export class LocalPromptOptimizer implements PromptOptimizer {
  private modelPath: string;

  constructor() {
    this.modelPath = process.env.PROMPT_MODEL_PATH || path.join(process.cwd(), "models", "qwen3-0.6b.gguf");
    if (!path.isAbsolute(this.modelPath)) {
      this.modelPath = path.join(process.cwd(), this.modelPath);
    }
  }

  async optimize(input: PromptOptimizationInput): Promise<OptimizedTask> {
    if (!fs.existsSync(this.modelPath)) {
      throw new Error(`Model file not found at: ${this.modelPath}`);
    }

    const systemPrompt = `You are Momentum's Prompt Compiler.
Your job is to transform a user's natural-language request into a structured task specification for a downstream AI Manager.
Do not solve the user's task.
Do not execute the task.
Do not invent missing requirements.
Identify the user's objective, task type, required capabilities, scope, constraints, output requirements, ambiguities, assumptions, and verification requirements.
The downstream Manager will use your structured task to create and coordinate the appropriate AI agents.
Return ONLY valid JSON matching the provided schema.`;

    const userPrompt = `Optimize this prompt: "${input.prompt}"`;

    // Define Zod/JSON schema structure for Qwen constraints
    const responseSchema = {
      type: "object",
      properties: {
        objective: { type: "string" },
        taskType: { type: "string" },
        requiredCapabilities: {
          type: "array",
          items: { type: "string" }
        },
        scope: {
          type: "object",
          properties: {
            geography: { type: ["string", "null"] },
            timeframe: { type: ["string", "null"] },
            domain: { type: ["string", "null"] }
          },
          required: ["geography", "timeframe", "domain"]
        },
        constraints: {
          type: "object",
          properties: {
            budget: { type: ["number", "null"] },
            deadline: { type: ["string", "null"] },
            format: { type: ["string", "null"] }
          },
          required: ["budget", "deadline", "format"]
        },
        outputRequirements: {
          type: "object",
          properties: {
            format: { type: ["string", "null"] },
            sections: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["format", "sections"]
        },
        verificationRequirements: {
          type: "object",
          properties: {
            required: { type: "boolean" },
            sourceGrounding: { type: "boolean" },
            externalValidation: { type: "boolean" },
            crossAgentVerification: { type: "boolean" }
          },
          required: ["required", "sourceGrounding", "externalValidation", "crossAgentVerification"]
        },
        ambiguities: {
          type: "array",
          items: { type: "string" }
        },
        assumptions: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: [
        "objective",
        "taskType",
        "requiredCapabilities",
        "scope",
        "constraints",
        "outputRequirements",
        "verificationRequirements",
        "ambiguities",
        "assumptions"
      ]
    };

    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: this.modelPath });
    const context = await model.createContext({ contextSize: 1024 }); // Limit context size appropriately
    const jsonGrammar = new LlamaJsonSchemaGrammar(llama, responseSchema as any);

    const session = new LlamaChatSession({ 
      contextSequence: context.getSequence(),
      systemPrompt: systemPrompt
    });

    const response = await session.prompt(userPrompt, {
      temperature: 0.7,
      topP: 0.8,
      topK: 20,
      maxTokens: 500, // Tuned output token limit
      grammar: jsonGrammar
    });

    try {
      let jsonText = response.trim();
      const firstBrace = jsonText.indexOf("{");
      const lastBrace = jsonText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        jsonText = jsonText.substring(firstBrace, lastBrace + 1);
      }
      const parsed = JSON.parse(jsonText);
      
      // Perform strict validation using Zod
      const validated = optimizedTaskSchema.parse(parsed);
      return validated;
    } catch (err: any) {
      console.error("[LocalPromptOptimizer] Model output validation failed:", response, err.message);
      throw new Error(`Failed to parse/validate structured model response: ${err.message}`);
    } finally {
      context.dispose();
    }
  }
}
