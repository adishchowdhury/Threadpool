import type { z } from "zod";
import type { SourceRegistry, Source } from "@/lib/capabilities/sources";
import type { SubtaskArtifacts } from "@/lib/capabilities/types";

// What a tool may see about the run that called it. Tools never touch
// wallets, escrow or the ledger - they produce data for a worker.
export interface ToolContext {
  taskId?: string;
  subtaskId?: string;
  agentId?: string;
  // Task-wide source id allocator (web_search registers pages here).
  sources: SourceRegistry;
  // Outputs + artifacts of the subtasks this one depends on.
  upstream: Array<{ type: string; capability?: string; output: string; artifacts?: SubtaskArtifacts }>;
}

export interface AgentTool<I, O> {
  name: string;
  description: string;
  // Inputs are validated before run() - a model-proposed tool call that does
  // not match the schema never executes.
  input: z.ZodType<I>;
  run(input: I, ctx: ToolContext): Promise<O>;
  // One-line human summary for the event stream / observability.
  summarize(output: O): string;
}

export interface ToolCallRecord {
  tool: string;
  ok: boolean;
  latencyMs: number;
  summary: string;
  error?: string;
}

export type { Source };
