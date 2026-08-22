import { z } from "zod";

export const CAPABILITIES = [
  "market_research",
  "financial_analysis",
  "data_extraction",
  "writing",
  "report_generation",
  "summarization",
  "quality_verification",
  "review",
] as const;

export const subtaskPlanSchema = z.object({
  type: z.string().describe("short slug for this subtask, e.g. 'market_research'"),
  requiredCapability: z.enum(CAPABILITIES),
  description: z.string().describe("concrete instruction for the worker agent"),
  sequence: z.number().int().min(0),
  dependsOnSequence: z.array(z.number().int().min(0)).default([]),
});

export const taskPlanSchema = z.object({
  summary: z.string().describe("one-sentence restatement of the user's objective"),
  subtasks: z.array(subtaskPlanSchema).min(1).max(6),
});

export type TaskPlan = z.infer<typeof taskPlanSchema>;
export type SubtaskPlan = z.infer<typeof subtaskPlanSchema>;

export const qaVerdictSchema = z.object({
  passed: z.boolean(),
  score: z.number().int().min(0).max(100),
  reason: z.string(),
});

export type QaVerdict = z.infer<typeof qaVerdictSchema>;
