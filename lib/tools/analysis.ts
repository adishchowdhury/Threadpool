import { z } from "zod";
import { evaluate } from "@/lib/manager/calc";
import { runOperation, type AnalysisOperation, type AnalysisResult, type Dataset } from "@/lib/tools/dataEngine";
import type { AgentTool } from "@/lib/tools/types";

// Programmatic analysis tools. A model may PROPOSE which operations to run
// (validated by these schemas); the numbers always come from the
// deterministic engine in dataEngine.ts.

const datasetRef = z.string().min(1);

export const analysisOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("describe"), dataset: datasetRef, column: z.string() }),
  z.object({ op: z.literal("rank"), dataset: datasetRef, column: z.string(), order: z.enum(["desc", "asc"]).optional(), top: z.number().int().min(1).max(50).optional() }),
  z.object({ op: z.literal("share"), dataset: datasetRef, column: z.string() }),
  z.object({ op: z.literal("concentration"), dataset: datasetRef, column: z.string(), top: z.number().int().min(1).max(10).optional() }),
  z.object({ op: z.literal("growth"), dataset: datasetRef, fromColumn: z.string(), toColumn: z.string() }),
  z.object({ op: z.literal("cagr"), dataset: datasetRef, startColumn: z.string(), endColumn: z.string(), years: z.number().positive().max(100) }),
  z.object({ op: z.literal("ratio"), dataset: datasetRef, numerator: z.string(), denominator: z.string() }),
  z.object({ op: z.literal("correlation"), dataset: datasetRef, columnA: z.string(), columnB: z.string() }),
  z.object({ op: z.literal("expression"), label: z.string(), expression: z.string().max(300) }),
]);

export const analyzeDataTool: AgentTool<{ datasets: Dataset[]; operations: AnalysisOperation[] }, AnalysisResult[]> = {
  name: "analyze_data",
  description: "Run statistics (describe, rank, share, concentration, growth, CAGR, ratio, correlation, expressions) over datasets.",
  input: z.object({
    datasets: z.array(z.custom<Dataset>((v) => Boolean(v && typeof v === "object" && "rows" in (v as object)))),
    operations: z.array(analysisOperationSchema).max(20),
  }) as unknown as z.ZodType<{ datasets: Dataset[]; operations: AnalysisOperation[] }>,
  async run({ datasets, operations }) {
    return operations.map((op) => runOperation(datasets, op));
  },
  summarize(results) {
    const ok = results.filter((r) => r.ok).length;
    return `${ok}/${results.length} operations computed`;
  },
};

export const calculateTool: AgentTool<{ expression: string }, { expression: string; result: number }> = {
  name: "calculate",
  description: "Evaluate an arithmetic expression (+ - * / ^ parentheses) deterministically.",
  input: z.object({ expression: z.string().min(1).max(300) }),
  async run({ expression }) {
    return { expression, result: evaluate(expression) };
  },
  summarize(o) {
    return `${o.expression} = ${o.result}`;
  },
};
