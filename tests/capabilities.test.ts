import { test } from "node:test";
import assert from "node:assert/strict";
import { capabilityRubric } from "@/lib/capabilities/rubric";
import { validateCompetitive, dataPointsToDataset } from "@/lib/capabilities/competitiveAnalysis";
import { gatherDatasets } from "@/lib/capabilities/dataAnalysis";
import { deterministicReportIssues, findReport } from "@/lib/capabilities/review";
import { downstreamOf } from "@/lib/manager/rework";
import { ROSTER } from "@/lib/agents/roster";
import { CAPABILITY_IDS } from "@/lib/capabilities/catalog";
import type { Source } from "@/lib/capabilities/sources";

const src = (id: string, excerpt: string, url = `https://example.com/${id}`): Source => ({
  id,
  url,
  title: id,
  excerpt,
  fetchedAt: "2026-10-05T00:00:00Z",
  query: "q",
  kind: "page",
});

test("every plannable capability has at least two agents to choose between", () => {
  for (const c of CAPABILITY_IDS) {
    const n = ROSTER.filter((a) => a.capabilities.includes(c)).length;
    assert.ok(n >= 2 || c === "review", `${c} has ${n} agent(s)`);
  }
});

test("web research rubric rejects fabricated citations and uncited 'sourced' findings", () => {
  const sources = [src("S1", "x"), src("S2", "y")];
  const output = "## Sourced findings\n- A [S1]\n- B [S9]\n- C\n- D\n## Analysis (model-generated, not from sources)\n- E";
  const r = capabilityRubric(
    "web_research",
    output,
    {
      sources,
      webSearch: { available: true, queries: ["q"] },
      citationCheck: { cited: ["S1"], invalid: ["S9"], unknownUrls: [], uncitedSourcedClaims: ["- C", "- D"] },
    },
    sources,
  );
  assert.ok(r.failures.some((f) => /never retrieved \(S9\)/.test(f)));
  assert.ok(r.failures.some((f) => /carry no source tag/.test(f)));
});

test("web research with no retrievable sources is labeled, not failed", () => {
  const r = capabilityRubric("web_research", "## Web research\n> No live sources", { sources: [], webSearch: { available: false, queries: ["q"], reason: "offline" }, citationCheck: { cited: [], invalid: [], unknownUrls: [], uncitedSourcedClaims: [] } }, []);
  assert.deepEqual(r.failures, []);
  assert.equal(r.notes.length, 1);
});

test("data analysis rubric rejects narrative figures nothing computed", () => {
  const r = capabilityRubric("data_analysis", "x", { datasets: [{ name: "d", columns: ["a"], rows: [], provenance: "p" }], analysis: [{ op: "describe", label: "a", ok: true, values: { mean: 1 } }], ungroundedNumbers: ["61.7", "88.2", "13.9"] }, []);
  assert.ok(r.failures.some((f) => /not in the data or the computed results/.test(f)));
});

test("report rubric rejects links to pages Kraven never fetched", () => {
  const r = capabilityRubric("report_generation", "Growth was strong [S1] (https://invented.example/x).", {}, [src("S1", "x")]);
  assert.ok(r.failures.some((f) => /not among the retrieved sources/.test(f)));
});

test("competitive validation downgrades 'sourced' figures absent from the cited page", () => {
  const sources = [src("S1", "Ola Electric sold 3.2 lakh units in FY24, a 35% share.")];
  const v = validateCompetitive(
    {
      subject: "EV two-wheelers",
      competitors: [
        { name: "Ola", positioning: "p", pricing: "₹1L", keyFeatures: [], strengths: ["s"], weaknesses: ["w"], opportunities: ["o"], threats: ["t"], evidence: ["S1", "S5"] },
        { name: "Ather", positioning: "p", pricing: "₹1.4L", keyFeatures: [], strengths: ["s"], weaknesses: ["w"], opportunities: ["o"], threats: [], evidence: [] },
      ],
      swot: { strengths: ["a"], weaknesses: ["b"], opportunities: ["c"], threats: ["d"] },
      dataPoints: [
        { entity: "Ola", metric: "market share", value: 35, unit: "%", period: "FY24", basis: "sourced", sourceId: "S1" },
        { entity: "Ola", metric: "units", value: 320000, unit: "units", period: "FY24", basis: "sourced", sourceId: "S1" },
        { entity: "Ather", metric: "market share", value: 11, unit: "%", period: "FY24", basis: "sourced", sourceId: "S1" },
      ],
      keyTakeaways: [],
    },
    sources,
  );
  assert.deepEqual(v.invalidEvidence, ["S5"]);
  assert.deepEqual(v.competitors[0].evidence, ["S1"]);
  assert.equal(v.dataPoints[0].basis, "sourced");
  assert.equal(v.dataPoints[1].basis, "sourced", "3.2 lakh == 320,000");
  assert.equal(v.dataPoints[2].basis, "estimate", "11% is not in the cited page");
  assert.equal(v.downgraded, 1);

  const ds = dataPointsToDataset(v.dataPoints)!;
  assert.equal(ds.rows.length, 2);
  assert.ok(ds.columns.includes("market share (%) [FY24]"));
});

test("data analyst gathers user data and upstream tables, preferring structured artifacts", () => {
  const datasets = gatherDatasets(
    {
      taskPrompt: "Rank these:\n```csv\nname,value\nA,1\nB,2\nC,3\n```",
      upstream: [
        { type: "financial_analysis", output: "| Co | Margin |\n|---|---|\n| A | 10% |\n| B | 20% |" },
        // Has structured comparables, so its rendered tables are not re-parsed
        // (the structured copy arrives via upstream_lookup instead).
        {
          type: "competitive_analysis",
          output: "| ignored | 1 |\n|---|---|\n| x | 2 |",
          artifacts: { datasets: [{ name: "competitor_metrics", columns: ["entity", "v"], rows: [{ entity: "x", v: 2 }], provenance: "p" }] },
        },
      ],
    },
    [{ name: "competitor_metrics", columns: ["entity", "share (%)"], rows: [{ entity: "A", "share (%)": 40 }], provenance: "p" }],
  );
  assert.deepEqual(datasets.map((d) => d.provenance), ["user-supplied data in the task", "p", "table in financial_analysis output"]);
});

test("final review deterministically flags fabricated citations and arithmetic mismatches", () => {
  const report = { sequence: 3, type: "report_writing", capability: "report_generation", output: "Share is 40% [S1] and growth 20% [S4]." };
  const issues = deterministicReportIssues(report, [src("S1", "x")], {
    status: "checked",
    source: "sarvam_extraction+deterministic_calc",
    checked: 1,
    consistent: 0,
    mismatches: 1,
    unevaluable: 0,
    checks: [{ description: "d", quote: "q", expression: "10/50", claimed: 0.3, computed: 0.2, relativeError: 0.33, status: "mismatch" }],
  });
  assert.deepEqual(issues.map((i) => [i.category, i.targetSequence, i.origin]), [
    ["citations", 3, "citation_check"],
    ["arithmetic", 3, "numeric_check"],
  ]);
  assert.equal(
    findReport([
      { sequence: 0, type: "web", capability: "web_research", output: "a" },
      { sequence: 1, type: "report", capability: "report_generation", output: "b" },
      { sequence: 2, type: "qa", capability: "quality_verification", output: "c" },
    ])?.sequence,
    1,
  );
});

test("rework re-runs every step downstream of a revised step, in order", () => {
  const rows = [
    { id: "web", sequence: 0, dependsOn: "[]" },
    { id: "comp", sequence: 1, dependsOn: '["web"]' },
    { id: "data", sequence: 2, dependsOn: '["web","comp"]' },
    { id: "fin", sequence: 3, dependsOn: "[]" },
    { id: "report", sequence: 4, dependsOn: '["web","comp","data","fin"]' },
  ];
  assert.deepEqual(downstreamOf(new Set(["comp"]), rows), ["data", "report"]);
  assert.deepEqual(downstreamOf(new Set(["report"]), rows), []);
  assert.deepEqual(downstreamOf(new Set(["fin"]), rows), ["report"]);
});

test("competitive rubric requires a full SWOT per competitor and comparable metrics", () => {
  const profile = (name: string, threats: string[]) => ({ name, positioning: "p", pricing: "x", keyFeatures: [], strengths: ["s"], weaknesses: ["w"], opportunities: ["o"], threats, evidence: [] });
  const r = capabilityRubric(
    "competitive_analysis",
    "x",
    { mode: "structured", competitors: [profile("A", ["t"]), profile("B", [])], swot: { strengths: ["a"], weaknesses: ["b"], opportunities: ["c"], threats: ["d"] }, dataPoints: [] },
    [],
  );
  assert.ok(r.failures.some((f) => /SWOT incomplete for B/.test(f)));
  assert.ok(r.failures.some((f) => /no comparable metrics/.test(f)));
});
