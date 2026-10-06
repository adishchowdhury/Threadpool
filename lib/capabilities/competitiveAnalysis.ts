import { z } from "zod";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import { generateStructuredWithUsage } from "@/lib/manager/structuredGenerate";
import { SourceRegistry, renderSourcesSection, sourcesForText, type Source } from "@/lib/capabilities/sources";
import { addUsage, agentTier, feedbackBlock, generateWorkerText, upstreamBlock, LANGUAGE_RULE, type Usage } from "@/lib/capabilities/llm";
import { citableSources, formatSourcesForPrompt, heuristicQueries, webPass } from "@/lib/capabilities/common";
import { valueAppearsIn, type Dataset } from "@/lib/tools/dataEngine";
import type { ToolCallRecord } from "@/lib/tools/types";
import type { CapabilityRunInput, CapabilityRunOutput, CompetitorProfile, DataPoint, Swot } from "@/lib/capabilities/types";

// Competitive Analysis: structured comparison of named competitors. The model
// fills a schema (profiles, SWOT, comparable metrics); Kraven validates every
// evidence id against retrieved sources, downgrades any "sourced" figure that
// does not appear in its cited page to an estimate, and renders the tables.
// The structured result is stored so Data Analysis can compute on it.

// No max() limits: a model that returns 7 strengths instead of 5 should not
// fail the whole analysis. Lists are truncated after validation instead.
const list = () => z.array(z.string()).default([]);

const competitiveSchema = z.object({
  subject: z.string().describe("the market / product category being analysed"),
  competitors: z
    .array(
      z.object({
        name: z.string(),
        positioning: z.string(),
        pricing: z.string().describe("pricing / price band as stated in sources, or 'not disclosed'"),
        keyFeatures: list(),
        strengths: list(),
        weaknesses: list(),
        opportunities: list(),
        threats: list(),
        evidence: z.array(z.string()).default([]).describe("source ids like S1 backing this profile"),
      }),
    )
    .min(1),
  swot: z.object({ strengths: list(), weaknesses: list(), opportunities: list(), threats: list() }),
  dataPoints: z
    .array(
      z.object({
        entity: z.string(),
        metric: z.string().describe("e.g. 'revenue', 'market share', 'units sold', 'price'"),
        value: z.number(),
        unit: z.string().nullable().default(null).describe("e.g. 'USD', 'INR', '%', 'units'"),
        period: z.string().nullable().default(null),
        basis: z.enum(["sourced", "estimate"]),
        sourceId: z.string().nullable().default(null),
      }),
    )
    .default([]),
  keyTakeaways: list(),
});

type CompetitiveResult = z.infer<typeof competitiveSchema>;

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

export function validateCompetitive(result: CompetitiveResult, sources: Source[]) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const invalid = new Set<string>();
  const competitors: CompetitorProfile[] = result.competitors.slice(0, 10).map((c) => {
    const evidence = [...new Set(c.evidence.map((e) => e.replace(/[[\]\s]/g, "")))];
    evidence.filter((e) => !byId.has(e)).forEach((e) => invalid.add(e));
    return {
      ...c,
      keyFeatures: c.keyFeatures.slice(0, 6),
      strengths: c.strengths.slice(0, 5),
      weaknesses: c.weaknesses.slice(0, 5),
      opportunities: c.opportunities.slice(0, 4),
      threats: c.threats.slice(0, 4),
      evidence: evidence.filter((e) => byId.has(e)),
    };
  });
  let downgraded = 0;
  const dataPoints: DataPoint[] = result.dataPoints.slice(0, 60).map((d) => {
    if (d.basis !== "sourced") return { ...d, sourceId: null };
    const id = d.sourceId?.replace(/[[\]\s]/g, "") ?? null;
    const src = id ? byId.get(id) : undefined;
    if (id && !src) invalid.add(id);
    // A "sourced" figure must actually be written in the page it cites.
    if (!src || !valueAppearsIn(d.value, src.excerpt)) {
      downgraded++;
      return { ...d, basis: "estimate" as const, sourceId: null };
    }
    return { ...d, sourceId: id };
  });
  return { competitors, dataPoints, invalidEvidence: [...invalid], downgraded };
}

// Pivot comparable metrics into a dataset (one row per entity, one numeric
// column per metric+unit) the Data Analyst can compute on directly.
export function dataPointsToDataset(points: DataPoint[]): Dataset | null {
  if (points.length === 0) return null;
  const colOf = (d: DataPoint) => `${d.metric}${d.unit ? ` (${d.unit})` : ""}${d.period ? ` [${d.period}]` : ""}`;
  const columns = ["entity", ...new Set(points.map(colOf))];
  const rows = new Map<string, Record<string, string | number | null>>();
  for (const d of points) {
    const row = rows.get(d.entity) ?? Object.fromEntries(columns.map((c) => [c, c === "entity" ? d.entity : null]));
    row[colOf(d)] = d.value;
    rows.set(d.entity, row);
  }
  return { name: "competitor_metrics", columns, rows: [...rows.values()], provenance: "competitive analysis comparables (sourced figures verified against cited pages; others are estimates)" };
}

function renderCompetitive(subject: string, competitors: CompetitorProfile[], swot: Swot, dataPoints: DataPoint[], takeaways: string[]): string {
  const tag = (ids: string[]) => (ids.length ? ` [${ids.join(", ")}]` : "");
  const out: string[] = [`## Competitive landscape: ${subject}`, "", "### Comparison", "", "| Company | Positioning | Pricing | Key features | Evidence |", "|---|---|---|---|---|"];
  for (const c of competitors) {
    out.push(`| ${cell(c.name)} | ${cell(c.positioning)} | ${cell(c.pricing)} | ${cell(c.keyFeatures.join("; ") || "—")} | ${c.evidence.length ? c.evidence.map((e) => `[${e}]`).join(" ") : "unsourced"} |`);
  }
  out.push("", "### SWOT by company");
  for (const c of competitors) {
    out.push("", `**${c.name}**${tag(c.evidence)}`);
    for (const [label, items] of [["Strengths", c.strengths], ["Weaknesses", c.weaknesses], ["Opportunities", c.opportunities], ["Threats", c.threats]] as const) {
      if (items.length) out.push(`- *${label}:* ${items.join("; ")}`);
    }
  }
  out.push("", "### Market SWOT");
  for (const [k, items] of Object.entries(swot) as Array<[keyof Swot, string[]]>) {
    out.push("", `**${k[0].toUpperCase()}${k.slice(1)}**`, ...(items.length ? items.map((i) => `- ${i}`) : ["- —"]));
  }
  if (dataPoints.length) {
    out.push("", "### Comparable metrics", "", "| Entity | Metric | Value | Period | Basis |", "|---|---|---|---|---|");
    for (const d of dataPoints) {
      out.push(`| ${cell(d.entity)} | ${cell(d.metric)} | ${d.value.toLocaleString("en-US")}${d.unit ? ` ${cell(d.unit)}` : ""} | ${cell(d.period ?? "—")} | ${d.basis === "sourced" ? `sourced [${d.sourceId}]` : "estimate"} |`);
    }
  }
  if (takeaways.length) out.push("", "### Key takeaways", ...takeaways.map((t) => `- ${t}`));
  return out.join("\n");
}

export async function runCompetitiveAnalysis(input: CapabilityRunInput): Promise<CapabilityRunOutput> {
  const calls: ToolCallRecord[] = [];
  const registry = new SourceRegistry(input.knownSources);
  let usage: Usage | undefined;
  let sources = citableSources(input);
  let ownSources: Source[] = [];
  let webSearch: CapabilityRunOutput["artifacts"]["webSearch"];

  // No upstream research to work from: fetch fresh evidence itself.
  if (sources.length === 0 && input.webGrounding) {
    const queries = heuristicQueries(`${input.taskPrompt} competitors comparison`, input.description);
    const web = await webPass(input, registry, queries, calls, 5);
    webSearch = { available: web.available, queries: web.queries, ...(web.reason ? { reason: web.reason } : {}) };
    ownSources = web.sources;
    sources = web.sources;
  }

  if (!isSarvamConfigured()) {
    const output = `[LOCAL FALLBACK OUTPUT - Sarvam unavailable]\n\n## Competitive landscape\n\nNo model was available to build competitor profiles. ${
      sources.length ? `${sources.length} retrieved source(s) are listed below for a human analyst.\n\n${renderSourcesSection(sources)}` : "No sources were retrieved."
    }`;
    return { output, source: "local_fallback", artifacts: { sources: ownSources, webSearch, toolCalls: calls, mode: "fallback" } };
  }

  const sourceBlock = sources.length
    ? `\n\nRetrieved sources you may cite by id (evidence / sourceId fields):\n${formatSourcesForPrompt(sources, 1000)}`
    : "\n\nNo retrieved sources are available: every data point must use basis \"estimate\" and evidence must be empty.";

  try {
    const { object, usage: u } = await generateStructuredWithUsage({
      schema: competitiveSchema,
      tier: agentTier(input),
      largeOutput: true,
      system: input.agent?.systemPrompt,
      prompt: `You are the competitive analysis worker in an AI workforce.
Overall task: "${input.taskPrompt}"
Your assignment: ${input.description}${upstreamBlock(input.upstream)}${sourceBlock}${feedbackBlock(input.feedback)}

Build a structured competitive analysis:
- competitors: the companies/products the task is about (respect any number the task asks for, e.g. "top 5"). Positioning, pricing, key features, and a company-specific SWOT (strengths, weaknesses, opportunities, threats - relative to the other competitors, not generic industry statements); evidence = ids of sources that support the profile.
- swot: for the market/subject as a whole (or the user's company if one is named).
- dataPoints: at least one comparable numeric metric per competitor, using the SAME metric names across competitors so they can be compared (revenue, market share, units sold, price, funding...). basis "sourced" ONLY when the exact figure is written in the cited source; otherwise "estimate" with sourceId null. Use plain numbers (1.2 billion -> 1200000000; 23% -> 23 with unit "%").
- keyTakeaways: what the comparison means for the user.
All free-text fields (positioning, SWOT entries, keyTakeaways, etc.): ${LANGUAGE_RULE}`,
    });
    usage = addUsage(usage, u);
    const v = validateCompetitive(object, sources);
    const dataset = dataPointsToDataset(v.dataPoints);
    const body = renderCompetitive(object.subject, v.competitors, object.swot, v.dataPoints, object.keyTakeaways);
    const notes: string[] = [];
    if (v.downgraded) notes.push(`${v.downgraded} figure(s) the model marked as sourced were not found in the cited page and are shown as estimates.`);
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
        competitors: v.competitors,
        swot: object.swot,
        dataPoints: v.dataPoints,
        datasets: dataset ? [dataset] : [],
        citationCheck: { cited: [...new Set(v.competitors.flatMap((c) => c.evidence))], invalid: v.invalidEvidence, unknownUrls: [], uncitedSourcedClaims: [] },
        toolCalls: calls,
        mode: "structured",
      },
    };
  } catch (err) {
    // Structured output failed validation: fall back to a free-form analysis,
    // labeled as such (no structured comparables for downstream steps).
    console.error("[CompetitiveAnalysis] structured generation failed, using free-form:", err);
    const { text, usage: u } = await generateWorkerText(
      input,
      `You are the competitive analysis worker in an AI workforce.
Overall task: "${input.taskPrompt}"
Your assignment: ${input.description}${upstreamBlock(input.upstream)}${sourceBlock}${feedbackBlock(input.feedback)}

Write markdown: a comparison table (company, positioning, pricing, key features), strengths/weaknesses per company, a SWOT, and key takeaways. Tag sourced statements with [S#] ids from the list; mark everything else as an estimate. Do not write URLs or a Sources section. ${LANGUAGE_RULE}`,
    );
    usage = addUsage(usage, u);
    return { output: text, source: "sarvam", usage, artifacts: { sources: ownSources, webSearch, toolCalls: calls, mode: "freeform" } };
  }
}
