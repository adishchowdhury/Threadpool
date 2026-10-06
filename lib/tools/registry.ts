import { z } from "zod";
import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import type { Dataset } from "@/lib/tools/dataEngine";
import type { Source } from "@/lib/capabilities/sources";
import type { CompetitorProfile } from "@/lib/capabilities/types";
import type { AgentTool, ToolCallRecord, ToolContext } from "@/lib/tools/types";
import { webSearchTool } from "@/lib/tools/webSearch";
import { analyzeDataTool, calculateTool } from "@/lib/tools/analysis";

// Gives a worker structured access to what earlier workers produced (their
// sources, extracted datasets, competitor profiles) instead of only their
// prose. Read-only.
export const upstreamLookupTool: AgentTool<
  { kind: "sources" | "datasets" | "competitors" },
  { sources: Source[]; datasets: Dataset[]; competitors: CompetitorProfile[] }
> = {
  name: "upstream_lookup",
  description: "Read structured artifacts (sources, datasets, competitor profiles) produced by upstream workers.",
  input: z.object({ kind: z.enum(["sources", "datasets", "competitors"]) }),
  async run({ kind }, ctx) {
    const pick = <T>(f: (a: NonNullable<ToolContext["upstream"][number]["artifacts"]>) => T[] | undefined): T[] =>
      ctx.upstream.flatMap((u) => (u.artifacts ? (f(u.artifacts) ?? []) : []));
    return {
      sources: kind === "sources" ? pick((a) => a.sources) : [],
      datasets: kind === "datasets" ? pick((a) => a.datasets) : [],
      competitors: kind === "competitors" ? pick((a) => a.competitors) : [],
    };
  },
  summarize(o) {
    return `${o.sources.length} sources, ${o.datasets.length} datasets, ${o.competitors.length} competitor profiles`;
  },
};

// The tool registry. Adding a tool = implement AgentTool, register it here,
// and list its name on the capabilities that may use it (lib/capabilities/catalog.ts).
const TOOLS = [webSearchTool, analyzeDataTool, calculateTool, upstreamLookupTool] as const;

export const TOOL_REGISTRY: ReadonlyMap<string, AgentTool<unknown, unknown>> = new Map(TOOLS.map((t) => [t.name, t as unknown as AgentTool<unknown, unknown>]));

// Runs a tool on behalf of a capability: checks the capability may use it,
// validates the input, times it, records it, and emits TOOL_CALLED. Errors
// are returned (ok: false), never thrown, so a failing tool degrades the
// worker's output honestly instead of crashing the subtask.
export async function invokeTool<I, O>(
  tool: AgentTool<I, O>,
  rawInput: unknown,
  ctx: ToolContext & { capability: string; allowedTools: readonly string[] },
  calls: ToolCallRecord[],
): Promise<{ ok: true; output: O } | { ok: false; error: string }> {
  const start = Date.now();
  const finish = async (record: ToolCallRecord) => {
    calls.push(record);
    if (ctx.taskId) {
      await emitEvent(db, {
        taskId: ctx.taskId,
        actor: ctx.agentId ?? "worker",
        eventType: "TOOL_CALLED",
        payload: { subtaskId: ctx.subtaskId ?? null, capability: ctx.capability, ...record },
      }).catch(() => {});
    }
  };

  if (!ctx.allowedTools.includes(tool.name)) {
    const error = `capability ${ctx.capability} is not permitted to use tool ${tool.name}`;
    await finish({ tool: tool.name, ok: false, latencyMs: 0, summary: "blocked", error });
    return { ok: false, error };
  }
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    const error = `invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
    await finish({ tool: tool.name, ok: false, latencyMs: 0, summary: "rejected", error });
    return { ok: false, error };
  }
  try {
    const output = await tool.run(parsed.data, ctx);
    await finish({ tool: tool.name, ok: true, latencyMs: Date.now() - start, summary: tool.summarize(output) });
    return { ok: true, output };
  } catch (err) {
    const error = err instanceof Error ? err.message : "tool failed";
    await finish({ tool: tool.name, ok: false, latencyMs: Date.now() - start, summary: "failed", error });
    return { ok: false, error };
  }
}
