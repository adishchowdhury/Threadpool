import { z } from "zod";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import { generateStructuredWithUsage } from "@/lib/manager/structuredGenerate";
import { SourceRegistry, renderSourcesSection, sourcesForText, type Source } from "@/lib/capabilities/sources";
import { addUsage, agentTier, feedbackBlock, generateWorkerText, upstreamBlock, LANGUAGE_RULE, type Usage } from "@/lib/capabilities/llm";
import { citableSources, formatSourcesForPrompt, heuristicQueries, liveWebUnavailableText, webPass, webSearchArtifact } from "@/lib/capabilities/common";
import { claimConfidence } from "@/lib/manager/confidence";
import type { ToolCallRecord } from "@/lib/tools/types";
import type { CapabilityRunInput, CapabilityRunOutput, Contradiction, FinancialMetric } from "@/lib/capabilities/types";

// Financial Analysis: every metric gets an explicit epistemic status
// ("observed" - written in a cited source - or "estimate" - derived from
// stated assumptions) and a deterministically computed confidence label.
// Kraven validates "observed" against the source registry the same way
// competitiveAnalysis.ts does: a figure claimed as observed but backed by a
// sourceId that was never retrieved is downgraded to an estimate, never
// trusted at the model's word. Disagreement between sources is surfaced as
// a contradiction, not silently averaged into a fake precise number.

const metricSchema = z.object({
  name: z.string().describe("e.g. '2026 market size', 'LTV:CAC', 'gross margin', 'CAGR 2024-2026'"),
  value: z.string().describe("formatted figure as it should be displayed, e.g. '$92B', '6.5x', '18%'"),
  // z.string() not z.enum(["observed","estimate"]): a strict enum rejects the
  // ENTIRE response (all 12 metrics, the whole assumption ledger) whenever
  // the model writes so much as "Observed" or "partially observed" for one
  // field. validateFinancial() normalizes this defensively - anything that
  // isn't exactly "observed" is treated as "estimate" (the conservative
  // direction: ambiguity never gets promoted to "observed").
  basis: z.string().describe("'observed' only if this exact figure is written in a cited source; otherwise 'estimate'"),
  sourceId: z.string().nullable().default(null).describe("source id like 'S1' backing an 'observed' metric; null for 'estimate'"),
  assumptions: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .default([])
    .describe("for 'estimate' metrics: every input/assumption the derivation depends on, e.g. {label:'Average contract value', value:'$1,200'}"),
  note: z.string().nullable().default(null).describe("e.g. a range when sources disagree, or a caveat"),
});

const contradictionSchema = z.object({
  topic: z.string(),
  // min(1) not min(2): a model occasionally emits a thin entry with just one
  // claim. Rejecting the WHOLE structured response (every metric, the whole
  // assumption ledger) over one malformed contradiction entry is a worse
  // outcome than dropping that one entry - validateContradictions filters
  // out anything that isn't actually two-or-more claims disagreeing.
  claims: z.array(z.object({ value: z.string(), sourceId: z.string().nullable().default(null) })).min(1),
  resolution: z.string().describe("Kraven's working position and why, e.g. which definition/scope explains the gap"),
});

const financialSchema = z.object({
  metrics: z.array(metricSchema).min(1).max(12),
  contradictions: z.array(contradictionSchema).default([]),
  narrative: z.string().describe("2-5 sentences of interpretation. No new figures beyond those listed in metrics."),
});

type FinancialResult = z.infer<typeof financialSchema>;

export function validateFinancial(result: FinancialResult, sources: Source[]): { metrics: FinancialMetric[]; downgraded: number; invalidEvidence: string[] } {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const invalid = new Set<string>();
  let downgraded = 0;

  const metrics: FinancialMetric[] = result.metrics.slice(0, 12).map((m) => {
    const claimsObserved = m.basis.trim().toLowerCase() === "observed";
    if (!claimsObserved) {
      return {
        name: m.name,
        value: m.value,
        basis: "estimate",
        sourceId: null,
        assumptions: m.assumptions.slice(0, 6),
        note: m.note,
        confidence: m.assumptions.length >= 2 ? "medium" : "low",
      };
    }
    const id = m.sourceId?.replace(/[[\]\s]/g, "") ?? null;
    const src = id ? byId.get(id) : undefined;
    if (id && !src) invalid.add(id);
    if (!src) {
      downgraded++;
      return { name: m.name, value: m.value, basis: "estimate", sourceId: null, assumptions: m.assumptions.slice(0, 6), note: m.note, confidence: "low" };
    }
    return { name: m.name, value: m.value, basis: "observed", sourceId: id, assumptions: [], note: m.note, confidence: claimConfidence([src]) };
  });

  return { metrics, downgraded, invalidEvidence: [...invalid] };
}

function validateContradictions(result: FinancialResult, sources: Source[]): Contradiction[] {
  const byId = new Set(sources.map((s) => s.id));
  return result.contradictions
    .slice(0, 6)
    .map((c) => ({
      topic: c.topic,
      claims: c.claims.slice(0, 5).map((cl) => ({ value: cl.value, sourceId: cl.sourceId && byId.has(cl.sourceId) ? cl.sourceId : null })),
      resolution: c.resolution,
    }))
    .filter((c) => c.claims.length >= 2); // fewer than 2 claims isn't a disagreement
}

function renderFinancial(metrics: FinancialMetric[], contradictions: Contradiction[], narrative: string): string {
  const out: string[] = ["## Financial analysis", "", "### Key metrics", "", "| Metric | Value | Basis | Confidence |", "|---|---|---|---|"];
  for (const m of metrics) {
    out.push(`| ${m.name} | ${m.value} | ${m.basis === "observed" ? `observed [${m.sourceId}]` : "estimate"} | ${m.confidence} |`);
  }

  const estimates = metrics.filter((m) => m.basis === "estimate" && m.assumptions.length > 0);
  if (estimates.length > 0) {
    out.push("", "### Assumption ledger");
    for (const m of estimates) {
      out.push("", `**${m.name}: ${m.value}** (confidence: ${m.confidence})`, "", "Based on:");
      for (const a of m.assumptions) out.push(`- ${a.label}: ${a.value}`);
      if (m.note) out.push(`- Note: ${m.note}`);
    }
  }

  const noted = metrics.filter((m) => m.note && !(m.basis === "estimate" && m.assumptions.length > 0));
  if (noted.length > 0) {
    out.push("", "### Notes");
    for (const m of noted) out.push(`- **${m.name}:** ${m.note}`);
  }

  if (contradictions.length > 0) {
    out.push("", "### Source disagreement");
    for (const c of contradictions) {
      out.push(`- **${c.topic}:** ${c.claims.map((cl) => `${cl.value}${cl.sourceId ? ` [${cl.sourceId}]` : ""}`).join(" vs. ")}. ${c.resolution}`);
    }
  }

  out.push("", "### Interpretation", narrative);
  return out.join("\n");
}

export async function runFinancialAnalysis(input: CapabilityRunInput): Promise<CapabilityRunOutput> {
  const calls: ToolCallRecord[] = [];
  const registry = new SourceRegistry(input.knownSources);
  let usage: Usage | undefined;
  let sources = citableSources(input);
  let ownSources: Source[] = [];
  let webSearch: CapabilityRunOutput["artifacts"]["webSearch"];

  if (sources.length === 0 && input.webGrounding) {
    const queries = heuristicQueries(`${input.taskPrompt} financial metrics`, input.description);
    const web = await webPass(input, registry, queries, calls, 5);
    webSearch = webSearchArtifact(web);
    ownSources = web.sources;
    sources = web.sources;
    if (!web.available) {
      // Live research failed: report it; never fall back to model knowledge.
      return { output: liveWebUnavailableText("Financial analysis", web), source: "tool_unavailable", artifacts: { sources: [], webSearch, toolCalls: calls, mode: "fallback" } };
    }
  }

  if (!isSarvamConfigured()) {
    const output = `[LOCAL FALLBACK OUTPUT - Sarvam unavailable]\n\n## Financial analysis\n\nNo model was available to derive financial metrics. ${
      sources.length ? `${sources.length} retrieved source(s) are listed below for a human analyst.\n\n${renderSourcesSection(sources)}` : "No sources were retrieved."
    }`;
    return { output, source: "local_fallback", artifacts: { sources: ownSources, webSearch, toolCalls: calls, mode: "fallback" } };
  }

  const sourceBlock = sources.length
    ? `\n\nRetrieved sources you may cite by id (sourceId field):\n${formatSourcesForPrompt(sources, 1000)}`
    : "\n\nNo retrieved sources are available: every metric must use basis \"estimate\" with sourceId null, and you must state the assumptions it rests on.";

  try {
    const { object, usage: u } = await generateStructuredWithUsage({
      schema: financialSchema,
      tier: agentTier(input),
      largeOutput: true,
      system: input.agent?.systemPrompt,
      prompt: `You are the financial analysis worker in an AI workforce.
Overall task: "${input.taskPrompt}"
Your assignment: ${input.description}${upstreamBlock(input.upstream)}${sourceBlock}${feedbackBlock(input.feedback)}

Produce the key financial metrics this task needs (market size, growth/CAGR, margins, unit economics, valuation, etc. - only what's relevant):
- basis "observed" ONLY when the exact figure is written in a cited source (give its sourceId). Never mark a number "observed" because it sounds plausible.
- basis "estimate" for anything derived or inferred: you MUST list every assumption/input it depends on in "assumptions" (e.g. average contract value, gross margin, churn, multiple applied). Never emit an estimate with an empty assumptions list - either justify it or do not report it as a specific number.
- If two sources state different figures for the same thing (e.g. market size), do NOT silently average or pick one: report the disagreement in "contradictions" with each source's value, and give your working resolution (e.g. which definition/scope explains the gap, or state a range).
- Prefer "$90-100B, medium confidence" over fabricating false precision like "$92B" when the underlying sources do not actually support that precision.
- narrative: brief interpretation only, no new figures.
All free-text fields: ${LANGUAGE_RULE}`,
    });
    usage = addUsage(usage, u);
    const v = validateFinancial(object, sources);
    const contradictions = validateContradictions(object, sources);
    const body = renderFinancial(v.metrics, contradictions, object.narrative);
    const notes: string[] = [];
    if (v.downgraded) notes.push(`${v.downgraded} metric(s) the model marked as observed were not backed by a retrieved source and are shown as estimates.`);
    if (v.invalidEvidence.length) notes.push(`Removed citations to sources that were never retrieved: ${v.invalidEvidence.join(", ")}.`);
    const used = sourcesForText(body, sources);
    const output = [body, notes.length ? `\n> Verification: ${notes.join(" ")}` : "", used.citedOnly ? `\n${renderSourcesSection(used.sources)}` : ""].join("\n").trim();
    return {
      output,
      source: ownSources.length ? "sarvam_structured+web_search" : "sarvam_structured",
      usage,
      artifacts: {
        sources: ownSources,
        webSearch,
        financialMetrics: v.metrics,
        contradictions,
        toolCalls: calls,
        mode: "structured",
      },
    };
  } catch (err) {
    console.error("[FinancialAnalysis] structured generation failed, using free-form:", err);
    const { text, usage: u } = await generateWorkerText(
      input,
      `You are the financial analysis worker in an AI workforce.
Overall task: "${input.taskPrompt}"
Your assignment: ${input.description}${upstreamBlock(input.upstream)}${sourceBlock}${feedbackBlock(input.feedback)}

For every figure: label it "Observed [S#]" (only if it is written in a cited source) or "Estimate" with the assumptions it rests on listed inline. Never state a number without one of these labels. Do not write URLs or a Sources section. ${LANGUAGE_RULE}`,
    );
    usage = addUsage(usage, u);
    return { output: text, source: "sarvam", usage, artifacts: { sources: ownSources, webSearch, toolCalls: calls, mode: "freeform" } };
  }
}
