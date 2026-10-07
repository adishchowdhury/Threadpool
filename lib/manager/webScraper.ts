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
// too. Search (finding which URLs to fetch) goes through a self-hosted SearXNG
// instance (SEARXNG_URL); see the search section below.
//
// Every failure degrades to "no live data" rather than throwing, per the
// project's fallback-transparency rule; callers must label the source
// honestly, never claim scraped data when none was fetched, and never fill
// the gap with model training knowledge.

import { clampTimeout, withTimeout } from "@/lib/runtime/deadline";

// A small pool of realistic desktop User-Agents, picked per request. Sending
// the same UA on every call is itself a bot signal for the sites we scrape;
// bot rate limiters trip faster against a single fixed UA.
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];
const randomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const BROWSER_HEADERS = { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SEARCH_TIMEOUT_MS = 8000;
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
const searchCache = new Map<string, { at: number; report: WebSearchReport }>();
const cacheKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

export type WebSearchResult = { title: string; url: string; snippet: string };
export type ScrapedPage = { url: string; title: string; excerpt: string };

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
// which is the normal case here, since a web pass scrapes several
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
// anti-bot handling.
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

// ── search (self-hosted SearXNG) ───────────────────────────────────────
// Search goes only through the SearXNG instance at SEARXNG_URL (see
// docker-compose.searxng.yml), which aggregates several engines. There is no
// public-instance rotation and no scraping fallback: when the instance or its
// engines fail, that is reported as "partial"/"unavailable" with the failing
// engines named, and callers must not substitute model knowledge for it.

export type SearchStatus = "ok" | "partial" | "unavailable";
export type EngineFailure = { name: string; reason: string };
export type WebSearchReport = {
  status: SearchStatus;
  results: WebSearchResult[];
  engines: { succeeded: string[]; failed: EngineFailure[] };
  // Set when the SearXNG instance itself could not be used (not configured,
  // unreachable, misconfigured) as opposed to individual engines failing.
  backendError?: string;
  reason?: string;
};

const SEARCH_ATTEMPTS = 3;
const SEARCH_BACKOFF_MS = 400;

class SearchHttpError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") return `timed out after ${SEARCH_TIMEOUT_MS}ms`;
  return err instanceof Error ? err.message : "failed";
}

function searxngBaseUrl(): { url: string } | { error: string } {
  const raw = (process.env.SEARXNG_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) return { error: "SEARXNG_URL is not configured" };
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("bad protocol");
    return { url: raw };
  } catch {
    return { error: "SEARXNG_URL is not a valid http(s) URL" };
  }
}

type SearxngBody = {
  results?: Array<{ title?: string; url?: string; content?: string; engine?: string; engines?: string[] }>;
  unresponsive_engines?: unknown[];
};

// Timeouts, network errors, 429 and 5xx are retried with exponential backoff;
// other 4xx (e.g. 403 when the json format is disabled) and malformed bodies
// are configuration problems that a retry cannot fix.
async function querySearxng(baseUrl: string, query: string): Promise<SearxngBody> {
  const url = `${baseUrl}/search?${new URLSearchParams({ q: query, format: "json", language: "en" })}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= SEARCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(url, SEARCH_TIMEOUT_MS, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        const hint = res.status === 403 ? " (is the json format enabled in SearXNG settings.yml?)" : "";
        throw new SearchHttpError(`HTTP ${res.status}${hint}`, res.status === 429 || res.status >= 500);
      }
      if (!/json/i.test(res.headers.get("content-type") ?? "")) throw new SearchHttpError("response was not JSON", false);
      return (await withTimeout(res.json(), SEARCH_TIMEOUT_MS, "SearXNG response body")) as SearxngBody;
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof SearchHttpError ? err.retryable : !(err instanceof SyntaxError);
      if (!retryable || attempt === SEARCH_ATTEMPTS) break;
      await sleep(SEARCH_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}

const unavailable = (reason: string, backendError?: string, failed: EngineFailure[] = []): WebSearchReport => ({
  status: "unavailable",
  results: [],
  engines: { succeeded: [], failed },
  reason,
  ...(backendError ? { backendError } : {}),
});

const describeFailures = (failed: EngineFailure[]) => failed.map((f) => `${f.name} (${f.reason})`).join(", ");

// Identical queries within SEARCH_CACHE_TTL_MS are served from cache. Only
// answers that returned results are cached, so an outage is never sticky.
export async function searchWebDetailed(query: string, maxResults = 4): Promise<WebSearchReport> {
  const key = cacheKey(query);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) return { ...cached.report, results: cached.report.results.slice(0, maxResults) };

  const base = searxngBaseUrl();
  if ("error" in base) return unavailable(base.error, base.error);

  let body: SearxngBody;
  try {
    body = await querySearxng(base.url, query);
  } catch (err) {
    const message = `SearXNG unreachable or misconfigured: ${describeError(err)}`;
    console.error(`[WebScraper] ${message}`);
    return unavailable(message, message);
  }

  const failed: EngineFailure[] = (body.unresponsive_engines ?? []).map((e) =>
    Array.isArray(e) ? { name: String(e[0]), reason: String(e[1] ?? "unresponsive") } : { name: String(e), reason: "unresponsive" },
  );
  const raw = (body.results ?? []).filter((r) => r.url);
  const succeeded = [...new Set(raw.flatMap((r) => r.engines ?? (r.engine ? [r.engine] : [])))];
  const results = raw.slice(0, Math.max(maxResults, 0)).map((r) => ({ title: stripHtmlToText(r.title ?? r.url!), url: r.url!, snippet: stripHtmlToText(r.content ?? "") }));

  if (results.length === 0 && failed.length > 0) {
    return unavailable(`no results; engines failed: ${describeFailures(failed)}`, undefined, failed);
  }
  const report: WebSearchReport = {
    status: failed.length > 0 ? "partial" : "ok",
    results,
    engines: { succeeded, failed },
    ...(failed.length > 0 ? { reason: `engines failed: ${describeFailures(failed)}` } : results.length === 0 ? { reason: "web search returned no results" } : {}),
  };
  if (results.length > 0) searchCache.set(key, { at: Date.now(), report });
  return report;
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
