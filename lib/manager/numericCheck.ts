import { z } from "zod";
import { evaluate, CalcError } from "@/lib/manager/calc";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import { generateStructured } from "@/lib/manager/structuredGenerate";

// Numeric consistency check for a finished report. Sarvam's only job is to
// EXTRACT the arithmetic claims the text makes (how a figure is derived and
// what it is said to equal). Kraven then recomputes every claim with a
// deterministic evaluator (lib/manager/calc.ts) and compares. The model never
// decides whether a number is right.

const claimsSchema = z.object({
  claims: z
    .array(
      z.object({
        description: z.string(),
        // The exact sentence from the report that states the result. Kraven
        // verifies it really appears in the report, so a claim the model
        // paraphrased or invented is never reported as the author's error.
        quote: z.string(),
        // Plain numbers and + - * / ^ ( ) only, in consistent units
        // (12M -> 12000000, 5% -> 0.05).
        expression: z.string(),
        claimedResult: z.number(),
      }),
    )
    .max(12),
});

export type NumericCheckStatus = "consistent" | "mismatch" | "unevaluable";

export interface NumericCheck {
  description: string;
  quote: string;
  expression: string;
  claimed: number;
  computed: number | null;
  relativeError: number | null;
  status: NumericCheckStatus;
  error?: string;
}

export interface NumericCheckReport {
  status: "checked" | "unavailable";
  source: "sarvam_extraction+deterministic_calc" | "none";
  checked: number;
  consistent: number;
  mismatches: number;
  unevaluable: number;
  checks: NumericCheck[];
  reason?: string;
}

const RELATIVE_TOLERANCE = 0.02; // reports round figures; allow 2%
const MAX_TEXT_CHARS = 14000;

const normalize = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

export function compareClaim(
  claim: { description: string; quote: string; expression: string; claimedResult: number },
  reportText: string,
): NumericCheck {
  const base = { description: claim.description, quote: claim.quote, expression: claim.expression, claimed: claim.claimedResult };
  if (!normalize(reportText).includes(normalize(claim.quote))) {
    return { ...base, computed: null, relativeError: null, status: "unevaluable", error: "quoted sentence not found in the report" };
  }
  try {
    const computed = evaluate(claim.expression);
    const scale = Math.max(Math.abs(computed), Math.abs(claim.claimedResult));
    const relativeError = scale === 0 ? 0 : Math.abs(computed - claim.claimedResult) / scale;
    return { ...base, computed, relativeError, status: relativeError <= RELATIVE_TOLERANCE ? "consistent" : "mismatch" };
  } catch (err) {
    return {
      ...base,
      computed: null,
      relativeError: null,
      status: "unevaluable",
      error: err instanceof CalcError ? err.message : "could not evaluate",
    };
  }
}

export async function checkReportNumbers(reportText: string): Promise<NumericCheckReport> {
  const empty = { checked: 0, consistent: 0, mismatches: 0, unevaluable: 0, checks: [] as NumericCheck[] };
  if (!isSarvamConfigured()) {
    return { status: "unavailable", source: "none", ...empty, reason: "SARVAM_API_KEY is not set" };
  }

  try {
    const { claims } = await generateStructured({
      schema: claimsSchema,
      prompt: `Extract the explicit arithmetic claims from the report below: places where the text shows how a figure is derived from other figures AND states the result (for example runway = cash / monthly burn, an LTV:CAC ratio, a CAGR, a percentage share, a sum of segment sizes).
Rules:
- Only include claims where BOTH the inputs and the stated result appear in the text. Never invent numbers or infer missing ones.
- "quote" must be copied verbatim from the report: the sentence that states the result.
- "expression" must use only plain numbers and + - * / ^ ( ). Convert units first (12M -> 12000000, 5% -> 0.05, $1.2B -> 1200000000). A CAGR over n years is (end / start) ^ (1 / n) - 1.
- "claimedResult" is the result the text states, as a plain number in the same units as the expression's result.
- If there are no such claims, return an empty list.

Report:
"""
${reportText.slice(0, MAX_TEXT_CHARS)}
"""`,
    });

    const checks = claims.map((c) => compareClaim(c, reportText));
    return {
      status: "checked",
      source: "sarvam_extraction+deterministic_calc",
      checked: checks.length,
      consistent: checks.filter((c) => c.status === "consistent").length,
      mismatches: checks.filter((c) => c.status === "mismatch").length,
      unevaluable: checks.filter((c) => c.status === "unevaluable").length,
      checks,
    };
  } catch (err) {
    return { status: "unavailable", source: "none", ...empty, reason: err instanceof Error ? err.message : "claim extraction failed" };
  }
}
