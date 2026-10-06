import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SourceRegistry,
  checkCitations,
  extractCitationIds,
  renderSourcesSection,
  sourcesForText,
  stripInvalidCitations,
  stripModelSourceList,
} from "@/lib/capabilities/sources";

const base = { title: "t", excerpt: "e", fetchedAt: "2026-10-05T00:00:00Z", query: "q", kind: "page" as const };

test("SourceRegistry allocates task-unique ids and dedupes URLs", () => {
  const r1 = new SourceRegistry();
  const a = r1.add({ ...base, url: "https://www.example.com/a?utm_source=x" });
  const b = r1.add({ ...base, url: "https://example.com/b" });
  const a2 = r1.add({ ...base, url: "https://example.com/a" });
  assert.equal(a.id, "S1");
  assert.equal(b.id, "S2");
  assert.equal(a2.id, "S1", "same page after URL canonicalization keeps its id");

  // A later subtask seeded with earlier sources continues numbering.
  const r2 = new SourceRegistry(r1.all());
  assert.equal(r2.add({ ...base, url: "https://other.org/c" }).id, "S3");
});

test("snippet sources are upgraded when the full page is fetched later", () => {
  const r = new SourceRegistry();
  r.add({ ...base, url: "https://x.com/p", kind: "snippet", excerpt: "short" });
  const up = r.add({ ...base, url: "https://x.com/p", kind: "page", excerpt: "full page" });
  assert.equal(up.id, "S1");
  assert.equal(up.kind, "page");
});

const sources = [
  { ...base, id: "S1", url: "https://a.com/1" },
  { ...base, id: "S2", url: "https://b.com/2" },
];

test("checkCitations finds fabricated ids, unknown URLs and uncited sourced claims", () => {
  const text = `## Sourced findings
- EV sales grew 40% [S1]
- Ola leads two-wheelers [S1, S2]
- Ather raised funding
- Tata has 60% share [S7]

## Analysis (model-generated, not from sources)
- Growth will continue. See https://made-up.example/report and https://a.com/1`;
  const cc = checkCitations(text, sources, { sourcedSectionHeading: /sourced findings/i });
  assert.deepEqual(cc.cited.sort(), ["S1", "S2"]);
  assert.deepEqual(cc.invalid, ["S7"]);
  assert.deepEqual(cc.unknownUrls, ["https://made-up.example/report"]);
  assert.equal(cc.uncitedSourcedClaims.length, 1);
  assert.match(cc.uncitedSourcedClaims[0], /Ather/);
});

test("stripInvalidCitations removes only fabricated ids", () => {
  assert.equal(stripInvalidCitations("a [S1, S9] b [S9].", sources), "a [S1] b .");
});

test("stripModelSourceList drops a model-written references section", () => {
  const text = "# Report\n\nBody [S1]\n\n## References\n- https://fake.com\n\n## Appendix\nkept";
  const out = stripModelSourceList(text);
  assert.ok(!out.includes("fake.com"));
  assert.ok(out.includes("## Appendix"));
});

test("sourcesForText lists cited sources, or all when none cited", () => {
  assert.deepEqual(sourcesForText("x [S2]", sources).sources.map((s) => s.id), ["S2"]);
  const none = sourcesForText("no tags", sources);
  assert.equal(none.citedOnly, false);
  assert.equal(none.sources.length, 2);
  assert.match(renderSourcesSection(sources), /\[S1\].*https:\/\/a\.com\/1/);
  assert.deepEqual(extractCitationIds("[S1][S2, S3]"), ["S1", "S2", "S3"]);
});

test("search queries are stripped of operator chains", async () => {
  const { sanitizeQuery } = await import("@/lib/capabilities/common");
  assert.equal(
    sanitizeQuery('India EV market share 2024 site:ibef.org OR site:niti.gov.in OR "dhi.nic.in"'),
    "India EV market share 2024 dhi.nic.in",
  );
});
