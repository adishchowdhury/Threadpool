import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { CAPABILITY_CATALOG, isCapabilityId } from "@/lib/capabilities/catalog";
import { SourceRegistry, type Source } from "@/lib/capabilities/sources";
import { invokeTool } from "@/lib/tools/registry";
import { webSearchTool, type WebSearchOutput } from "@/lib/tools/webSearch";
import type { ToolCallRecord, ToolContext } from "@/lib/tools/types";
import type { CapabilityRunInput } from "@/lib/capabilities/types";

// Shared plumbing for capability runtimes: a tool context bound to the
// capability's tool allowance, and the live web pass + its UI event.

export function toolContext(input: CapabilityRunInput, registry: SourceRegistry): ToolContext & { capability: string; allowedTools: readonly string[] } {
  return {
    taskId: input.taskId,
    subtaskId: input.subtaskId,
    agentId: input.agentId,
    sources: registry,
    upstream: input.upstream,
    capability: input.capability,
    allowedTools: isCapabilityId(input.capability) ? CAPABILITY_CATALOG[input.capability].tools : [],
  };
}

// Sources available to cite: everything retrieved earlier in the task.
export function citableSources(input: CapabilityRunInput): Source[] {
  const byId = new Map<string, Source>();
  for (const s of input.knownSources) byId.set(s.id, s);
  for (const u of input.upstream) for (const s of u.artifacts?.sources ?? []) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

export async function webPass(
  input: CapabilityRunInput,
  registry: SourceRegistry,
  queries: string[],
  calls: ToolCallRecord[],
  maxSources = 5,
): Promise<WebSearchOutput> {
  const res = await invokeTool(webSearchTool, { queries, maxSources }, toolContext(input, registry), calls);
  const out: WebSearchOutput = res.ok ? res.output : { available: false, queries, sources: [], reason: res.error };
  if (input.taskId) {
    await emitEvent(db, {
      taskId: input.taskId,
      actor: "scraper",
      eventType: "WEB_DATA_FETCHED",
      payload: {
        subtaskId: input.subtaskId ?? null,
        capability: input.capability,
        available: out.available,
        sources: out.sources.map((s) => ({ id: s.id, url: s.url, title: s.title })),
        reason: out.reason ?? null,
      },
    }).catch(() => {});
  }
  return out;
}

export function formatSourcesForPrompt(sources: Source[], maxExcerpt = 1400): string {
  return sources
    .map((s) => `[${s.id}] ${s.title} (${s.url})${s.kind === "snippet" ? " [search snippet only]" : ""}\n${s.excerpt.slice(0, maxExcerpt)}`)
    .join("\n\n");
}

// Search engines return little or nothing for long operator chains
// ("site:a OR site:b OR ..."), which models like to write. Keep the words.
export function sanitizeQuery(q: string): string {
  return q
    .replace(/\b(site|inurl|intitle|filetype):\S+/gi, " ")
    .replace(/\s(OR|AND)\s/g, " ")
    .replace(/["()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

// Fallback search queries when no model is available to write them.
export function heuristicQueries(taskPrompt: string, description: string): string[] {
  const clean = (s: string) => s.replace(/\s+/g, " ").replace(/["']/g, "").trim().slice(0, 160);
  return [...new Set([clean(taskPrompt), clean(description)])].filter((q) => q.length >= 3).slice(0, 2);
}
