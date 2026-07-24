// The only module that talks to Wikimedia. Plain fetch, no SDK, mirroring
// llm-extract.ts's timeout/failure-swallowing conventions: every call is
// wrapped in a 4s AbortController timeout, and no failure ever throws to the
// caller — fame-sweep.ts and the candidates route both depend on that to
// stay non-blocking (FABLE-ROADMAP.md §14: ingest must never depend on this).

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const PAGEVIEWS_API = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article";
export const REQUEST_TIMEOUT_MS = 4000;
export const USER_AGENT = "worlddashboard/1.0 (https://worlddashboard.vercel.app)";

// The feed corpus's language spread (see entity-dictionaries.ts's European
// aliases) — labels/aliases in these languages are what actually shows up as
// alternate surface forms in our articles (e.g. German "Wolodymyr Selenskyj").
export const ALIAS_LANGUAGES = ["en", "de", "fr", "es", "it", "pl", "pt", "nl", "tr"] as const;

const PAGEVIEWS_WINDOW_MONTHS = 12;
// The window ends 2 months before now, not 1: pageviews processing lags, and
// the current news spike (whatever made us look this entity up right now)
// must never leak into the very last window month either.
const PAGEVIEWS_LAG_MONTHS = 2;

export interface WikidataLookup {
  matched: boolean;
  /** enwiki sitelink title, only when one exists — null otherwise, even for
   * a real match (a Wikidata item with no English article). */
  wikiTitle: string | null;
  /** Total sitelink count across every project/language, not just ALIAS_LANGUAGES. */
  sitelinks: number;
  /** Deduped labels+aliases across ALIAS_LANGUAGES only. */
  aliases: string[];
  medianMonthlyPageviews: number;
}

export type WikidataLookupResult = { ok: true; lookup: WikidataLookup } | { ok: false; reason: string };

// ---- pure helpers (exported for tests; no network) ----

function toAbsoluteMonth(year: number, month0: number): number {
  return year * 12 + month0;
}

function fromAbsoluteMonth(abs: number): { year: number; month0: number } {
  const year = Math.floor(abs / 12);
  const month0 = ((abs % 12) + 12) % 12;
  return { year, month0 };
}

function formatYyyymm(year: number, month0: number): string {
  return `${year}${String(month0 + 1).padStart(2, "0")}`;
}

/** The 12 full calendar months ending PAGEVIEWS_LAG_MONTHS before `now`,
 * oldest first, as "YYYYMM" strings — the fixed window computeMedianPageviews
 * is evaluated over, regardless of which of those months Wikimedia actually
 * has data for. */
export function computeWindowMonths(now: Date): string[] {
  const nowAbs = toAbsoluteMonth(now.getUTCFullYear(), now.getUTCMonth());
  const anchor = nowAbs - PAGEVIEWS_LAG_MONTHS;
  const months: string[] = [];
  for (let i = PAGEVIEWS_WINDOW_MONTHS - 1; i >= 0; i--) {
    const { year, month0 } = fromAbsoluteMonth(anchor - i);
    months.push(formatYyyymm(year, month0));
  }
  return months;
}

/** The spike-immunity linchpin: a month `viewsByMonth` has no entry for
 * (article too young to have existed, or Wikimedia has no data) counts as 0,
 * not "missing" — the median is always taken over exactly
 * `windowMonths.length` values. A 3-month-old article with huge recent views
 * still produces a low median, because most of the window is real zeros. */
export function computeMedianPageviews(viewsByMonth: Map<string, number>, windowMonths: string[]): number {
  const values = windowMonths.map((month) => viewsByMonth.get(month) ?? 0).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
}

/** wbsearchentities's top hit id, or null when nothing matched (a clean
 * "no Wikidata item" outcome, not a failure — see lookupWikidataFame). */
export function parseSearchResponse(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const search = (json as Record<string, unknown>).search;
  if (!Array.isArray(search) || search.length === 0) return null;
  const top = search[0];
  if (typeof top !== "object" || top === null) return null;
  const id = (top as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

interface EntityDetails {
  wikiTitle: string | null;
  sitelinks: number;
  aliases: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function collectAliasStrings(entity: Record<string, unknown>): string[] {
  const labels = asRecord(entity.labels);
  const aliasesByLang = asRecord(entity.aliases);
  const values = new Set<string>();

  for (const lang of ALIAS_LANGUAGES) {
    const label = asRecord(labels[lang]);
    if (typeof label.value === "string" && label.value.trim()) values.add(label.value.trim());

    const aliasList = aliasesByLang[lang];
    if (Array.isArray(aliasList)) {
      for (const item of aliasList) {
        const value = asRecord(item).value;
        if (typeof value === "string" && value.trim()) values.add(value.trim());
      }
    }
  }
  return Array.from(values);
}

/** wbgetentities's sitelinks/labels/aliases for one already-matched id. Null
 * only when the entity itself is missing/malformed in the response — every
 * sub-field (sitelinks/labels/aliases) degrades independently and
 * defensively instead of failing the whole parse. */
export function parseEntitiesResponse(json: unknown, id: string): EntityDetails | null {
  const entities = asRecord(asRecord(json).entities);
  const entity = asRecord(entities[id]);
  if (Object.keys(entity).length === 0) return null;

  const sitelinks = asRecord(entity.sitelinks);
  const enwiki = asRecord(sitelinks.enwiki);
  const wikiTitle = typeof enwiki.title === "string" ? enwiki.title : null;

  return { wikiTitle, sitelinks: Object.keys(sitelinks).length, aliases: collectAliasStrings(entity) };
}

/** Pageviews REST API's monthly items, keyed "YYYYMM" (the response's own
 * "YYYYMMDDHH" timestamp, truncated). A malformed or empty body just yields
 * an empty map — every month reads as 0 via computeMedianPageviews, exactly
 * the "no data for this range" case. */
export function parsePageviewsResponse(json: unknown): Map<string, number> {
  const map = new Map<string, number>();
  const items = asRecord(json).items;
  if (!Array.isArray(items)) return map;
  for (const item of items) {
    const row = asRecord(item);
    if (typeof row.timestamp === "string" && row.timestamp.length >= 6 && typeof row.views === "number") {
      map.set(row.timestamp.slice(0, 6), row.views);
    }
  }
  return map;
}

// ---- network (isolated behind this one thin wrapper) ----

type FetchResult = { kind: "ok"; json: unknown } | { kind: "not_found" } | { kind: "error" };

async function fetchJson(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", json: await res.json() };
  } catch {
    return { kind: "error" };
  } finally {
    clearTimeout(timer);
  }
}

function buildSearchUrl(name: string): string {
  const params = new URLSearchParams({ action: "wbsearchentities", search: name, language: "en", format: "json", limit: "1" });
  return `${WIKIDATA_API}?${params.toString()}`;
}

function buildEntitiesUrl(id: string): string {
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: id,
    props: "sitelinks|labels|aliases",
    languages: ALIAS_LANGUAGES.join("|"),
    format: "json",
  });
  return `${WIKIDATA_API}?${params.toString()}`;
}

function lastDayOfMonth(yyyymm: string): number {
  const year = Number(yyyymm.slice(0, 4));
  const month0 = Number(yyyymm.slice(4, 6)) - 1;
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function buildPageviewsUrl(wikiTitle: string, windowMonths: string[]): string {
  const article = encodeURIComponent(wikiTitle.replace(/ /g, "_"));
  const first = windowMonths[0];
  const last = windowMonths[windowMonths.length - 1];
  const start = `${first}01`;
  const end = `${last}${String(lastDayOfMonth(last)).padStart(2, "0")}`;
  return `${PAGEVIEWS_API}/en.wikipedia/all-access/all-agents/${article}/monthly/${start}/${end}`;
}

const NOT_FAMOUS_LOOKUP: WikidataLookup = { matched: false, wikiTitle: null, sitelinks: 0, aliases: [], medianMonthlyPageviews: 0 };

/** One entity name -> a fame lookup. Never throws: any timeout, non-2xx, or
 * malformed response at any stage yields `{ok: false}`, which callers must
 * treat as fame='unknown' (see fame.ts's invariant: a lookup failure is
 * never a verdict). A clean "nothing matched" is `{ok: true}` with
 * `matched: false` — that's a real answer (not_famous), not a failure. */
export async function lookupWikidataFame(name: string, now: Date = new Date()): Promise<WikidataLookupResult> {
  const searchResult = await fetchJson(buildSearchUrl(name));
  if (searchResult.kind !== "ok") return { ok: false, reason: "search_failed" };
  const id = parseSearchResponse(searchResult.json);
  if (!id) return { ok: true, lookup: NOT_FAMOUS_LOOKUP };

  const entitiesResult = await fetchJson(buildEntitiesUrl(id));
  if (entitiesResult.kind !== "ok") return { ok: false, reason: "entities_failed" };
  const details = parseEntitiesResponse(entitiesResult.json, id);
  if (!details) return { ok: false, reason: "entities_malformed" };

  if (!details.wikiTitle) {
    return { ok: true, lookup: { matched: true, wikiTitle: null, sitelinks: details.sitelinks, aliases: details.aliases, medianMonthlyPageviews: 0 } };
  }

  const windowMonths = computeWindowMonths(now);
  const pageviewsResult = await fetchJson(buildPageviewsUrl(details.wikiTitle, windowMonths));
  if (pageviewsResult.kind === "error") return { ok: false, reason: "pageviews_failed" };
  // A 404 here means Wikimedia has no data at all for this range — the
  // documented behavior for an article too young to have any, not a
  // technical failure. It must resolve to zeros, not `ok: false`, or every
  // brand-new match would wrongly stay 'unknown' instead of settling to
  // not_famous.
  const viewsByMonth = pageviewsResult.kind === "not_found" ? new Map<string, number>() : parsePageviewsResponse(pageviewsResult.json);

  return {
    ok: true,
    lookup: {
      matched: true,
      wikiTitle: details.wikiTitle,
      sitelinks: details.sitelinks,
      aliases: details.aliases,
      medianMonthlyPageviews: computeMedianPageviews(viewsByMonth, windowMonths),
    },
  };
}
