// Source + citation bookkeeping. Pure (no I/O) so it is unit-testable.
//
// Rule: a citation is only valid if it points at a page Kraven actually
// fetched during this task. Source ids ([S1], [S2], ...) are assigned by code
// when a page is retrieved - never by a model - and every model-written
// citation is checked against that registry. The "Sources" list a reader sees
// is rendered from the registry, so a model cannot add an entry to it.

export interface Source {
  id: string; // "S1", "S2", ... unique within a task
  url: string;
  title: string;
  excerpt: string;
  fetchedAt: string;
  query: string;
  // "page" = full page scraped; "snippet" = only the search-result snippet
  // could be read (page blocked/paywalled). Both are real retrieved text.
  kind: "page" | "snippet";
}

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$|^gclid$/i.test(p)) u.searchParams.delete(p);
    return `${u.protocol}//${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

// Task-wide id allocator. Seed it with the sources earlier subtasks already
// registered so ids stay unique and a URL fetched twice keeps one id.
export class SourceRegistry {
  private byUrl = new Map<string, Source>();
  private next: number;

  constructor(existing: Source[] = []) {
    let max = 0;
    for (const s of existing) {
      this.byUrl.set(canonicalUrl(s.url), s);
      const n = Number(s.id.replace(/^S/, ""));
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
    this.next = max + 1;
  }

  add(input: Omit<Source, "id">): Source {
    const key = canonicalUrl(input.url);
    const existing = this.byUrl.get(key);
    if (existing) {
      // Prefer a full page over a snippet if we now have one.
      if (existing.kind === "snippet" && input.kind === "page") {
        const upgraded = { ...existing, ...input, id: existing.id };
        this.byUrl.set(key, upgraded);
        return upgraded;
      }
      return existing;
    }
    const source = { ...input, id: `S${this.next++}` };
    this.byUrl.set(key, source);
    return source;
  }

  all(): Source[] {
    return [...this.byUrl.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  }
}

const CITATION_RE = /\[(S\d+(?:\s*,\s*S\d+)*)\]/g;
const URL_RE = /https?:\/\/[^\s)\]>"'`]+/g;

export function extractCitationIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(CITATION_RE)) {
    for (const id of m[1].split(",")) ids.push(id.trim());
  }
  return ids;
}

export interface CitationCheck {
  // Distinct valid source ids the text cites.
  cited: string[];
  // Citations to ids that were never retrieved - fabricated or mistyped.
  invalid: string[];
  // URLs written in the text that are not among the retrieved sources.
  unknownUrls: string[];
  // Bullet/sentence lines in a "sourced" section that carry no citation.
  uncitedSourcedClaims: string[];
}

function sectionBody(text: string, headingPattern: RegExp): string | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,4}\s/.test(l) && headingPattern.test(l));
  if (start === -1) return null;
  const level = (lines[start].match(/^#+/) ?? ["##"])[0].length;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

export function checkCitations(text: string, sources: Source[], options: { sourcedSectionHeading?: RegExp } = {}): CitationCheck {
  const known = new Set(sources.map((s) => s.id));
  const knownUrls = new Set(sources.map((s) => canonicalUrl(s.url)));
  const ids = extractCitationIds(text);
  const cited = [...new Set(ids.filter((id) => known.has(id)))];
  const invalid = [...new Set(ids.filter((id) => !known.has(id)))];
  const unknownUrls = [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))].filter(
    (u) => !knownUrls.has(canonicalUrl(u)),
  );

  const uncitedSourcedClaims: string[] = [];
  if (options.sourcedSectionHeading) {
    const body = sectionBody(text, options.sourcedSectionHeading);
    if (body) {
      for (const raw of body.split(/\r?\n/)) {
        const line = raw.trim();
        // Only claim-bearing lines: bullets, numbered items, table rows with content.
        const isClaim = /^([-*•]|\d+[.)])\s+\S/.test(line) || (/^\|/.test(line) && !/^\|[\s|:-]+\|?$/.test(line));
        if (!isClaim) continue;
        if (/^\|/.test(line) && /\|\s*(source|sources|citation)s?\s*\|/i.test(line)) continue; // header row
        if (extractCitationIds(line).length === 0) uncitedSourcedClaims.push(line.slice(0, 160));
      }
    }
  }
  return { cited, invalid, unknownUrls, uncitedSourcedClaims };
}

// Removes citations to ids that do not exist, so a reader is never shown a
// reference that points nowhere. Returns the cleaned text; the caller keeps
// the CitationCheck so QA still sees that the author produced them.
export function stripInvalidCitations(text: string, sources: Source[]): string {
  const known = new Set(sources.map((s) => s.id));
  return text.replace(CITATION_RE, (_, group: string) => {
    const kept = group
      .split(",")
      .map((s) => s.trim())
      .filter((id) => known.has(id));
    return kept.length > 0 ? `[${kept.join(", ")}]` : "";
  });
}

// Drops any model-written "Sources"/"References" section (it could list
// anything) so the code-rendered one is the only list a reader sees.
export function stripModelSourceList(text: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,4}\s*(sources|references|citations|bibliography)\b/i.test(l.trim()));
  if (start === -1) return text;
  const level = (lines[start].match(/^#+/) ?? ["##"])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").trimEnd();
}

export function renderSourcesSection(sources: Source[], heading = "## Sources"): string {
  if (sources.length === 0) return "";
  const rows = sources.map(
    (s) => `- [${s.id}] ${s.title.replace(/\s+/g, " ").trim() || s.url} — ${s.url} (retrieved ${s.fetchedAt.slice(0, 10)}${s.kind === "snippet" ? ", search snippet only" : ""})`,
  );
  return `${heading}\n\n${rows.join("\n")}`;
}

// Sources the text actually cites, in id order; falls back to every source
// when the text cites none (so consulted material is still disclosed).
export function sourcesForText(text: string, sources: Source[]): { sources: Source[]; citedOnly: boolean } {
  const cited = new Set(extractCitationIds(text));
  const used = sources.filter((s) => cited.has(s.id));
  return used.length > 0 ? { sources: used, citedOnly: true } : { sources, citedOnly: false };
}
