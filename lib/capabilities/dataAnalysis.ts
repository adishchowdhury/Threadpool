import { z } from "zod";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import { generateStructuredWithUsage } from "@/lib/manager/structuredGenerate";
import { SourceRegistry } from "@/lib/capabilities/sources";
import { addUsage, agentTier, feedbackBlock, generateWorkerText, LANGUAGE_RULE, type Usage } from "@/lib/capabilities/llm";
import { toolContext } from "@/lib/capabilities/common";
import { invokeTool, upstreamLookupTool } from "@/lib/tools/registry";
import { analyzeDataTool, analysisOperationSchema } from "@/lib/tools/analysis";
import {
  collectNumbers,
  defaultOperations,
  extractDatasets,
  isNumericColumn,
  numbersInText,
  renderResults,
  ungroundedNumbers,
  valueAppearsIn,
  type AnalysisOperation,
  type AnalysisResult,
  type Dataset,
} from "@/lib/tools/dataEngine";
import type { ToolCallRecord } from "@/lib/tools/types";
import type { CapabilityRunInput, CapabilityRunOutput } from "@/lib/capabilities/types";

// Data Analyst: finds the data (user-supplied CSV/JSON/tables, structured
// comparables from upstream, tables in upstream outputs), lets the model
// choose WHICH analyses to run, and computes every number with the
// deterministic engine. The narrative is then checked: any figure that is
// not traceable to the inputs or the computed results is flagged.

const MAX_DATASETS = 8;
const MAX_ROWS = 200;

function dedupeNames(datasets: Dataset[]): Dataset[] {
  const used = new Set<string>();
  return datasets.map((d) => {
    let name = d.name.replace(/[^a-zA-Z0-9_]/g, "_");
    for (let i = 2; used.has(name); i++) name = `${d.name}_${i}`;
    used.add(name);
    return { ...d, name, rows: d.rows.slice(0, MAX_ROWS) };
  });
}

export function gatherDatasets(input: Pick<CapabilityRunInput, "taskPrompt" | "upstream">, structured: Dataset[]): Dataset[] {
  const all: Dataset[] = [
    ...extractDatasets(input.taskPrompt, "user-supplied data in the task"),
    ...structured,
    ...input.upstream.flatMap((u) => (u.artifacts?.datasets?.length ? [] : extractDatasets(u.output, `table in ${u.type} output`))),
  ];
  return dedupeNames(all.filter((d) => d.columns.some((c) => isNumericColumn(d, c)))).slice(0, MAX_DATASETS);
}

const extractionSchema = z.object({
  datasets: z
    .array(
      z.object({
        name: z.string(),
        columns: z.array(z.string()).min(2),
        rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).min(1),
      }),
    ),
});

// Last resort when no table exists anywhere: ask the model to tabulate the
// figures written in upstream prose, then keep only numbers that really
// appear in that prose.
async function extractFromProse(input: CapabilityRunInput): Promise<{ datasets: Dataset[]; dropped: number; usage?: Usage }> {
  const corpus = input.upstream.map((u) => u.output).join("\n\n");
  if (!corpus.trim() || numbersInText(corpus).length < 3) return { datasets: [], dropped: 0 };
  const { object, usage } = await generateStructuredWithUsage({
    schema: extractionSchema,
    tier: agentTier(input),
    prompt: `Tabulate the comparable numeric figures written in the material below (one row per entity, one column per metric, first column = entity name). Copy numbers exactly as written; use plain numbers (no units in cells; put units in column names). Do not compute or invent anything.
Assignment context: ${input.description}

Material:
"""
${corpus.slice(0, 12000)}
"""`,
  });
  let dropped = 0;
  const datasets = object.datasets.slice(0, 6).map((d) => {
    const rows = d.rows.slice(0, MAX_ROWS).map((r) =>
      Object.fromEntries(
        d.columns.map((c, i) => {
          const v = r[i] ?? null;
          if (typeof v === "number" && !valueAppearsIn(v, corpus)) {
            dropped++;
            return [c, null];
          }
          return [c, v];
        }),
      ),
    );
    return { name: d.name, columns: d.columns, rows, provenance: "figures tabulated from upstream text (each value verified to appear in it)" };
  });
  return { datasets: dedupeNames(datasets.filter((d) => d.columns.some((c) => isNumericColumn(d, c)))), dropped, usage };
}

function schemaSummary(datasets: Dataset[]): string {
  return datasets
    .map((d) => {
      const numeric = d.columns.filter((c) => isNumericColumn(d, c));
      const sample = d.rows.slice(0, 4).map((r) => JSON.stringify(r)).join("\n  ");
      return `dataset "${d.name}" (${d.rows.length} rows; source: ${d.provenance})\n  columns: ${d.columns.join(" | ")}\n  numeric columns: ${numeric.join(" | ") || "none"}\n  sample rows:\n  ${sample}`;
    })
    .join("\n\n");
}

const planSchema = z.object({ operations: z.array(analysisOperationSchema).min(1) });

async function planOperations(input: CapabilityRunInput, datasets: Dataset[]): Promise<{ ops: AnalysisOperation[]; source: "model" | "default"; usage?: Usage }> {
  if (!isSarvamConfigured()) return { ops: defaultOperations(datasets), source: "default" };
  try {
    const { object, usage } = await generateStructuredWithUsage({
      schema: planSchema,
      tier: agentTier(input),
      prompt: `You are planning a data analysis. Choose the operations (from the schema) that answer the assignment. Use dataset and column names exactly as listed. Do NOT compute anything yourself - the engine runs the operations.
Overall task: "${input.taskPrompt}"
Assignment: ${input.description}${input.feedback ? `\nPrevious attempt was rejected: ${input.feedback}` : ""}

Available data:
${schemaSummary(datasets)}`,
    });
    return { ops: (object.operations as AnalysisOperation[]).slice(0, 12), source: "model", usage };
  } catch {
    return { ops: defaultOperations(datasets), source: "default" };
  }
}

function dataUsedSection(datasets: Dataset[]): string {
  return ["### Data used", ...datasets.map((d) => `- **${d.name}** — ${d.rows.length} rows · columns: ${d.columns.join(", ")} · source: ${d.provenance}`)].join("\n");
}

function deterministicFindings(results: AnalysisResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    if (!r.ok) continue;
    if (r.op === "rank" && r.rows?.length) lines.push(`- ${r.label}: ${r.rows[0].label} is highest; ${r.rows[r.rows.length - 1].label} is lowest.`);
    if (r.op === "share" && r.rows?.length) {
      const top = [...r.rows].sort((a, b) => b.value - a.value)[0];
      lines.push(`- ${r.label}: ${top.label} has the largest share (${top.value.toFixed(1)}%).`);
    }
  }
  return lines.length ? lines.join("\n") : "- See computed results below.";
}

export async function runDataAnalysis(input: CapabilityRunInput): Promise<CapabilityRunOutput> {
  const calls: ToolCallRecord[] = [];
  const ctx = toolContext(input, new SourceRegistry(input.knownSources));
  let usage: Usage | undefined;

  const lookup = await invokeTool(upstreamLookupTool, { kind: "datasets" }, ctx, calls);
  let datasets = gatherDatasets(input, lookup.ok ? lookup.output.datasets : []);
  let extractionNote = "";
  if (datasets.length === 0 && isSarvamConfigured()) {
    try {
      const ex = await extractFromProse(input);
      usage = addUsage(usage, ex.usage);
      datasets = ex.datasets;
      if (ex.dropped) extractionNote = `\n\n> ${ex.dropped} extracted value(s) were discarded because they do not appear in the source material.`;
    } catch (err) {
      console.error("[DataAnalysis] prose extraction failed:", err);
    }
  }

  if (datasets.length === 0) {
    const output = `## Data analysis\n\n> No structured or tabulable numeric data was available to analyse (checked the task input and every upstream output). No figures were computed, and none are reported.`;
    return { output, source: "deterministic", usage, artifacts: { datasets: [], analysis: [], toolCalls: calls, mode: "deterministic", ungroundedNumbers: [] } };
  }

  const plan = await planOperations(input, datasets);
  usage = addUsage(usage, plan.usage);
  const run = await invokeTool(analyzeDataTool, { datasets, operations: plan.ops }, ctx, calls);
  let results = run.ok ? run.output : [];
  // The model's plan computed nothing usable: run the default battery too.
  if (results.filter((r) => r.ok).length === 0) {
    const fallback = await invokeTool(analyzeDataTool, { datasets, operations: defaultOperations(datasets) }, ctx, calls);
    if (fallback.ok) results = [...results, ...fallback.output];
  }
  const computed = renderResults(results);

  let narrative: string;
  let source: string;
  if (isSarvamConfigured()) {
    try {
      const { text, usage: u } = await generateWorkerText(
        input,
        `You are the data analyst in an AI workforce. Interpret the computed results below for the assignment.
Overall task: "${input.taskPrompt}"
Assignment: ${input.description}${feedbackBlock(input.feedback)}

Computed results (produced by a deterministic analysis engine - these are the ONLY figures you may quote):
${computed}

Write 4-8 markdown bullets of findings. Quote figures exactly as shown above (you may round to fewer decimals). Do NOT do any new arithmetic, do not introduce figures that are not shown, and say plainly when the data is too thin to support a conclusion. No headings, no preamble. ${LANGUAGE_RULE}`,
      );
      usage = addUsage(usage, u);
      narrative = text;
      source = `sarvam+analysis_engine(${plan.source}_plan)`;
    } catch {
      narrative = deterministicFindings(results);
      source = "analysis_engine";
    }
  } else {
    narrative = deterministicFindings(results);
    source = "analysis_engine";
  }

  const known = collectNumbers([input.taskPrompt, ...input.upstream.map((u) => u.output), computed], results);
  const ungrounded = ungroundedNumbers(narrative, known);
  const warn = ungrounded.length ? `\n\n> ⚠ Figures in the findings not traceable to the data or computed results: ${ungrounded.join(", ")}` : "";

  const output = `## Data analysis\n\n### Key findings\n${narrative}${warn}\n\n### Computed results (deterministic analysis engine)\n\n${computed}\n\n${dataUsedSection(datasets)}${extractionNote}`;
  return {
    output,
    source,
    usage,
    artifacts: { datasets, analysis: results, ungroundedNumbers: ungrounded, toolCalls: calls, mode: "structured" },
  };
}
