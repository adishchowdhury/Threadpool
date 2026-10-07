// Web scraper used to ground research-type worker outputs in current data.
// Sarvam's training data has a cutoff and can be stale for fast-moving
// facts (funding rounds, pricing, market sizing, recent news); this module
// fetches and cleans a handful of live web pages so the worker prompt can
// cite something newer than the model's weights.
//
// Page fetches route through Bright Data's Scraping Browser (a remote,
// anti-bot-hardened Chromium reached over CDP) when BRIGHTDATA_BROWSER_WS
// is configured - it renders pages and bypasses bot blocks that a plain
// fetch() hits on many sites. Without that env var it falls straight back
// to a direct fetch, so the module works with zero external credentials
// too. Search (finding which URLs to fetch) is entirely keyless by default:
// a rotation of public SearXNG metasearch instances, with DuckDuckGo's no-JS
// HTML result page as the final fallback. No official API, no key, no
// signup required for either.
//
// Every failure degrades to "no live data" rather than throwing, per the
// project's fallback-transparency rule; callers must label the source
// honestly and never claim scraped data when none was fetched.

import { clampTimeout } from "@/lib/runtime/deadline";

// A small pool of realistic desktop User-Agents, picked per request. Sending
// the same UA on every call is itself a bot signal; DuckDuckGo's "anomaly"
// challenge triggers faster against a single fixed UA hammering it.
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];
const randomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const BROWSER_HEADERS = { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Small randomized pre-request pause: several subtasks issuing their web
// passes back-to-back looks like a burst to a rate limiter even though no
// single step is abusive. Spreading requests out a little is free and cuts
// how often the keyless search backends trip their bot challenge.
const jitterDelay = () => sleep(250 + Math.floor(Math.random() * 500));

const SEARCH_TIMEOUT_MS = 6000;
// Generous: a Bright Data fetch pays for both a fresh CDP session handshake
// and the page navigation itself, which together routinely run past 8s.
const PAGE_TIMEOUT_MS = 15000;
const BRIGHTDATA_CONNECT_TIMEOUT_MS = 10000;
const MAX_EXCERPT_CHARS = 1500;
const BRIGHTDATA_COOLDOWN_MS = 5 * 60_000;
let brightDataCooldownUntil = 0;

// Short-lived, per-process cache of search results keyed by normalized
// query. Several subtasks in the same task (and across concurrent tasks in
// the same server process) often issue near-identical queries within
// minutes of each other; serving the cached answer instead of re-querying
// is both free latency and fewer requests against a backend that rate-limits
// by request volume. Not a correctness concern if stale - these are
// best-effort "current facts" lookups, already labeled with fetchedAt.
const SEARCH_CACHE_TTL_MS = 10 * 60_000;
const searchCache = new Map<string, { at: number; results: WebSearchResult[] }>();
const cacheKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

export type WebSearchResult = { title: string; url: string; snippet: string };
export type ScrapedPage = { url: string; title: string; excerpt: string };
export type WebContext = {
  available: boolean;
  query: string;
  fetchedAt: string;
  results: ScrapedPage[];
  reason?: string;
};

export function isBrightDataConfigured(): boolean {
  return Boolean(process.env.BRIGHTDATA_BROWSER_WS);
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clampTimeout(timeoutMs));
  try {
    return await fetch(url, { ...init, signal: controller.signal, headers: { "User-Agent": randomUserAgent(), ...BROWSER_HEADERS, ...init?.headers } });
  } finally {
    clearTimeout(timer);
  }
}

// Playwright's own `timeout` options are a soft ceiling over an unreliable
// remote proxy - a hung TLS/WS handshake to Bright Data has been observed
// to blow well past the configured connect + navigation timeouts (minutes,
// not seconds). This is a hard backstop so one flaky Bright Data session
// can never stall a worker subtask indefinitely; the abandoned connect/
// navigate promise is left to resolve or reject on its own and is swallowed
// so it doesn't surface as an unhandled rejection.
function withHardDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  promise.catch(() => {});
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} exceeded hard deadline of ${ms}ms`)), ms)),
  ]);
}

// Fetches a URL's rendered HTML through Bright Data's Scraping Browser
// (real Chromium behind Bright Data's anti-bot/proxy network). Throws on
// any failure so callers can fall back to a direct fetch.
//
// Connects fresh per call rather than reusing one session: Bright Data
// caps how many distinct domains a single Scraping Browser session may
// navigate to (this account trips "navigate_domains_limit" after just
// one), so a shared session breaks as soon as a second domain shows up -
// which is the normal case here, since gatherWebContext scrapes several
// different sites per query.
async function fetchViaBrightDataBrowser(url: string, timeoutMs: number): Promise<string> {
  const fetchPromise = (async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.connectOverCDP(process.env.BRIGHTDATA_BROWSER_WS!, { timeout: BRIGHTDATA_CONNECT_TIMEOUT_MS });
    try {
      const context = browser.contexts()[0] ?? (await browser.newContext());
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return await page.content();
    } finally {
      await browser.close().catch(() => {});
    }
  })();
  return withHardDeadline(fetchPromise, clampTimeout(BRIGHTDATA_CONNECT_TIMEOUT_MS + timeoutMs + 5000), `Bright Data fetch for ${url}`);
}

// Fetches a URL's HTML, preferring Bright Data's Scraping Browser when
// configured (handles anti-bot pages a plain fetch gets blocked on) and
// falling back to a direct fetch otherwise or on Bright Data failure.
// `viaBrightData` lets callers opt out for endpoints that don't need
// anti-bot handling - DuckDuckGo's plain HTML results page, notably,
// where a direct fetch is both reliable and much faster than paying for
// a fresh Scraping Browser session.
async function fetchHtml(
  url: string,
  timeoutMs: number,
  viaBrightData = true,
): Promise<{ html: string; via: "brightdata" | "direct" }> {
  if (viaBrightData && isBrightDataConfigured() && Date.now() >= brightDataCooldownUntil) {
    try {
      return { html: await fetchViaBrightDataBrowser(url, timeoutMs), via: "brightdata" };
    } catch (err) {
      // Playwright errors embed the CDP endpoint, which carries the Bright
      // Data zone credentials - never log it unmasked.
      const message = (err instanceof Error ? err.message : String(err)).replace(/\/\/[^/\s@]+@/g, "//***@");
      console.error(`[WebScraper] Bright Data fetch failed for ${url}, falling back to direct fetch: ${message.split("\n")[0]}`);
      // An unreachable proxy fails every page the same way; stop paying its
      // connect timeout on each one for a while.
      if (/connectOverCDP|ECONNREFUSED|ENOTFOUND|hard deadline/i.test(message)) brightDataCooldownUntil = Date.now() + BRIGHTDATA_COOLDOWN_MS;
    }
  }
  const res = await fetchWithTimeout(url, timeoutMs, { method: "GET" });
  if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
  // PDFs and other binaries would become garbage "text"; callers fall back
  // to the search snippet instead.
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !/html|text|xml/i.test(contentType)) throw new Error(`unsupported content type ${contentType}`);
  return { html: await res.text(), via: "direct" };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const textOnly = withoutNoise.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(textOnly).replace(/\s+/g, " ").trim();
}

function extractDuckDuckGoUrl(rawHref: string): string | null {
  try {
    if (rawHref.startsWith("//")) rawHref = `https:${rawHref}`;
    const parsed = new URL(rawHref, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (/^https?:\/\//.test(rawHref)) return rawHref;
    return null;
  } catch {
    return null;
  }
}

// ── search providers ───────────────────────────────────────────────────
// Official API keys (Brave/Tavily) are used when configured; both are
// optional. The default, zero-signup path is two fully keyless engines:
// a rotation of public SearXNG metasearch instances, then DuckDuckGo's
// no-JS HTML page as the last resort. DuckDuckGo bot-blocks automated
// traffic (HTTP 202 "anomaly" challenge) after a burst of queries, so it is
// tried last and paced/retried rather than hammered - and when every
// provider blocks, we say so instead of reporting "no results".

export class SearchBlockedError extends Error {}

type SearchProvider = { name: string; configured: () => boolean; search: (q: string, n: number) => Promise<WebSearchResult[]> };

// Public SearXNG instances (open-source metasearch aggregating several
// underlying engines) - free, no key, no account. Overridable via
// SEARXNG_INSTANCES (comma-separated base URLs) for anyone running or
// trusting a specific instance; otherwise a small built-in rotation is
// tried in order, with a random starting point so repeated runs don't all
// hammer the same instance first.
const DEFAULT_SEARXNG_INSTANCES = ["https://searx.be", "https://priv.au", "https://search.inetol.net"];
function searxngInstances(): string[] {
  const configured = (process.env.SEARXNG_INSTANCES ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  const list = configured.length > 0 ? configured : DEFAULT_SEARXNG_INSTANCES;
  const offset = Math.floor(Math.random() * list.length);
  return [...list.slice(offset), ...list.slice(0, offset)];
}

const braveProvider: SearchProvider = {
  name: "brave",
  configured: () => Boolean(process.env.BRAVE_SEARCH_API_KEY),
  async search(query, maxResults) {
    const res = await fetchWithTimeout(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(maxResults, 20)}`,
      SEARCH_TIMEOUT_MS,
      { headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY! } },
    );
    if (!res.ok) throw new Error(`Brave Search HTTP ${res.status}`);
    const body = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
    return (body.web?.results ?? [])
      .filter((r) => r.url)
      .slice(0, maxResults)
      .map((r) => ({ title: stripHtmlToText(r.title ?? ""), url: r.url!, snippet: stripHtmlToText(r.description ?? "") }));
  },
};

const tavilyProvider: SearchProvider = {
  name: "tavily",
  configured: () => Boolean(process.env.TAVILY_API_KEY),
  async search(query, maxResults) {
    const res = await fetchWithTimeout("https://api.tavily.com/search", SEARCH_TIMEOUT_MS, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
      body: JSON.stringify({ query, max_results: Math.min(maxResults, 10), search_depth: "basic" }),
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const body = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (body.results ?? [])
      .filter((r) => r.url)
      .slice(0, maxResults)
      .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: (r.content ?? "").slice(0, 500) }));
  },
};

// Free, keyless metasearch: tries each public instance in turn (JSON API
// first - most instances that enable it respond fast and structured), moves
// on to the next instance on any failure (down, disabled JSON, rate
// limited). Only throws once every instance has failed.
const searxngProvider: SearchProvider = {
  name: "searxng",
  configured: () => true,
  async search(query, maxResults) {
    const errors: string[] = [];
    for (const instance of searxngInstances()) {
      try {
        const res = await fetchWithTimeout(
          `${instance}/search?q=${encodeURIComponent(query)}&format=json&language=en`,
          SEARCH_TIMEOUT_MS,
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get("content-type") ?? "";
        if (!/json/i.test(contentType)) throw new Error("instance does not serve JSON results");
        const body = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
        const results = (body.results ?? [])
          .filter((r) => r.url)
          .slice(0, maxResults)
          .map((r) => ({ title: stripHtmlToText(r.title ?? r.url!), url: r.url!, snippet: stripHtmlToText(r.content ?? "") }));
        if (results.length > 0) return results;
        throw new Error("no results");
      } catch (err) {
        errors.push(`${instance}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    throw new Error(errors.join("; ") || "no SearXNG instance responded");
  },
};

const duckDuckGoProvider: SearchProvider = { name: "duckduckgo_html", configured: () => true, search: searchDuckDuckGo };

// Keyless engines last, in increasing order of block-risk: official APIs
// (if keys are set) first, then SearXNG (aggregated, spread across several
// underlying engines so no single one sees the full query volume), then
// DuckDuckGo HTML scraping as the final fallback.
const SEARCH_PROVIDERS: SearchProvider[] = [braveProvider, tavilyProvider, searxngProvider, duckDuckGoProvider];

export function configuredSearchProviders(): string[] {
  return SEARCH_PROVIDERS.filter((p) => p.configured()).map((p) => p.name);
}

// Tries each configured provider in order; the first that answers wins
// (an empty answer is a real answer). Throws only if every provider failed,
// with every provider's reason. Identical queries within SEARCH_CACHE_TTL_MS
// are served from cache instead of re-hitting any backend.
export async function searchWeb(query: string, maxResults = 4): Promise<WebSearchResult[]> {
  const key = cacheKey(query);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) return cached.results;

  const errors: string[] = [];
  for (const p of SEARCH_PROVIDERS.filter((x) => x.configured())) {
    try {
      if (p.name === "searxng" || p.name === "duckduckgo_html") await jitterDelay();
      const results = await p.search(query, maxResults);
      searchCache.set(key, { at: Date.now(), results });
      return results;
    } catch (err) {
      errors.push(`${p.name}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  const blocked = errors.some((e) => e.startsWith("duckduckgo_html") && /bot challenge/.test(e));
  const message = errors.join("; ") + (blocked ? " - all keyless engines are currently unavailable; set SEARXNG_INSTANCES to a trusted instance, or BRAVE_SEARCH_API_KEY/TAVILY_API_KEY for a free-tier API key" : "");
  throw blocked ? new SearchBlockedError(message) : new Error(message);
}

// Scrapes DuckDuckGo's no-JS HTML result page. No official API, no key
// required - this is the same page a browser gets with JS disabled. One
// retry with backoff on the bot-challenge page before giving up: the
// challenge is often a transient rate-limit, not a hard block.
async function searchDuckDuckGo(query: string, maxResults = 4): Promise<WebSearchResult[]> {
  let html = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(1500 + Math.floor(Math.random() * 1000));
    ({ html } = await fetchHtml(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, SEARCH_TIMEOUT_MS, false));
    if (!(/anomaly/i.test(html) && !/result__a/.test(html))) break;
  }
  if (/anomaly/i.test(html) && !/result__a/.test(html)) {
    throw new Error("blocked automated queries with a bot challenge (rate-limited)");
  }

  const results: WebSearchResult[] = [];
  const resultBlockRe = /<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;

  const blocks = html.match(resultBlockRe) ?? [];
  for (const block of blocks) {
    const linkMatch = block.match(linkRe);
    if (!linkMatch) continue;
    const url = extractDuckDuckGoUrl(linkMatch[1]);
    if (!url) continue;
    const title = stripHtmlToText(linkMatch[2]);
    const snippetMatch = block.match(snippetRe);
    const snippet = snippetMatch ? stripHtmlToText(snippetMatch[1]) : "";
    results.push({ title, url, snippet });
    if (results.length >= maxResults) break;
  }
  return results;
}

// Same idea as searchCache: a retried or reworked step usually lands on the
// same URLs, and re-rendering them through a remote browser costs 10-30s each.
const pageCache = new Map<string, { at: number; page: ScrapedPage }>();

export async function scrapePage(url: string): Promise<ScrapedPage> {
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) return cached.page;
  const { html } = await fetchHtml(url, PAGE_TIMEOUT_MS);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : url;
  const text = stripHtmlToText(html);
  const page = { url, title, excerpt: text.slice(0, MAX_EXCERPT_CHARS) };
  pageCache.set(url, { at: Date.now(), page });
  return page;
}

// Top-level entry point for workers: search the live web for `query`,
// scrape the top results, and return cleaned excerpts. Never throws -
// on any failure (network, blocked, timeout) it returns
// `available: false` with a human-readable reason so callers can label
// the fallback honestly instead of silently pretending data was fetched.
export async function gatherWebContext(query: string, maxResults = 2): Promise<WebContext> {
  const fetchedAt = new Date().toISOString();
  try {
    const searchResults = await searchWeb(query, maxResults);
    if (searchResults.length === 0) {
      return { available: false, query, fetchedAt, results: [], reason: "Web search returned no results" };
    }

    // Scraped sequentially, not in parallel: Bright Data's Scraping Browser
    // enforces a per-session concurrent-navigation limit, so firing all
    // page fetches at once causes the later ones to be rejected outright
    // rather than queued.
    const results: ScrapedPage[] = [];
    for (const r of searchResults) {
      try {
        const page = await scrapePage(r.url);
        if (page.excerpt.length > 0) results.push(page);
      } catch {
        // A single page failing to scrape (paywall, block, timeout) still
        // leaves its search snippet usable as a lightweight fallback.
        if (r.snippet) results.push({ url: r.url, title: r.title, excerpt: r.snippet });
      }
    }

    if (results.length === 0) {
      return { available: false, query, fetchedAt, results: [], reason: "All page fetches failed" };
    }
    return { available: true, query, fetchedAt, results };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown web scraping error";
    return { available: false, query, fetchedAt, results: [], reason };
  }
}

// Renders web context into a labeled block suitable for inclusion in a
// worker prompt. Always explicit about whether live data was actually
// obtained, so the model (and the human reading the prompt in logs) can't
// mistake a fallback for a real citation.
export function formatWebContextForPrompt(ctx: WebContext): string {
  if (!ctx.available || ctx.results.length === 0) {
    return `\n\n[LIVE WEB DATA UNAVAILABLE - ${ctx.reason ?? "no results"}. Rely on your training data and say so if precision on recent figures matters.]`;
  }
  const sources = ctx.results
    .map((r, i) => `Source ${i + 1}: ${r.title} (${r.url})\n${r.excerpt}`)
    .join("\n\n");
  return `\n\n[LIVE WEB DATA - fetched ${ctx.fetchedAt} for query "${ctx.query}". Use this to ground and update anything your training data may have stale, but still use your own judgment; cite sources by URL where you rely on them.]\n\n${sources}`;
}
