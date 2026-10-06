// Deterministic data engine for the Data Analyst capability. Pure (no I/O,
// no model): parses tables out of text (markdown, CSV, JSON) and computes
// statistics. Every number a data-analysis deliverable reports is produced
// here, not by LLM arithmetic.

import { evaluate, CalcError } from "@/lib/manager/calc";

export type Cell = string | number | null;

export interface Dataset {
  name: string;
  columns: string[];
  rows: Record<string, Cell>[];
  // Where the data came from (e.g. "markdown table in competitive_analysis",
  // "user-supplied CSV"), shown next to every computed result.
  provenance: string;
}

// ── number parsing ─────────────────────────────────────────────────────

const SCALE_WORDS: Array<[RegExp, number]> = [
  [/^(t|tn|trillion)$/i, 1e12],
  [/^(b|bn|billion)$/i, 1e9],
  [/^(m|mn|mm|million)$/i, 1e6],
  [/^(k|thousand)$/i, 1e3],
  [/^(cr|crore|crores)$/i, 1e7],
  [/^(l|lakh|lakhs|lac)$/i, 1e5],
];

export interface ParsedNumber {
  value: number;
  unit: string | null; // "%", "x", "$", "₹", ... (scale already applied to value)
}

// Parses a human-written figure: "$1.2B", "₹45,000 Cr", "12.5%", "(3.4)",
// "~2.1 million", "3.5x". Ranges ("10-12") and free text return null - an
// ambiguous figure must not silently become a number.
export function parseNumber(raw: Cell): ParsedNumber | null {
  if (raw === null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? { value: raw, unit: null } : null;
  let s = raw.trim().replace(/\*\*/g, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^[~≈]|^approx\.?\s*|^about\s+/i, "").trim();
  let unit: string | null = null;
  const currency = s.match(/^(US\$|\$|₹|€|£|¥|Rs\.?|INR|USD|EUR)\s*/i);
  if (currency) {
    unit = currency[1].toUpperCase().replace(/\.$/, "");
    s = s.slice(currency[0].length);
  }
  if (/^[−-]/.test(s)) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  const m = s.match(/^(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d+)?\s*([a-zA-Z%x]+)?\.?$/);
  if (!m) return null;
  let value = Number(`${m[1].replace(/,/g, "")}${m[2] ?? ""}`);
  const suffix = m[3];
  if (suffix) {
    if (suffix === "%") unit = "%";
    else if (suffix.toLowerCase() === "x") unit = "x";
    else {
      const scale = SCALE_WORDS.find(([re]) => re.test(suffix));
      if (!scale) {
        // Trailing currency code ("120 USD") is fine; anything else is not a number.
        if (/^(usd|inr|eur|gbp)$/i.test(suffix)) unit = suffix.toUpperCase();
        else return null;
      } else value *= scale[1];
    }
  }
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, unit };
}

// ── table parsing ──────────────────────────────────────────────────────

function cleanCell(c: string): Cell {
  const t = c.trim().replace(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g, "").trim();
  return t === "" || /^(n\/?a|—|-|–|unknown|not disclosed)$/i.test(t) ? null : t;
}

function uniqueColumns(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h, i) => {
    const base = h.trim().replace(/\*\*/g, "") || `col_${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}_${n + 1}`;
  });
}

export function parseMarkdownTables(text: string, provenance: string): Dataset[] {
  const lines = text.split(/\r?\n/);
  const out: Dataset[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i]?.trim();
    const sep = lines[i + 1]?.trim();
    if (header?.startsWith("|") && sep && /^\|?[\s:|-]+\|?$/.test(sep) && sep.includes("-")) {
      const split = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
      const columns = uniqueColumns(split(header));
      const rows: Record<string, Cell>[] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        const cells = split(lines[j]);
        rows.push(Object.fromEntries(columns.map((c, k) => [c, cleanCell(cells[k] ?? "")])));
        j++;
      }
      if (rows.length > 0) out.push({ name: `table_${out.length + 1}`, columns, rows, provenance });
      i = j;
    } else i++;
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

export function parseCsv(text: string, name: string, provenance: string): Dataset | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const columns = uniqueColumns(splitCsvLine(lines[0]));
  if (columns.length < 2) return null;
  const rows = lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    return Object.fromEntries(columns.map((c, k) => [c, cleanCell(cells[k] ?? "")]));
  });
  return { name, columns, rows, provenance };
}

function jsonToDataset(value: unknown, name: string, provenance: string): Dataset | null {
  let arr: unknown = value;
  if (arr && typeof arr === "object" && !Array.isArray(arr)) {
    const obj = arr as Record<string, unknown>;
    const inner = Object.values(obj).find((v) => Array.isArray(v) && v.length > 0 && typeof v[0] === "object");
    if (inner) arr = inner;
  }
  if (!Array.isArray(arr) || arr.length === 0 || !arr.every((r) => r && typeof r === "object" && !Array.isArray(r))) return null;
  const columns = [...new Set(arr.flatMap((r) => Object.keys(r as object)))];
  const rows = arr.map((r) =>
    Object.fromEntries(
      columns.map((c) => {
        const v = (r as Record<string, unknown>)[c];
        return [c, typeof v === "number" ? v : v === null || v === undefined ? null : cleanCell(String(v))];
      }),
    ),
  );
  return { name, columns, rows, provenance };
}

// Pulls every dataset it can find out of free text: fenced ```csv / ```json
// blocks, bare JSON, a bare CSV block, and markdown tables.
export function extractDatasets(text: string, provenance: string): Dataset[] {
  const found: Dataset[] = [];
  let rest = text;
  for (const m of text.matchAll(/```(csv|json)?\s*\n([\s\S]*?)```/gi)) {
    const lang = (m[1] ?? "").toLowerCase();
    const body = m[2];
    const name = `${lang || "block"}_${found.length + 1}`;
    let ds: Dataset | null = null;
    if (lang === "json" || (!lang && /^\s*[[{]/.test(body))) {
      try {
        ds = jsonToDataset(JSON.parse(body), name, provenance);
      } catch {
        ds = null;
      }
    } else if (lang === "csv" || (!lang && body.includes(","))) ds = parseCsv(body, name, provenance);
    if (ds) found.push(ds);
    rest = rest.replace(m[0], "");
  }
  const trimmed = rest.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      const ds = jsonToDataset(JSON.parse(trimmed), `json_${found.length + 1}`, provenance);
      if (ds) found.push(ds);
    } catch {
      /* not JSON */
    }
  }
  // Bare CSV: >=3 consecutive plain lines with the same comma count, short
  // header cells and at least one numeric column - so prose with commas is
  // not mistaken for data.
  const lines = rest.split(/\r?\n/);
  const csvLike = (l: string) => /,/.test(l) && !/^\s*([|#>*•-]|\d+[.)]\s)/.test(l);
  let block: string[] = [];
  const flush = () => {
    if (block.length >= 3) {
      const ds = parseCsv(block.join("\n"), `csv_${found.length + 1}`, provenance);
      if (ds && ds.columns.every((c) => c.length <= 40) && ds.columns.some((c) => isNumericColumn(ds, c))) found.push(ds);
    }
    block = [];
  };
  for (const l of lines) {
    const commas = (l.match(/,/g) ?? []).length;
    const prev = block.length > 0 ? (block[0].match(/,/g) ?? []).length : null;
    if (csvLike(l) && (prev === null || commas === prev)) block.push(l);
    else {
      flush();
      if (csvLike(l)) block.push(l);
    }
  }
  flush();
  for (const t of parseMarkdownTables(rest, provenance)) found.push({ ...t, name: `${t.name}_${found.length + 1}` });
  return found;
}

// ── column helpers ─────────────────────────────────────────────────────

export function numericValues(ds: Dataset, column: string): Array<{ index: number; value: number; unit: string | null }> {
  const out: Array<{ index: number; value: number; unit: string | null }> = [];
  ds.rows.forEach((r, index) => {
    const p = parseNumber(r[column] ?? null);
    if (p) out.push({ index, value: p.value, unit: p.unit });
  });
  return out;
}

export function isNumericColumn(ds: Dataset, column: string): boolean {
  const nonEmpty = ds.rows.filter((r) => r[column] !== null && r[column] !== undefined).length;
  return nonEmpty > 0 && numericValues(ds, column).length / nonEmpty >= 0.6;
}

export function labelColumn(ds: Dataset): string | null {
  return ds.columns.find((c) => !isNumericColumn(ds, c)) ?? null;
}

function labelOf(ds: Dataset, index: number, column: string | null): string {
  const v = column ? ds.rows[index]?.[column] : null;
  return v === null || v === undefined ? `row ${index + 1}` : String(v);
}

function resolveColumn(ds: Dataset, name: string): string {
  if (ds.columns.includes(name)) return name;
  const lower = name.toLowerCase().trim();
  const hit = ds.columns.find((c) => c.toLowerCase().trim() === lower) ?? ds.columns.find((c) => c.toLowerCase().includes(lower));
  if (!hit) throw new CalcError(`column "${name}" not found in ${ds.name} (columns: ${ds.columns.join(", ")})`);
  return hit;
}

// ── statistics ─────────────────────────────────────────────────────────

export function describe(values: number[]) {
  if (values.length === 0) throw new CalcError("no numeric values");
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const stdev = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { count: n, sum, mean, median, min: sorted[0], max: sorted[n - 1], stdev };
}

export function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 3) throw new CalcError("correlation needs at least 3 paired values");
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) throw new CalcError("correlation undefined for a constant column");
  return num / Math.sqrt(dx * dy);
}

export function cagr(start: number, end: number, years: number): number {
  if (start <= 0 || end <= 0) throw new CalcError("CAGR needs positive start and end values");
  if (years <= 0) throw new CalcError("CAGR needs a positive number of years");
  return (end / start) ** (1 / years) - 1;
}

// ── operations ─────────────────────────────────────────────────────────

export type AnalysisOperation =
  | { op: "describe"; dataset: string; column: string }
  | { op: "rank"; dataset: string; column: string; order?: "desc" | "asc"; top?: number }
  | { op: "share"; dataset: string; column: string }
  | { op: "concentration"; dataset: string; column: string; top?: number }
  | { op: "growth"; dataset: string; fromColumn: string; toColumn: string }
  | { op: "cagr"; dataset: string; startColumn: string; endColumn: string; years: number }
  | { op: "ratio"; dataset: string; numerator: string; denominator: string }
  | { op: "correlation"; dataset: string; columnA: string; columnB: string }
  | { op: "expression"; label: string; expression: string };

export interface AnalysisResult {
  op: string;
  label: string;
  ok: boolean;
  provenance?: string;
  // Scalar results (label -> value) and per-row results; both are numbers
  // computed here.
  values?: Record<string, number>;
  rows?: Array<{ label: string; value: number }>;
  // Unit of `rows` values, and of each scalar in `values` (missing key =
  // unitless, e.g. counts, HHI, correlation).
  unit?: string | null;
  valueUnits?: Record<string, string | null>;
  error?: string;
}

function datasetByName(datasets: Dataset[], name: string): Dataset {
  const ds = datasets.find((d) => d.name === name) ?? datasets.find((d) => d.name.toLowerCase() === name.toLowerCase());
  if (!ds) throw new CalcError(`dataset "${name}" not found (have: ${datasets.map((d) => d.name).join(", ") || "none"})`);
  return ds;
}

function commonUnit(vals: Array<{ unit: string | null }>): string | null {
  const units = new Set(vals.map((v) => v.unit));
  return units.size === 1 ? [...units][0] : null;
}

export function runOperation(datasets: Dataset[], op: AnalysisOperation): AnalysisResult {
  try {
    if (op.op === "expression") {
      return { op: op.op, label: op.label, ok: true, values: { result: evaluate(op.expression) } };
    }
    const ds = datasetByName(datasets, op.dataset);
    const lab = labelColumn(ds);
    const base = { op: op.op, provenance: ds.provenance };
    switch (op.op) {
      case "describe": {
        const col = resolveColumn(ds, op.column);
        const vals = numericValues(ds, col);
        const unit = commonUnit(vals);
        const values = describe(vals.map((v) => v.value));
        const valueUnits = Object.fromEntries(Object.keys(values).filter((k) => k !== "count").map((k) => [k, unit]));
        return { ...base, label: `${col} (${ds.name})`, ok: true, values, unit, valueUnits };
      }
      case "rank": {
        const col = resolveColumn(ds, op.column);
        const vals = numericValues(ds, col);
        if (vals.length === 0) throw new CalcError(`no numeric values in ${col}`);
        const sorted = [...vals].sort((a, b) => (op.order === "asc" ? a.value - b.value : b.value - a.value));
        return {
          ...base,
          label: `Ranking by ${col}`,
          ok: true,
          rows: sorted.slice(0, op.top ?? sorted.length).map((v) => ({ label: labelOf(ds, v.index, lab), value: v.value })),
          unit: commonUnit(vals),
        };
      }
      case "share": {
        const col = resolveColumn(ds, op.column);
        const vals = numericValues(ds, col);
        // Re-normalising a column that is already a percentage (e.g. market
        // share of the few listed firms) produces misleading "shares".
        if (commonUnit(vals) === "%" || /%|percent|share/i.test(col)) throw new CalcError(`${col} is already a percentage/share; a share of it is not meaningful`);
        if (vals.some((v) => v.value < 0)) throw new CalcError("shares need non-negative values");
        const total = vals.reduce((a, v) => a + v.value, 0);
        if (total === 0) throw new CalcError("total is zero");
        return {
          ...base,
          label: `Share of total ${col} (among the ${vals.length} listed)`,
          ok: true,
          rows: vals.map((v) => ({ label: labelOf(ds, v.index, lab), value: (v.value / total) * 100 })),
          values: { total },
          unit: "%",
          valueUnits: { total: commonUnit(vals) },
        };
      }
      case "concentration": {
        const col = resolveColumn(ds, op.column);
        const vals = numericValues(ds, col).map((v) => v.value).filter((v) => v >= 0);
        const total = vals.reduce((a, b) => a + b, 0);
        if (total === 0) throw new CalcError("total is zero");
        const shares = vals.map((v) => (v / total) * 100).sort((a, b) => b - a);
        const n = Math.min(op.top ?? 3, shares.length);
        return {
          ...base,
          label: `Concentration of ${col}`,
          ok: true,
          values: { [`top${n}SharePct`]: shares.slice(0, n).reduce((a, b) => a + b, 0), hhi: shares.reduce((a, s) => a + s * s, 0), entities: shares.length },
          valueUnits: { [`top${n}SharePct`]: "%" },
        };
      }
      case "growth": {
        const from = resolveColumn(ds, op.fromColumn);
        const to = resolveColumn(ds, op.toColumn);
        const rows: Array<{ label: string; value: number }> = [];
        ds.rows.forEach((r, i) => {
          const a = parseNumber(r[from] ?? null);
          const b = parseNumber(r[to] ?? null);
          if (a && b && a.value !== 0) rows.push({ label: labelOf(ds, i, lab), value: ((b.value - a.value) / Math.abs(a.value)) * 100 });
        });
        if (rows.length === 0) throw new CalcError("no rows with both values");
        return { ...base, label: `Growth ${from} → ${to}`, ok: true, rows, unit: "%" };
      }
      case "cagr": {
        const s = resolveColumn(ds, op.startColumn);
        const e = resolveColumn(ds, op.endColumn);
        const rows: Array<{ label: string; value: number }> = [];
        ds.rows.forEach((r, i) => {
          const a = parseNumber(r[s] ?? null);
          const b = parseNumber(r[e] ?? null);
          if (a && b && a.value > 0 && b.value > 0) rows.push({ label: labelOf(ds, i, lab), value: cagr(a.value, b.value, op.years) * 100 });
        });
        if (rows.length === 0) throw new CalcError("no rows with positive start and end values");
        return { ...base, label: `CAGR ${s} → ${e} over ${op.years}y`, ok: true, rows, unit: "%" };
      }
      case "ratio": {
        const nCol = resolveColumn(ds, op.numerator);
        const dCol = resolveColumn(ds, op.denominator);
        const rows: Array<{ label: string; value: number }> = [];
        ds.rows.forEach((r, i) => {
          const a = parseNumber(r[nCol] ?? null);
          const b = parseNumber(r[dCol] ?? null);
          if (a && b && b.value !== 0) rows.push({ label: labelOf(ds, i, lab), value: a.value / b.value });
        });
        if (rows.length === 0) throw new CalcError("no rows with both values");
        return { ...base, label: `${nCol} / ${dCol}`, ok: true, rows, unit: "x" };
      }
      case "correlation": {
        const a = resolveColumn(ds, op.columnA);
        const b = resolveColumn(ds, op.columnB);
        const xs: number[] = [];
        const ys: number[] = [];
        for (const r of ds.rows) {
          const x = parseNumber(r[a] ?? null);
          const y = parseNumber(r[b] ?? null);
          if (x && y) {
            xs.push(x.value);
            ys.push(y.value);
          }
        }
        return { ...base, label: `Correlation ${a} vs ${b}`, ok: true, values: { pearsonR: pearson(xs, ys), n: xs.length } };
      }
    }
  } catch (err) {
    const label = "label" in op ? op.label : `${op.op} on ${op.dataset}`;
    return { op: op.op, label, ok: false, error: err instanceof Error ? err.message : "operation failed" };
  }
}

// Default plan when no model is available to choose: describe + rank +
// share for every numeric column of every dataset (bounded).
export function defaultOperations(datasets: Dataset[], max = 12): AnalysisOperation[] {
  const ops: AnalysisOperation[] = [];
  for (const ds of datasets) {
    for (const col of ds.columns.filter((c) => isNumericColumn(ds, c))) {
      ops.push({ op: "describe", dataset: ds.name, column: col });
      if (ds.rows.length >= 2) ops.push({ op: "rank", dataset: ds.name, column: col, order: "desc" });
      const vals = numericValues(ds, col);
      if (ds.rows.length >= 2 && vals.every((v) => v.value >= 0) && vals[0]?.unit !== "%") ops.push({ op: "share", dataset: ds.name, column: col });
    }
  }
  return ops.slice(0, max);
}

// ── formatting ─────────────────────────────────────────────────────────

export function formatNumber(v: number, unit?: string | null): string {
  const abs = Math.abs(v);
  let s: string;
  if (unit === "%") s = `${v.toFixed(abs < 10 ? 2 : 1)}%`;
  else if (unit === "x") s = `${v.toFixed(2)}x`;
  else if (abs >= 1e9) s = `${(v / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) s = `${(v / 1e6).toFixed(2)}M`;
  else if (abs >= 1e4) s = `${Math.round(v).toLocaleString("en-US")}`;
  else s = Number.isInteger(v) ? String(v) : v.toFixed(abs < 1 ? 4 : 2);
  const prefix = unit && unit !== "%" && unit !== "x" ? `${unit} ` : "";
  return `${prefix}${s}`;
}

export function renderResults(results: AnalysisResult[]): string {
  const blocks: string[] = [];
  for (const r of results) {
    if (!r.ok) {
      blocks.push(`**${r.label}** — not computed: ${r.error}`);
      continue;
    }
    const lines = [`**${r.label}**${r.provenance ? ` _(data: ${r.provenance})_` : ""}`];
    if (r.rows) {
      lines.push("", "| # | Item | Value |", "|---|---|---|");
      r.rows.forEach((row, i) => lines.push(`| ${i + 1} | ${row.label} | ${formatNumber(row.value, r.unit)} |`));
    }
    if (r.values) {
      const entries = Object.entries(r.values).map(([k, v]) => `${k}: ${formatNumber(v, r.valueUnits?.[k] ?? null)}`);
      lines.push("", entries.join(" · "));
    }
    blocks.push(lines.join("\n").trim());
  }
  return blocks.join("\n\n");
}

// Numbers written in text, both as written and with a following scale word
// applied ("1.2 billion" -> 1.2 and 1.2e9).
export function numbersInText(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*(trillion|tn|billion|bn|million|mn|crores?|cr|lakhs?|thousand|[TBMK])?\b/gi)) {
    const v = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    out.push(v);
    const scale = m[2] ? SCALE_WORDS.find(([re]) => re.test(m[2])) : undefined;
    if (scale) out.push(v * scale[1]);
  }
  return out;
}

// True when `value` is written somewhere in `text` (within 1.5%, at any scale).
export function valueAppearsIn(value: number, text: string): boolean {
  return numbersInText(text).some((n) => {
    const scale = Math.max(Math.abs(n), Math.abs(value));
    return scale === 0 || Math.abs(n - value) / scale <= 0.015;
  });
}

// Every number that appears in the given texts (inputs + computed results),
// used to check that a narrative only quotes figures that exist.
export function collectNumbers(texts: string[], computed: AnalysisResult[]): number[] {
  const nums: number[] = [];
  for (const t of texts) nums.push(...numbersInText(t));
  for (const r of computed) {
    if (!r.ok) continue;
    for (const v of Object.values(r.values ?? {})) nums.push(v);
    for (const row of r.rows ?? []) nums.push(row.value);
  }
  return nums.filter(Number.isFinite);
}

// Figures in `narrative` that match none of `known` at any common display
// scale (raw, thousands, millions, billions, crore, lakh) within 1.5%.
// Years and small counts (<= 10) are ignored: they are rarely computed claims.
export function ungroundedNumbers(narrative: string, known: number[]): string[] {
  const scales = [1, 1e3, 1e6, 1e9, 1e12, 1e7, 1e5, 0.01, 100];
  const out: string[] = [];
  for (const m of narrative.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const token = m[0];
    const v = Math.abs(Number(token.replace(/,/g, "")));
    if (!Number.isFinite(v)) continue;
    if (v <= 10 && Number.isInteger(v)) continue;
    if (Number.isInteger(v) && v >= 1900 && v <= 2100) continue;
    const ok = known.some((k) =>
      scales.some((s) => {
        const target = Math.abs(k) / s;
        return target === 0 ? v === 0 : Math.abs(v - target) / Math.max(target, 1e-9) <= 0.015;
      }),
    );
    if (!ok) out.push(token);
  }
  return [...new Set(out)];
}
