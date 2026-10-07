import { z } from "zod";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import { generateStructuredWithUsage } from "@/lib/manager/structuredGenerate";
import {
  SourceRegistry,
  checkCitations,
  renderSourcesSection,
  stripInvalidCitations,
  stripModelSourceList,
  type Source,
} from "@/lib/capabilities/sources";
import { addUsage, agentTier, feedbackBlock, generateWorkerText, LANGUAGE_RULE, type Usage } from "@/lib/capabilities/llm";
import { formatSourcesForPrompt, heuristicQueries, sanitizeQuery, webPass } from "@/lib/capabilities/common";
import type { ToolCallRecord } from "@/lib/tools/types";
import type { CapabilityRunInput, CapabilityRunOutput } from "@/lib/capabilities/types";

// Web Research: search the live web, read the pages, and report what they
// say - with every sourced statement tagged to a retrieved page. Analysis the
// model adds is kept in a separate, explicitly unsourced section. The
// Sources list is rendered by code from what was actually fetched.

export const SOURCED_SECTION = /sourced findings/i;

const queriesSchema = z.object({ queries: z.array(z.string()).min(1) });

async function planQueries(input: CapabilityRunInput): Promise<{ queries: string[]; usage?: Usage }> {
  if (!isSarvamConfigured()) return { queries: heuristicQueries(input.taskPrompt, input.description) };
  try {
    // Writing 2-4 search queries is a trivial, auxiliary step: it runs on the
    // fast tier, not the hired agent's. On a premium (high reasoning) agent it
    // took 30-70s of the attempt's time budget, starving the actual write-up.
    const { object, usage } = await generateStructuredWithUsage({
      schema: queriesSchema,
      tier: "economy",
      prompt: `Write 2-4 web search queries that will find current, factual sources for this research assignment.
Each query: 3-10 plain keywords, as a person would type them. No search operators (no site:, OR, quotes). Name the specific entities, metric and year where recency matters.
Overall task: "${input.taskPrompt}"
Assignment: ${input.description}${input.feedback ? `\nThe previous attempt was rejected because: ${input.feedback} - search for what was missing.` : ""}`,
    });
    const queries = [...new Set(object.queries.map(sanitizeQuery))].filter((q) => q.length >= 3).slice(0, 4);
    return { queries: queries.length ? queries : heuristicQueries(input.taskPrompt, input.description), usage };
  } catch {
    return { queries: heuristicQueries(input.taskPrompt, input.description) };
  }
}

function firstSentences(text: string, maxChars = 280): string {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]/g) ?? [text];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > maxChars) break;
    out += s;
  }
  return (out || text.slice(0, maxChars)).trim();
}

// No model available: an extractive digest - each line is text copied from
// a retrieved page, so it is sourced by construction.
function extractiveBrief(sources: Source[]): string {
  return [
    "> Deterministic extract (no language model available): each finding below is text taken directly from the cited page.",
    "",
    "## Sourced findings",
    ...sources.map((s) => `- ${firstSentences(s.excerpt)} [${s.id}]`),
    "",
    "## Analysis (model-generated, not from sources)",
    "- None: no model was available to analyse these sources.",
  ].join("\n");
}

export async function runWebResearch(input: CapabilityRunInput): Promise<CapabilityRunOutput> {
  const calls: ToolCallRecord[] = [];
  const registry = new SourceRegistry(input.knownSources);
  let usage: Usage | undefined;

  const planned = await planQueries(input);
  usage = addUsage(usage, planned.usage);
  let web = await webPass(input, registry, planned.queries, calls, 6);
  // Nothing usable: broaden once with simpler queries built from the task
  // itself (unless the search backend is blocking us outright).
  if (!web.available && !/bot challenge|blocked/i.test(web.reason ?? "")) {
    const broader = heuristicQueries(input.taskPrompt, input.description).map(sanitizeQuery).filter((q) => !planned.queries.includes(q));
    if (broader.length > 0) {
      const second = await webPass(input, registry, broader, calls, 6);
      web = second.available ? second : { ...second, queries: [...planned.queries, ...broader], reason: second.reason ?? web.reason };
    }
  }
  const webSearch = { available: web.available, queries: web.queries, ...(web.reason ? { reason: web.reason } : {}) };

  if (!web.available || web.sources.length === 0) {
    // Nothing retrieved: say so plainly. No sourced section, no citations.
    const output = [
      "## Web research",
      "",
      `> **No live sources could be retrieved** (${web.reason ?? "unknown reason"}). Nothing in this deliverable is sourced; downstream steps must treat any figures as unverified.`,
      "",
      `Searches attempted: ${web.queries.map((q) => `"${q}"`).join(", ")}`,
    ].join("\n");
    return { output, source: "tool_unavailable", usage, artifacts: { sources: [], webSearch, toolCalls: calls, mode: "fallback", citationCheck: checkCitations(output, []) } };
  }

  const sources = web.sources;
  if (!isSarvamConfigured()) {
    const body = extractiveBrief(sources);
    const output = `${body}\n\n${renderSourcesSection(sources)}`;
    return { output, source: "web_search+extractive", artifacts: { sources, webSearch, toolCalls: calls, mode: "deterministic", citationCheck: checkCitations(body, sources, { sourcedSectionHeading: SOURCED_SECTION }) } };
  }

  const prompt = `You are the web research worker in an AI workforce. Report what the retrieved sources below say about your assignment.
Overall task: "${input.taskPrompt}"
Your assignment: ${input.description}${feedbackBlock(input.feedback)}

Retrieved sources (the ONLY material you may cite):
${formatSourcesForPrompt(sources)}

Write markdown with exactly these sections:
## Sourced findings
- One fact per bullet, stated as the source states it (keep figures, units, dates exact), ending with the id(s) of the source(s) it comes from, e.g. [S2] or [S1, S3].
- Only facts that appear in the source text above. If a source is only a search snippet, use it sparingly.
## Analysis (model-generated, not from sources)
- Your own interpretation, implications or estimates. Mark estimates as estimates. No source tags here.
## Gaps & caveats
- What the assignment needs that the sources do not establish, conflicting figures, or dated data.

Rules: never cite an id that is not listed above; do not write URLs; do not add a Sources or References section (Kraven appends the verified list); no preamble. ${LANGUAGE_RULE}`;

  try {
    const { text, usage: genUsage } = await generateWorkerText(input, prompt);
    usage = addUsage(usage, genUsage);
    const raw = stripModelSourceList(text);
    const citationCheck = checkCitations(raw, sources, { sourcedSectionHeading: SOURCED_SECTION });
    const body = stripInvalidCitations(raw, sources);
    const output = `${body}\n\n${renderSourcesSection(sources)}`;
    return { output, source: "sarvam+web_search", usage, artifacts: { sources, webSearch, toolCalls: calls, mode: "freeform", citationCheck } };
  } catch (err) {
    console.error("[WebResearch] model call failed, returning extractive digest:", err);
    const body = extractiveBrief(sources);
    return {
      output: `${body}\n\n${renderSourcesSection(sources)}`,
      source: "web_search+extractive",
      usage,
      artifacts: { sources, webSearch, toolCalls: calls, mode: "deterministic", citationCheck: checkCitations(body, sources, { sourcedSectionHeading: SOURCED_SECTION }) },
    };
  }
}
