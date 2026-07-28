// The only module that talks to Wikimedia. Plain fetch, no SDK, mirroring
// llm-extract.ts's timeout/failure-swallowing conventions: every call is
// wrapped in a 4s AbortController timeout, and no failure ever throws to the
// caller — fame-sweep.ts and the candidates route both depend on that to
// stay non-blocking (FABLE-ROADMAP.md §14: ingest must never depend on this).
//
// Incident note (see DEVLOG): every failure reason used to collapse to one
// of four generic strings ("search_failed" etc), so a 24h 100%-failure
// production incident (Wikidata blocking our traffic) produced zero
// diagnostic signal — we could see "40 failed" but not why. Every failure
// reason below is now specific and machine-readable (HTTP status where one
// exists), so a rate-limit/block is instantly distinguishable from a
// timeout or a malformed response in the ingest response body.

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const PAGEVIEWS_API = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article";
export const REQUEST_TIMEOUT_MS = 4000;
// Wikimedia's API etiquette (https://meta.wikimedia.org/wiki/User-Agent_policy)
// asks every caller to self-identify with a URL and a real contact address,
// so a misbehaving client can be traced and throttled instead of the whole
// service degrading for everyone. contact@example.com is a placeholder that
// satisfies the documented format, not a real mailbox — the operator MUST
// replace it with a real, monitored address before this is relied on.
export const USER_AGENT = "worlddashboard/1.0 (https://worlddashboard.vercel.app; contact@example.com)";

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
 * "no Wikidata item" outcome, not a failure — see lookupWikidataFame). Thin
 * wrapper over parseSearchResponseIds for callers that only want the top
 * hit (kept for backward compatibility / simple call sites). */
export function parseSearchResponse(json: unknown): string | null {
  const ids = parseSearchResponseIds(json);
  return ids.length > 0 ? ids[0] : null;
}

/** wbsearchentities' hit ids in relevance order (up to the request's own
 * `limit`), skipping any malformed entry that lacks an id. Feeds the
 * disambiguation step in lookupWikidataFame — see pickBestCandidate. */
export function parseSearchResponseIds(json: unknown): string[] {
  if (typeof json !== "object" || json === null) return [];
  const search = (json as Record<string, unknown>).search;
  if (!Array.isArray(search)) return [];
  const ids: string[] = [];
  for (const item of search) {
    if (typeof item !== "object" || item === null) continue;
    const id = (item as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) ids.push(id);
  }
  return ids;
}

export interface EntityDetails {
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

/** Shared by the single-id, multi-id, and title-batch parsers below — every
 * sub-field (sitelinks/labels/aliases) degrades independently and
 * defensively instead of failing the whole parse. */
function parseEntityRecord(entity: Record<string, unknown>): EntityDetails {
  const sitelinks = asRecord(entity.sitelinks);
  const enwiki = asRecord(sitelinks.enwiki);
  const wikiTitle = typeof enwiki.title === "string" ? enwiki.title : null;
  return { wikiTitle, sitelinks: Object.keys(sitelinks).length, aliases: collectAliasStrings(entity) };
}

/** wbgetentities's sitelinks/labels/aliases for one already-matched id. Null
 * only when the entity itself is missing/malformed in the response. */
export function parseEntitiesResponse(json: unknown, id: string): EntityDetails | null {
  const entities = asRecord(asRecord(json).entities);
  const entity = asRecord(entities[id]);
  if (Object.keys(entity).length === 0) return null;
  return parseEntityRecord(entity);
}

/** Same as parseEntitiesResponse but for every id in one response (a single
 * wbgetentities call fetches all of them at once — see buildEntitiesUrl).
 * An id absent or malformed in the response is simply omitted from the
 * returned map rather than failing the others present. */
export function parseEntitiesResponseMulti(json: unknown, ids: string[]): Map<string, EntityDetails> {
  const entities = asRecord(asRecord(json).entities);
  const map = new Map<string, EntityDetails>();
  for (const id of ids) {
    const entity = asRecord(entities[id]);
    if (Object.keys(entity).length === 0) continue;
    map.set(id, parseEntityRecord(entity));
  }
  return map;
}

/** MediaWiki title comparison for the batch-resolution match below:
 * underscore/space-insensitive and case-insensitive (wbgetentities' own
 * `normalize=1` already folds first-letter case server-side; this mirrors
 * that leniency when matching the response back to our input names). */
function normalizeTitleForMatch(title: string): string {
  return title.replace(/_/g, " ").trim().toLowerCase();
}

/** One wbgetentities response keyed by input name instead of by Wikidata id
 * — resolveNamesBatch's parser. A name resolves only when some entity in the
 * response carries an enwiki sitelink whose title text-matches that name;
 * a title that resolved to a DIFFERENT enwiki title (a redirect, e.g. a
 * canonical name whose real article title differs) is deliberately left
 * unresolved so it falls through to the per-name search path instead of
 * silently accepting a redirect target it never asked for. "missing" title
 * placeholders (response keys like "-1", one per unresolved title) carry no
 * usable entity and are skipped. */
export function parseBatchEntitiesResponse(json: unknown, names: string[]): Map<string, EntityDetails> {
  const entities = asRecord(asRecord(json).entities);
  const wanted = new Map(names.map((name) => [normalizeTitleForMatch(name), name]));
  const matches = new Map<string, EntityDetails>();

  for (const key of Object.keys(entities)) {
    if (key.startsWith("-")) continue; // a "missing title" placeholder, not a real entity
    const entity = asRecord(entities[key]);
    const details = parseEntityRecord(entity);
    if (!details.wikiTitle) continue;
    const originalName = wanted.get(normalizeTitleForMatch(details.wikiTitle));
    if (!originalName) continue;
    matches.set(originalName, details);
  }
  return matches;
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

type FetchResult =
  | { kind: "ok"; json: unknown }
  | { kind: "not_found" }
  | { kind: "http_error"; status: number }
  | { kind: "timeout" }
  | { kind: "network_error" }
  | { kind: "malformed_body" };

async function fetchJson(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "http_error", status: res.status };
    try {
      return { kind: "ok", json: await res.json() };
    } catch {
      return { kind: "malformed_body" };
    }
  } catch {
    // Our own timeout fires controller.abort(), which is what turns the
    // fetch's rejection into this catch — signal.aborted true means THIS
    // was that timeout, not some other network failure, so it gets its own
    // distinct, actionable reason instead of a generic bucket.
    return controller.signal.aborted ? { kind: "timeout" } : { kind: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Turns a non-"ok" FetchResult into a specific, machine-readable reason
 * string for the given call stage (e.g. "search_http_403",
 * "pageviews_timeout", "entities_malformed_body") — the enrichment this
 * whole module exists for after the 24h 100%-failure incident: every reason
 * is now distinct enough that fame-sweep.ts's failureReasons tally actually
 * says what went wrong, not just that something did. */
function fetchFailureReason(stage: string, result: FetchResult): string {
  switch (result.kind) {
    case "http_error":
      return `${stage}_http_${result.status}`;
    case "not_found":
      return `${stage}_http_404`;
    case "timeout":
      return `${stage}_timeout`;
    case "network_error":
      return `${stage}_network_error`;
    case "malformed_body":
      return `${stage}_malformed_body`;
    case "ok":
      return `${stage}_error`; // unreachable in practice; callers only pass non-ok results
  }
}

function buildSearchUrl(name: string): string {
  // limit=5, not 1: wbsearchentities' relevance ranking isn't a fame
  // ranking (see pickBestCandidate) — the top 5 gives room to disambiguate
  // among same-name entities instead of blindly trusting the first hit.
  const params = new URLSearchParams({ action: "wbsearchentities", search: name, language: "en", format: "json", limit: "5" });
  return `${WIKIDATA_API}?${params.toString()}`;
}

function buildEntitiesUrl(ids: string[]): string {
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: ids.join("|"),
    props: "sitelinks|labels|aliases",
    languages: ALIAS_LANGUAGES.join("|"),
    format: "json",
  });
  return `${WIKIDATA_API}?${params.toString()}`;
}

/** wbgetentities accepts up to 50 ids OR titles per call (Wikidata's
 * non-bot ceiling) — callers (resolveNamesBatch) must keep their name list
 * at or under that. */
function buildBatchEntitiesUrl(names: string[]): string {
  const params = new URLSearchParams({
    action: "wbgetentities",
    sites: "enwiki",
    titles: names.join("|"),
    normalize: "1",
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

/** Among wbsearchentities' top 5 hits (already fetched together in one
 * wbgetentities call — see lookupWikidataFame), picks the one Wikidata
 * itself documents in the most languages/projects among those that have an
 * English article — never blindly the first result. Modeled on a real
 * production false match: canonical_name "ICC" search-matched the Antwerp
 * arts venue "Internationaal Cultureel Centrum" (2 sitelinks, 0 pageviews)
 * ahead of the International Criminal Court, purely because
 * wbsearchentities' relevance ranking isn't a fame ranking — among things
 * sharing a name, the one the world documents in the most languages is
 * overwhelmingly the one current news means. Ties keep the earlier
 * (Wikidata's own more-relevant) result, since replacement below only
 * happens on a STRICTLY greater sitelink count. If no candidate has an
 * enwiki sitelink at all, this falls back to the original single-top-hit
 * behavior (whatever the top result's own details are) rather than
 * inventing a new fallback. */
function pickBestCandidate(ids: string[], candidates: Map<string, EntityDetails>): EntityDetails | null {
  let best: EntityDetails | null = null;
  for (const id of ids) {
    const candidate = candidates.get(id);
    if (!candidate || !candidate.wikiTitle) continue;
    if (!best || candidate.sitelinks > best.sitelinks) best = candidate;
  }
  if (best) return best;
  return candidates.get(ids[0]) ?? null;
}

/** Completes a fame lookup for an entity whose Wikidata details are already
 * known (whether from resolveNamesBatch's batched title match, or from
 * lookupWikidataFame's own search+disambiguation) — only the per-article
 * pageviews request remains; that endpoint has no batch form. Shared so the
 * spike-immune median logic and its failure handling exist in exactly one
 * place regardless of how the entity was matched. */
export async function lookupFameFromMatch(details: EntityDetails, now: Date = new Date()): Promise<WikidataLookupResult> {
  if (!details.wikiTitle) {
    return { ok: true, lookup: { matched: true, wikiTitle: null, sitelinks: details.sitelinks, aliases: details.aliases, medianMonthlyPageviews: 0 } };
  }

  const windowMonths = computeWindowMonths(now);
  const pageviewsResult = await fetchJson(buildPageviewsUrl(details.wikiTitle, windowMonths));
  // A 404 here means Wikimedia has no data at all for this range — the
  // documented behavior for an article too young to have any, not a
  // technical failure. It must resolve to zeros, not `ok: false`, or every
  // brand-new match would wrongly stay 'unknown' instead of settling to
  // not_famous.
  if (pageviewsResult.kind !== "ok" && pageviewsResult.kind !== "not_found") {
    return { ok: false, reason: fetchFailureReason("pageviews", pageviewsResult) };
  }
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

export type NameBatchResult = { ok: true; matches: Map<string, EntityDetails> } | { ok: false; reason: string };

/** Resolves up to 50 names in ONE wbgetentities request (sites=enwiki,
 * titles=<pipe-joined names>) instead of the usual per-name
 * search+entities pair — a name resolves only when its text is an exact
 * (case/underscore-insensitive) English Wikipedia title; see
 * parseBatchEntitiesResponse. Names not present in the returned map (e.g.
 * "Putin", whose article is "Vladimir Putin") are left for the caller to
 * run through the per-name lookupWikidataFame path. Never throws: a failed
 * batch call just means no names get the shortcut this tick — callers fall
 * back to the per-name path for everyone, exactly as if this function
 * didn't exist. */
export async function resolveNamesBatch(names: string[]): Promise<NameBatchResult> {
  if (names.length === 0) return { ok: true, matches: new Map() };
  const result = await fetchJson(buildBatchEntitiesUrl(names));
  if (result.kind !== "ok") return { ok: false, reason: fetchFailureReason("batch_entities", result) };
  return { ok: true, matches: parseBatchEntitiesResponse(result.json, names) };
}

/** One entity name -> a fame lookup. Never throws: any timeout, non-2xx, or
 * malformed response at any stage yields `{ok: false}`, which callers must
 * treat as fame='unknown' (see fame.ts's invariant: a lookup failure is
 * never a verdict). A clean "nothing matched" is `{ok: true}` with
 * `matched: false` — that's a real answer (not_famous), not a failure.
 * Costs at most 3 sequential requests (search, one combined entities fetch
 * for up to 5 candidates, pageviews) — no more than before disambiguation
 * was added, since the 5 candidates are fetched together in a single call.
 * fame-sweep.ts calls resolveNamesBatch + lookupFameFromMatch first and
 * only falls back to this full path for names the batch didn't resolve. */
export async function lookupWikidataFame(name: string, now: Date = new Date()): Promise<WikidataLookupResult> {
  const searchResult = await fetchJson(buildSearchUrl(name));
  if (searchResult.kind !== "ok") return { ok: false, reason: fetchFailureReason("search", searchResult) };
  const ids = parseSearchResponseIds(searchResult.json);
  if (ids.length === 0) return { ok: true, lookup: NOT_FAMOUS_LOOKUP };

  const entitiesResult = await fetchJson(buildEntitiesUrl(ids));
  if (entitiesResult.kind !== "ok") return { ok: false, reason: fetchFailureReason("entities", entitiesResult) };
  const candidates = parseEntitiesResponseMulti(entitiesResult.json, ids);
  const details = pickBestCandidate(ids, candidates);
  if (!details) return { ok: false, reason: "entities_malformed" };

  return lookupFameFromMatch(details, now);
}
