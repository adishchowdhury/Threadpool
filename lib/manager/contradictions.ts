// Deterministic cross-agent contradiction detection. When two agents state a
// figure for the SAME labelled quantity (e.g. "market size") and the values
// disagree materially, the later output is not blindly accepted: the caller
// rejects it so the existing retry / reassignment path runs. Conservative on
// purpose - it only fires when the label, the unit and the magnitude clearly
// conflict, so a rejected output always has a concrete, quotable reason.

export interface FigureClaim {
  label: string; // normalized label words, e.g. "market size"
  value: number; // in base units (12M -> 12_000_000, 5% -> 5 with unit "%")
  unit: "%" | "money" | "plain";
  quote: string;
}

export interface Contradiction {
  label: string;
  current: FigureClaim;
  upstream: FigureClaim;
  upstreamType: string;
  relativeDifference: number;
}

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12, cr: 1e7, crore: 1e7, lakh: 1e5 };
const STOP = new Set(["the", "a", "an", "of", "is", "are", "was", "will", "be", "to", "in", "at", "for", "by", "and", "approx", "approximately", "about", "around", "estimated", "total", "global", "annual", "expected"]);

// "<label words> (is|of|:|=|~) [$|₹|€] number [scale|%]"
const CLAIM_RE = /([A-Za-z][A-Za-z \-]{3,48}?)\s*(?:is|are|was|of|at|:|=|≈|~|reached|stands at|estimated at|valued at)\s*(?:approximately|about|around|roughly|~)?\s*([$₹€£]|USD|INR|Rs\.?)?\s*(\d[\d,]*(?:\.\d+)?)\s*(%|k|thousand|mn|m|million|bn|b|billion|tn|t|trillion|crore|cr|lakh)?(?![A-Za-z0-9])/gi;

function labelOf(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  return words.slice(-2).join(" ");
}

export function extractFigureClaims(text: string): FigureClaim[] {
  const claims: FigureClaim[] = [];
  for (const m of text.matchAll(CLAIM_RE)) {
    const label = labelOf(m[1]);
    if (label.split(" ").filter(Boolean).length < 2) continue; // a single generic word is too ambiguous to compare
    const num = Number(m[3].replace(/,/g, ""));
    if (!Number.isFinite(num)) continue;
    const suffix = (m[4] ?? "").toLowerCase();
    const money = Boolean(m[2]);
    if (suffix === "%") claims.push({ label, value: num, unit: "%", quote: m[0].trim() });
    else claims.push({ label, value: num * (SCALE[suffix] ?? 1), unit: money ? "money" : "plain", quote: m[0].trim() });
  }
  return claims;
}

// Relative difference above which two figures for the same quantity are
// treated as contradictory (reports round, estimates vary: be generous).
export const CONTRADICTION_THRESHOLD = 0.5;

export function findContradictions(current: string, upstream: Array<{ type: string; output: string }>): Contradiction[] {
  const mine = extractFigureClaims(current);
  if (mine.length === 0) return [];
  const found: Contradiction[] = [];
  for (const up of upstream) {
    const theirs = extractFigureClaims(up.output);
    for (const a of mine) {
      for (const b of theirs) {
        if (a.label !== b.label || a.unit !== b.unit) continue;
        const denom = Math.max(Math.abs(a.value), Math.abs(b.value));
        if (denom === 0) continue;
        const diff = Math.abs(a.value - b.value) / denom;
        if (diff > CONTRADICTION_THRESHOLD && !found.some((f) => f.label === a.label && f.upstreamType === up.type)) {
          found.push({ label: a.label, current: a, upstream: b, upstreamType: up.type, relativeDifference: diff });
        }
      }
    }
  }
  return found;
}

export function describeContradiction(c: Contradiction): string {
  return `"${c.current.quote}" conflicts with the ${c.upstreamType} output ("${c.upstream.quote}") for the same quantity (${c.label}).`;
}
