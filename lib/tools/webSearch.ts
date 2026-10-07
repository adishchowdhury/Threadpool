import { z } from "zod";
import { searchWebDetailed, scrapePage, isBrightDataConfigured, type EngineFailure, type SearchStatus, type WebSearchResult } from "@/lib/manager/webScraper";
import type { Source } from "@/lib/capabilities/sources";
import type { AgentTool } from "@/lib/tools/types";
import { withTimeout } from "@/lib/runtime/deadline";

// Live web search + page retrieval. Every page it returns is registered in
// the task's SourceRegistry, which is what gives it a citable [S#] id. If
// nothing could be retrieved it says so (available: false) - it never
// returns made-up results.

const OVERALL_DEADLINE_MS = 30_000;

const STOPWORDS = new Set(
  "the a an and or of to for in on with is are by from at as vs top best latest current market companies company report reports analysis data overview guide"
    .split(" "),
);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// Topical relevance: at least one distinctive query term must appear in the
// result's title or snippet. Cheap and generic - it removes portal/landing
// pages that match nothing, not subtle mismatches (QA catches those).
export function isRelevant(result: { title: string; snippet: string }, query: string): boolean {
  const q = terms(query);
  if (q.length === 0) return true;
  const hay = new Set(terms(`${result.title} ${result.snippet}`));
  return q.some((t) => hay.has(t) || hay.has(`${t}s`) || (t.endsWith("s") && hay.has(t.slice(0, -1))));
}

// Which live sources worked and which did not, so callers and the UI can say
// exactly what a result rests on. `backendError` is set when the SearXNG
// instance itself could not be used.
export interface LiveSourceReport {
  engines: { succeeded: string[]; failed: EngineFailure[] };
  pages: { succeeded: string[]; failed: Array<{ url: string; reason: string }> };
  backendError?: string;
}

export const emptyLiveReport = (backendError?: string): LiveSourceReport => ({
  engines: { succeeded: [], failed: [] },
  pages: { succeeded: [], failed: [] },
  ...(backendError ? { backendError } : {}),
});

export interface WebSearchOutput {
  // "ok": everything worked; "partial": usable sources, but some engines or
  // pages failed; "unavailable": no live sources. `available` is
  // status !== "unavailable". Nothing here is ever filled from model knowledge.
  status: SearchStatus;
  available: boolean;
  queries: string[];
  live: LiveSourceReport;
  // Sources retrieved by this call (already registered, with ids).
  sources: Source[];
  reason?: string;
}

export const webSearchTool: AgentTool<{ queries: string[]; maxSources: number }, WebSearchOutput> = {
  name: "web_search",
  description: "Search the live web and read the top pages. Returns citable sources with ids.",
  input: z.object({
    queries: z.array(z.string().min(3).max(200)).min(1).max(4),
    maxSources: z.number().int().min(1).max(8).default(5),
  }),
  async run({ queries, maxSources }, ctx) {
    const start = Date.now();
    const fetchedAt = new Date().toISOString();
    // Concurrent, lightly staggered: each query may retry with backoff, so
    // running them one after another would eat the step's time budget.
    const reports = await Promise.all(
      queries.map(async (q, i) => {
        if (i > 0) await new Promise((r) => setTimeout(r, i * 300));
        return searchWebDetailed(q, 5);
      }),
    );
    const perQuery: WebSearchResult[][] = reports.map((r) => r.results);
    const errors = reports.filter((r) => r.status === "unavailable").map((r) => r.reason ?? "search failed");
    const live = emptyLiveReport();
    live.engines.succeeded = [...new Set(reports.flatMap((r) => r.engines.succeeded))];
    const failedEngines = new Map<string, EngineFailure>();
    for (const f of reports.flatMap((r) => r.engines.failed)) failedEngines.set(`${f.name}:${f.reason}`, f);
    live.engines.failed = [...failedEngines.values()];
    // The backend is only "down" if no query could use it at all.
    if (reports.every((r) => r.backendError)) live.backendError = reports[0].backendError;

    // Round-robin across queries so one query cannot crowd out the others.
    // Results whose title+snippet share no significant term with their query
    // (portal home pages, tool landing pages) are skipped.
    const picked: Array<WebSearchResult & { query: string }> = [];
    const seen = new Set<string>();
    let irrelevant = 0;
    for (let rank = 0; picked.length < maxSources && perQuery.some((r) => r.length > rank); rank++) {
      perQuery.forEach((results, qi) => {
        const r = results[rank];
        if (!r || picked.length >= maxSources || seen.has(r.url)) return;
        if (!isRelevant(r, queries[qi])) {
          irrelevant++;
          seen.add(r.url);
          return;
        }
        seen.add(r.url);
        picked.push({ ...r, query: queries[qi] });
      });
    }
    if (picked.length === 0) {
      const reason = errors.length ? [...new Set(errors)].join("; ") : irrelevant ? `all ${irrelevant} search results were off-topic` : "web search returned no results";
      return { status: "unavailable", available: false, queries, sources: [], reason, live };
    }

    // Each page fetch is raced against what's left of the overall budget, so
    // one slow page can't push the step past it; a page that doesn't make it
    // falls back to its search snippet.
    const pageFailures = new Map<string, string>();
    const fetchPage = async (r: (typeof picked)[number]) => {
      const left = OVERALL_DEADLINE_MS - (Date.now() - start);
      if (left < 2_000) {
        pageFailures.set(r.url, "step time budget exhausted");
        return null;
      }
      if (/\.pdf($|\?)/i.test(r.url)) {
        pageFailures.set(r.url, "PDF not read");
        return null;
      }
      try {
        const page = await withTimeout(scrapePage(r.url), left, `page fetch ${r.url}`);
        if (page.excerpt.length > 200) return page;
        pageFailures.set(r.url, "page had too little readable text");
      } catch (err) {
        pageFailures.set(r.url, err instanceof Error ? err.message : "fetch failed");
      }
      return null;
    };
    // The Bright Data scraping browser rejects concurrent navigations, so it
    // stays sequential; plain fetch() has no such limit.
    const pages: Array<Awaited<ReturnType<typeof fetchPage>>> = [];
    if (isBrightDataConfigured()) {
      for (const r of picked) pages.push(await fetchPage(r));
    } else {
      pages.push(...(await Promise.all(picked.map(fetchPage))));
    }

    // Registered in pick order so [S#] ids stay deterministic.
    const sources: Source[] = [];
    picked.forEach((r, i) => {
      const page = pages[i];
      if (page) sources.push(ctx.sources.add({ url: r.url, title: r.title || page.title, excerpt: page.excerpt, fetchedAt, query: r.query, kind: "page" }));
      else if (r.snippet) sources.push(ctx.sources.add({ url: r.url, title: r.title, excerpt: r.snippet, fetchedAt, query: r.query, kind: "snippet" }));
    });
    live.pages.succeeded = picked.filter((_, i) => pages[i]).map((r) => r.url);
    live.pages.failed = picked.filter((_, i) => !pages[i]).map((r) => ({ url: r.url, reason: pageFailures.get(r.url) ?? "fetch failed" }));
    if (sources.length === 0) {
      return { status: "unavailable", available: false, queries, sources: [], reason: "all page fetches failed and no snippets were usable", live };
    }
    const degraded = live.engines.failed.length > 0 || live.pages.failed.length > 0 || errors.length > 0;
    const notes = [
      live.engines.failed.length ? `search engines failed: ${live.engines.failed.map((f) => `${f.name} (${f.reason})`).join(", ")}` : "",
      errors.length ? `${errors.length} of ${queries.length} queries returned nothing` : "",
      live.pages.failed.length ? `${live.pages.failed.length} page(s) not read in full (snippet used where available)` : "",
    ].filter(Boolean);
    return { status: degraded ? "partial" : "ok", available: true, queries, sources, live, ...(degraded ? { reason: notes.join("; ") } : {}) };
  },
  summarize(o) {
    if (!o.available) return `no live sources (${o.reason})`;
    const pages = o.sources.filter((s) => s.kind === "page").length;
    return `${o.status === "partial" ? "PARTIAL: " : ""}${o.sources.length} sources (${pages} full pages) for ${o.queries.length} quer${o.queries.length === 1 ? "y" : "ies"}${o.reason ? ` - ${o.reason}` : ""}`;
  },
};
