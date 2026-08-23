import { z } from "zod";

export const optimizedTaskSchema = z.object({
  objective: z.string(),
  taskType: z.string(),
  requiredCapabilities: z.array(z.string()),
  scope: z.object({
    geography: z.string().nullable(),
    timeframe: z.string().nullable(),
    domain: z.string().nullable()
  }),
  constraints: z.object({
    budget: z.number().nullable(),
    deadline: z.string().nullable(),
    format: z.string().nullable()
  }),
  outputRequirements: z.object({
    format: z.string().nullable(),
    sections: z.array(z.string())
  }),
  verificationRequirements: z.object({
    required: z.boolean(),
    sourceGrounding: z.boolean(),
    externalValidation: z.boolean(),
    crossAgentVerification: z.boolean()
  }),
  ambiguities: z.array(z.string()),
  assumptions: z.array(z.string())
});

export type OptimizedTask = z.infer<typeof optimizedTaskSchema>;

export interface PromptOptimizationInput {
  prompt: string;
}

export interface PromptOptimizer {
  optimize(input: PromptOptimizationInput): Promise<OptimizedTask>;
}
