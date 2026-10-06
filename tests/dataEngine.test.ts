import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cagr,
  defaultOperations,
  describe as describeStats,
  extractDatasets,
  parseNumber,
  runOperation,
  ungroundedNumbers,
  valueAppearsIn,
  collectNumbers,
  renderResults,
} from "@/lib/tools/dataEngine";

test("parseNumber handles currency, scale words, percent, negatives", () => {
  assert.deepEqual(parseNumber("$1.2B"), { value: 1.2e9, unit: "$" });
  assert.deepEqual(parseNumber("₹45,000 Cr"), { value: 45000 * 1e7, unit: "₹" });
  assert.deepEqual(parseNumber("12.5%"), { value: 12.5, unit: "%" });
  assert.deepEqual(parseNumber("(3.4)"), { value: -3.4, unit: null });
  assert.deepEqual(parseNumber("3.5x"), { value: 3.5, unit: "x" });
  assert.equal(parseNumber("~2.1 million")?.value, 2.1e6);
  assert.equal(parseNumber("10-12"), null, "ranges are ambiguous and must not become numbers");
  assert.equal(parseNumber("about forty"), null);
  assert.equal(parseNumber("n/a"), null);
});

const CSV = "```csv\ncompany,rev_2022,rev_2024,employees\nA,100,200,10\nB,300,330,30\nC,50,100,5\n```";

test("extractDatasets finds fenced CSV, JSON and markdown tables", () => {
  const csv = extractDatasets(CSV, "test");
  assert.equal(csv.length, 1);
  assert.deepEqual(csv[0].columns, ["company", "rev_2022", "rev_2024", "employees"]);
  assert.equal(csv[0].rows.length, 3);

  const json = extractDatasets('```json\n[{"name":"A","units":10},{"name":"B","units":20}]\n```', "test");
  assert.equal(json.length, 1);
  assert.equal(json[0].rows[1].units, 20);

  const md = extractDatasets("| Company | Share |\n|---|---|\n| X | 40% [S1] |\n| Y | 60% |", "test");
  assert.equal(md.length, 1);
  assert.equal(md[0].rows[0].Share, "40%", "citation tags are stripped from cells");
});

test("extractDatasets does not mistake comma-separated prose for data", () => {
  const prose = "Tata Motors leads, followed by MG, and Mahindra.\nOla is strong, but Ather is growing, too.\nPolicy matters, as FAME shows, clearly.";
  assert.equal(extractDatasets(prose, "test").length, 0);
});

test("statistics are computed exactly", () => {
  const s = describeStats([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(s.mean, 5);
  assert.equal(s.median, 4.5);
  assert.equal(s.min, 2);
  assert.equal(s.max, 9);
  assert.ok(Math.abs(s.stdev - 2.138) < 0.001);
  assert.ok(Math.abs(cagr(100, 121, 2) - 0.1) < 1e-12);
  assert.throws(() => cagr(0, 10, 2));
});

test("operations run against parsed datasets", () => {
  const [ds] = extractDatasets(CSV, "test");
  const rank = runOperation([ds], { op: "rank", dataset: ds.name, column: "rev_2024" });
  assert.ok(rank.ok);
  assert.deepEqual(rank.rows?.map((r) => r.label), ["B", "A", "C"]);

  const share = runOperation([ds], { op: "share", dataset: ds.name, column: "rev_2024" });
  assert.ok(share.ok);
  assert.ok(Math.abs(share.rows![0].value - (200 / 630) * 100) < 1e-9);

  const growth = runOperation([ds], { op: "growth", dataset: ds.name, fromColumn: "rev_2022", toColumn: "rev_2024" });
  assert.deepEqual(growth.rows?.map((r) => Math.round(r.value)), [100, 10, 100]);

  const ratio = runOperation([ds], { op: "ratio", dataset: ds.name, numerator: "rev_2024", denominator: "employees" });
  assert.deepEqual(ratio.rows?.map((r) => r.value), [20, 11, 20]);

  const conc = runOperation([ds], { op: "concentration", dataset: ds.name, column: "rev_2024", top: 1 });
  assert.ok(Math.abs(conc.values!.top1SharePct - (330 / 630) * 100) < 1e-9);

  const corr = runOperation([ds], { op: "correlation", dataset: ds.name, columnA: "rev_2024", columnB: "employees" });
  assert.ok(corr.ok && corr.values!.pearsonR > 0.9);

  const bad = runOperation([ds], { op: "describe", dataset: ds.name, column: "does_not_exist" });
  assert.equal(bad.ok, false);
  assert.match(bad.error!, /not found/);

  const expr = runOperation([], { op: "expression", label: "x", expression: "(200/100)^(1/2)-1" });
  assert.ok(Math.abs(expr.values!.result - (Math.SQRT2 - 1)) < 1e-12);
});

test("defaultOperations covers each numeric column", () => {
  const [ds] = extractDatasets(CSV, "test");
  const ops = defaultOperations([ds]);
  assert.ok(ops.some((o) => o.op === "describe" && "column" in o && o.column === "employees"));
  assert.ok(ops.every((o) => o.op !== "describe" || ("column" in o && o.column !== "company")));
});

test("ungroundedNumbers flags figures that nothing computed", () => {
  const known = collectNumbers(["revenue 200 and 330"], [{ op: "share", label: "s", ok: true, rows: [{ label: "B", value: 52.38095 }] }]);
  assert.deepEqual(ungroundedNumbers("B holds 52.4% of revenue (330).", known), []);
  assert.deepEqual(ungroundedNumbers("B holds 61.7% of revenue.", known), ["61.7"]);
  assert.deepEqual(ungroundedNumbers("In 2024, 3 firms grew.", known), [], "years and small counts are ignored");
});

test("valueAppearsIn matches figures across written scales", () => {
  assert.ok(valueAppearsIn(1.2e9, "revenue reached $1.2 billion in FY24"));
  assert.ok(valueAppearsIn(45, "a 45% share"));
  assert.ok(!valueAppearsIn(2.5e9, "revenue reached $1.2 billion"));
});

test("share totals keep the column's unit, and shares of percentages are refused", () => {
  const [ds] = extractDatasets("| Company | Revenue | Market share (%) |\n|---|---|---|\n| A | $300M | 40% |\n| B | $100M | 15% |", "test");
  const share = runOperation([ds], { op: "share", dataset: ds.name, column: "Revenue" });
  assert.ok(share.ok);
  assert.match(renderResults([share]), /total: \$ 400\.00M/);
  assert.doesNotMatch(renderResults([share]), /total: [\d.]+%/);
  const pct = runOperation([ds], { op: "share", dataset: ds.name, column: "Market share (%)" });
  assert.equal(pct.ok, false);
  assert.match(pct.error!, /already a percentage/);
});
