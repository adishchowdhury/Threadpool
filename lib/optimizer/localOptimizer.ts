import path from "path";
import fs from "fs";
import { getLlama, LlamaChatSession, LlamaJsonSchemaGrammar, type Llama, type LlamaModel } from "node-llama-cpp";
import { PromptOptimizer, PromptOptimizationInput, OptimizedTask, optimizedTaskSchema } from "./types";

// Loading the gguf model from disk and initializing llama.cpp takes several
// seconds on its own. Doing that on every request (as before) meant every
// optimize() call paid the full cold-start cost. Cache the loaded llama
// instance/model at module scope so it is paid once per server process and
// reused across requests; only the (cheap) context+session are per-call.
let llamaPromise: Promise<Llama> | null = null;
let modelPromise: Promise<LlamaModel> | null = null;

// Placeholder strings the model sometimes echoes back verbatim instead of
// actually filling in a real objective derived from the user's prompt.
const PLACEHOLDER_OBJECTIVES = [
  "detailed objective of the task",
  "objective of the task",
  "the user's objective",
  "optimize the text",
  "optimize this prompt",
  "optimize the prompt"
];

function looksLikePlaceholder(objective: string, rawPrompt: string): boolean {
  const normalized = objective.trim().toLowerCase();
  if (!normalized) return true;
  if (PLACEHOLDER_OBJECTIVES.includes(normalized)) return true;

  // Heuristic: a real objective derived from the user's prompt should share
  // at least one meaningful (4+ char) word with the original prompt, unless
  // the prompt itself is very short.
  const stop = new Set(["this", "that", "with", "from", "into", "your", "their", "about"]);
  const promptWords = rawPrompt
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length >= 4 && !stop.has(w));
  if (promptWords.length === 0) return false;

  const objectiveWords = new Set(normalized.split(/\W+/));
  return !promptWords.some(w => objectiveWords.has(w));
}

export class LocalPromptOptimizer implements PromptOptimizer {
  private modelPath: string;

  constructor() {
    this.modelPath = process.env.PROMPT_MODEL_PATH || path.join(process.cwd(), "models", "qwen3-0.6b.gguf");
    if (!path.isAbsolute(this.modelPath)) {
      this.modelPath = path.join(process.cwd(), this.modelPath);
    }
  }

  private async getModel(): Promise<LlamaModel> {
    if (!fs.existsSync(this.modelPath)) {
      throw new Error(`Model file not found at: ${this.modelPath}`);
    }
    if (!llamaPromise) {
      llamaPromise = getLlama();
    }
    if (!modelPromise) {
      const modelPath = this.modelPath;
      modelPromise = llamaPromise.then(llama => llama.loadModel({ modelPath }));
      modelPromise.catch(() => {
        // Allow a retry on the next call instead of caching a permanent failure.
        modelPromise = null;
      });
    }
    return modelPromise;
  }

  async optimize(input: PromptOptimizationInput): Promise<OptimizedTask> {
    const model = await this.getModel();

    const systemPrompt = `You are Momentum's Prompt Compiler.
Your job is to transform a user's natural-language request into a structured task specification for a downstream AI Manager.
Do not solve the user's task.
Do not execute the task.
Do not invent missing requirements.
The "objective" field MUST restate, in your own words, what the user in the CURRENT request actually wants — using only details present in their message. Never copy example text, never leave it as a generic placeholder like "Detailed objective of the task", and never describe the act of optimizing itself.
Identify the user's objective, task type, required capabilities, scope, constraints, output requirements, ambiguities, assumptions, and verification requirements.
The downstream Manager will use your structured task to create and coordinate the appropriate AI agents.
Return ONLY valid JSON matching the provided schema.

Example:
User request: "find out why our checkout API keeps timing out"
{"objective": "Diagnose the cause of repeated timeouts in the checkout API", ...}`;

    const userPrompt = `Optimize this exact request, using only its own content (do not reuse the example above): "${input.prompt}"`;

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

    const llama = await llamaPromise!;
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

      if (looksLikePlaceholder(validated.objective, input.prompt)) {
        throw new Error(`Model returned a placeholder objective: "${validated.objective}"`);
      }

      return validated;
    } catch (err: any) {
      console.error("[LocalPromptOptimizer] Model output validation failed:", response, err.message);
      throw new Error(`Failed to parse/validate structured model response: ${err.message}`);
    } finally {
      context.dispose();
    }
  }
}
