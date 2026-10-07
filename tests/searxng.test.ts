import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchWebDetailed } from "@/lib/manager/webScraper";
import { liveWebUnavailableText } from "@/lib/capabilities/common";
import { emptyLiveReport } from "@/lib/tools/webSearch";

const realFetch = globalThis.fetch;
let calls = 0;
let counter = 0;
// Distinct query per test: successful reports are cached per query.
const q = () => `searxng test query ${++counter}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = 0;
  process.env.SEARXNG_URL = "http://searxng.test:8080/";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.SEARXNG_URL;
});

test("ok: results from healthy engines, no failures", async () => {
  globalThis.fetch = (async (url: string) => {
    calls++;
    assert.match(String(url), /^http:\/\/searxng\.test:8080\/search\?/);
    assert.match(String(url), /format=json/);
    return json({ results: [{ title: "A", url: "https://a.test", content: "snippet", engines: ["google", "bing"] }], unresponsive_engines: [] });
  }) as typeof fetch;
  const r = await searchWebDetailed(q());
  assert.equal(r.status, "ok");
  assert.equal(r.results.length, 1);
  assert.deepEqual(r.engines.succeeded.sort(), ["bing", "google"]);
  assert.equal(r.engines.failed.length, 0);
});

test("partial: results plus named failing engines", async () => {
  globalThis.fetch = (async () =>
    json({ results: [{ title: "A", url: "https://a.test", content: "", engine: "bing" }], unresponsive_engines: [["google", "CAPTCHA"], ["brave", "timeout"]] })) as typeof fetch;
  const r = await searchWebDetailed(q());
  assert.equal(r.status, "partial");
  assert.deepEqual(r.engines.succeeded, ["bing"]);
  assert.deepEqual(r.engines.failed, [
    { name: "google", reason: "CAPTCHA" },
    { name: "brave", reason: "timeout" },
  ]);
});

test("unavailable: no results and engines failed", async () => {
  globalThis.fetch = (async () => json({ results: [], unresponsive_engines: [["google", "timeout"]] })) as typeof fetch;
  const r = await searchWebDetailed(q());
  assert.equal(r.status, "unavailable");
  assert.equal(r.results.length, 0);
  assert.equal(r.engines.failed[0].name, "google");
  assert.equal(r.backendError, undefined);
});

test("unavailable: SEARXNG_URL not configured makes no request", async () => {
  delete process.env.SEARXNG_URL;
  globalThis.fetch = (async () => {
    calls++;
    return json({});
  }) as typeof fetch;
  const r = await searchWebDetailed(q());
  assert.equal(r.status, "unavailable");
  assert.match(r.backendError ?? "", /SEARXNG_URL is not configured/);
  assert.equal(calls, 0);
});

test("retries transient 5xx, then succeeds", async () => {
  globalThis.fetch = (async () => {
    calls++;
    return calls < 3 ? new Response("boom", { status: 503 }) : json({ results: [{ title: "A", url: "https://a.test", engines: ["google"] }] });
  }) as typeof fetch;
  const r = await searchWebDetailed(q());
  assert.equal(r.status, "ok");
  assert.equal(calls, 3);
});

test("does not retry a 403 (json format disabled) and flags the backend", async () => {
  globalThis.fetch = (async () => {
    calls++;
    return new Response("forbidden", { status: 403 });
  }) as typeof fetch;
  const r = await searchWebDetailed(q());
  assert.equal(r.status, "unavailable");
  assert.equal(calls, 1);
  assert.match(r.backendError ?? "", /HTTP 403/);
});

test("persistent network failure is unavailable after bounded retries", async () => {
  globalThis.fetch = (async () => {
    calls++;
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const r = await searchWebDetailed(q());
  assert.equal(r.status, "unavailable");
  assert.equal(calls, 3);
  assert.ok(r.backendError);
});

test("outage text never offers model knowledge as a substitute", () => {
  const live = emptyLiveReport("SearXNG unreachable");
  const text = liveWebUnavailableText("Financial analysis", { status: "unavailable", available: false, queries: ["x"], sources: [], reason: "down", live });
  assert.match(text, /does not substitute model training knowledge/);
  assert.match(text, /SearXNG unreachable/);
});
