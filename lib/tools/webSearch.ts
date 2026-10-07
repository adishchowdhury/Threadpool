import { z } from "zod";
import { searchWeb, scrapePage, isBrightDataConfigured, type WebSearchResult } from "@/lib/manager/webScraper";
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

export interface WebSearchOutput {
  available: boolean;
  queries: string[];
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
    const errors: string[] = [];
    // Concurrent, lightly staggered: run one after another, 2-4 queries that
    // each may walk several providers cost up to a minute on their own.
    const perQuery: WebSearchResult[][] = await Promise.all(
      queries.map(async (q, i) => {
        if (i > 0) await new Promise((r) => setTimeout(r, i * 300));
        try {
          return await searchWeb(q, 5);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : "search failed");
          return [];
        }
      }),
    );

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
      return { available: false, queries, sources: [], reason };
    }

    // Each page fetch is raced against what's left of the overall budget, so
    // one slow page can't push the step past it; a page that doesn't make it
    // falls back to its search snippet.
    const fetchPage = async (r: (typeof picked)[number]) => {
      const left = OVERALL_DEADLINE_MS - (Date.now() - start);
      if (left < 2_000 || /\.pdf($|\?)/i.test(r.url)) return null;
      try {
        const page = await withTimeout(scrapePage(r.url), left, `page fetch ${r.url}`);
        return page.excerpt.length > 200 ? page : null;
      } catch {
        return null;
      }
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
    if (sources.length === 0) return { available: false, queries, sources: [], reason: "all page fetches failed and no snippets were usable" };
    return { available: true, queries, sources };
  },
  summarize(o) {
    if (!o.available) return `no live sources (${o.reason})`;
    const pages = o.sources.filter((s) => s.kind === "page").length;
    return `${o.sources.length} sources (${pages} full pages) for ${o.queries.length} quer${o.queries.length === 1 ? "y" : "ies"}`;
  },
};
