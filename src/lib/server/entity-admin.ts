import type { Sql, SqlRow } from "./db";
import { normalizeName } from "./extract-v2";
import { computeEffectiveBaselineDays } from "./detectors";
import { isAnchor, computeAnchorThreshold, loadEntityBaselinePanel } from "./developments";
import type { EntityBaselineRow } from "./developments";
import {
  isFamous,
  isDictionaryFamous,
  isBreadthFamous,
  isVolumeFamous,
  computeFameVolumeThreshold,
  loadLifetimeSourceBreadth,
} from "./fame";
import type { FameFacts, StoredFame } from "./fame";

// ---- shared row shaping ----

export interface EntityAdminJson {
  id: number;
  canonicalName: string;
  type: string;
  status: string;
  aliases: string[];
  fame: string;
  fameLocked: boolean;
  wikiTitle: string | null;
  wikiSitelinks: number | null;
  wikiPageviewsMonthly: number | null;
  fameCheckedAt: string | null;
  firstSeenAt: string;
}

function toIsoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(value as string).toISOString();
}

/** Shared row->JSON shaping for searchEntities and the PATCH handler
 * (src/app/api/entities/[id]/route.ts) — every row always carries its fame
 * evidence fields (DESIGN.md spine #2: evidence one click away), and
 * fameCheckedAt=null is how a never-checked entity stays distinguishable
 * from a real verdict (spine #4: honest time — never collapse "never
 * checked" and "checked, found nothing" into one bare fame value). */
export function toEntityAdminJson(row: SqlRow): EntityAdminJson {
  return {
    id: Number(row.id),
    canonicalName: String(row.canonical_name),
    type: String(row.type),
    status: String(row.status),
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
    fame: String(row.fame),
    fameLocked: Boolean(row.fame_locked),
    wikiTitle: row.wiki_title != null ? String(row.wiki_title) : null,
    wikiSitelinks: row.wiki_sitelinks != null ? Number(row.wiki_sitelinks) : null,
    wikiPageviewsMonthly: row.wiki_pageviews_monthly != null ? Number(row.wiki_pageviews_monthly) : null,
    fameCheckedAt: row.fame_checked_at != null ? toIsoString(row.fame_checked_at) : null,
    firstSeenAt: toIsoString(row.first_seen_at),
  };
}

// ---- searchEntities ----

/** Thrown for any malformed/out-of-range search input — callers (the
 * /api/entities list route) catch this and respond 400, rather than the
 * function silently coercing garbage into a default. */
export class ValidationError extends Error {}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_Q_LEN = 200;
const VALID_STATUSES = new Set(["tracked", "dismissed"]);
const VALID_FAME = new Set(["unknown", "not_famous", "famous"]);

// ---- role classification (anchor/famous/satellite) ----
//
// TABS-REDESIGN-PLAN.md §6, Phase 3a follow-up. Reuses developments.ts's own
// exported isAnchor/computeAnchorThreshold and fame.ts's own exported
// isFamous/isDictionaryFamous/isBreadthFamous/isVolumeFamous/
// computeFameVolumeThreshold verbatim — never a second copy of either
// threshold or its OR chain. Both percentile thresholds are derived, once
// per request, from the SAME loadEntityBaselinePanel population
// developments.ts's getDevelopmentsDetailed itself scans (same population,
// same values) — a Developments card and this classification never disagree.

export type EntityRole = "anchor" | "famous" | "satellite";

export interface EntityRoleResult {
  role: EntityRole;
  roleReasons: string[];
}

export interface ClassifyEntityRoleInput {
  type: string;
  anchorThreshold: number;
  fameVolumeThreshold: number;
  fame: FameFacts;
}

/** Pure — plain values only, no SQL. anchor: isAnchor's own gate; each of
 * its two prongs (type, then volume) contributes its own reason when it
 * independently fires. famous (checked only once anchor doesn't fire,
 * mirroring developments.ts's isSatellite ordering): isFamous's own gate,
 * decomposed into its four prongs for roleReasons — the identical
 * conditions isFamous itself ORs, so roleReasons is non-empty exactly when
 * isFamous is true. satellite: neither gate fires, reasons empty. */
export function classifyEntityRole(input: ClassifyEntityRoleInput): EntityRoleResult {
  const anchorReasons: string[] = [];
  if (input.type === "country" || input.type === "region") anchorReasons.push("country_or_region_type");
  if (input.fame.baselineDaily >= input.anchorThreshold) anchorReasons.push("high_baseline");
  if (isAnchor(input.type, input.fame.baselineDaily, input.anchorThreshold)) {
    return { role: "anchor", roleReasons: anchorReasons };
  }

  const famousReasons: string[] = [];
  if (input.fame.storedFame === "famous") famousReasons.push("famous_stored");
  if (isDictionaryFamous(input.fame.names)) famousReasons.push("famous_dictionary");
  if (isBreadthFamous(input.fame.sourceBreadth)) famousReasons.push("famous_breadth");
  if (isVolumeFamous(input.fame.baselineDaily, input.fameVolumeThreshold)) famousReasons.push("famous_volume");
  if (isFamous(input.fame, input.fameVolumeThreshold)) {
    return { role: "famous", roleReasons: famousReasons };
  }

  return { role: "satellite", roleReasons: [] };
}

function toStoredFame(fame: string): StoredFame {
  return fame === "not_famous" || fame === "famous" ? fame : "unknown";
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

// Local copy of developments.ts's own private getSystemEpoch/
// computeDaysSinceEpoch — the same established convention brief.ts,
// run-ingest.ts, and the developments/signals API routes each already
// follow: a tiny DB+pure helper pair duplicated per module rather than
// exported for one caller.
async function getSystemEpoch(sql: Sql): Promise<Date | null> {
  const rows = await sql`SELECT MIN(first_seen_at) AS min_first_seen FROM articles`;
  const value = rows[0]?.min_first_seen;
  return value == null ? null : toDate(value);
}

function computeDaysSinceEpoch(now: Date, epoch: Date): number {
  return Math.floor((now.getTime() - epoch.getTime()) / (24 * 3600 * 1000));
}

interface RoleThresholds {
  anchorThreshold: number;
  fameVolumeThreshold: number;
  baselineDailyById: Map<number, number>;
}

/** ONE loadEntityBaselinePanel call; both threshold percentiles derived in
 * JS from that single population — mirrors getDevelopmentsDetailed exactly.
 * Skips the panel query when the system has no operating history yet (no
 * articles at all): every baselineDaily is 0 regardless in that case. */
async function loadRoleThresholds(sql: Sql): Promise<RoleThresholds> {
  const epoch = await getSystemEpoch(sql);
  if (!epoch) {
    return {
      anchorThreshold: computeAnchorThreshold([]),
      fameVolumeThreshold: computeFameVolumeThreshold([]),
      baselineDailyById: new Map(),
    };
  }
  const effectiveBaselineDays = computeEffectiveBaselineDays(computeDaysSinceEpoch(new Date(), epoch));
  const rows: EntityBaselineRow[] = await loadEntityBaselinePanel(sql);
  const baselineDailyById = new Map(rows.map((row) => [row.id, row.baselineMentions / effectiveBaselineDays]));
  const population = rows
    .filter((row) => row.totalMentions15d > 0)
    .map((row) => row.baselineMentions / effectiveBaselineDays);
  return {
    anchorThreshold: computeAnchorThreshold(population),
    fameVolumeThreshold: computeFameVolumeThreshold(population),
    baselineDailyById,
  };
}

/** Attaches role/roleReasons to a bounded row set — the returned PAGE for
 * list mode, the single entity for detail — never the whole matched set:
 * loadLifetimeSourceBreadth's own contract demands a bounded id set. Two
 * queries: the baseline panel (population-wide, same cost class as Brief's
 * own per-request scan) and one breadth query bounded to rows.length ids
 * (<=200 for a list page, 1 for detail). */
export async function attachEntityRoles<
  T extends Pick<EntityAdminJson, "id" | "canonicalName" | "type" | "aliases" | "fame">,
>(sql: Sql, rows: T[]): Promise<(T & EntityRoleResult)[]> {
  if (rows.length === 0) return [];
  const [thresholds, breadthById] = await Promise.all([
    loadRoleThresholds(sql),
    loadLifetimeSourceBreadth(sql, rows.map((row) => row.id)),
  ]);
  return rows.map((row) => {
    const fame: FameFacts = {
      names: [row.canonicalName, ...row.aliases],
      baselineDaily: thresholds.baselineDailyById.get(row.id) ?? 0,
      sourceBreadth: breadthById.get(row.id) ?? 0,
      storedFame: toStoredFame(row.fame),
    };
    const result = classifyEntityRole({
      type: row.type,
      anchorThreshold: thresholds.anchorThreshold,
      fameVolumeThreshold: thresholds.fameVolumeThreshold,
      fame,
    });
    return { ...row, ...result };
  });
}

export type EntitySort = "name" | "first_seen" | "last_seen" | "activity";
const VALID_SORTS = new Set<EntitySort>(["name", "first_seen", "last_seen", "activity"]);
const DEFAULT_SORT: EntitySort = "last_seen";
const VALID_FAME_CHECKED = new Set(["never", "checked"]);
// SUM/COUNT window for the list mode's activity columns (mentions7d,
// sources7d). The detail route reuses the same loaders with its own 30-day
// window — see loadMentionsInWindow/loadSourcesInWindow below.
const ACTIVITY_WINDOW_DAYS = 7;

export interface SearchEntitiesParams {
  q?: string;
  status?: string;
  fame?: string;
  fameChecked?: string;
  fameLocked?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

export interface EntityListItemJson extends EntityAdminJson {
  lastSeenAt: string | null;
  mentions7d: number;
  sources7d: number;
  role: EntityRole;
  roleReasons: string[];
}

// Pre-role-attachment shape: what toEntityListItemJson/compareEntities work
// with, before the returned page (never the whole matched set) is run
// through attachEntityRoles.
type EntityListItemDraft = Omit<EntityListItemJson, "role" | "roleReasons">;

export interface SearchEntitiesResult {
  entities: EntityListItemJson[];
  total: number;
}

function validateSort(sort: string | undefined): EntitySort {
  if (sort === undefined || sort === "") return DEFAULT_SORT;
  if (!VALID_SORTS.has(sort as EntitySort)) {
    throw new ValidationError(`sort must be one of: ${[...VALID_SORTS].join(", ")}`);
  }
  return sort as EntitySort;
}

/** ?fameChecked=never -> fame_checked_at IS NULL (the "Never checked" stat
 * tile). ?fameChecked=checked -> fame_checked_at IS NOT NULL — combined with
 * ?fame=unknown this is exactly loadEntityStats's parked_count definition
 * (checked, found nothing), so no separate "parked" param is needed. */
function validateFameChecked(fameChecked: string | undefined): "never" | "checked" | undefined {
  if (fameChecked === undefined || fameChecked === "") return undefined;
  if (!VALID_FAME_CHECKED.has(fameChecked)) {
    throw new ValidationError(`fameChecked must be one of: ${[...VALID_FAME_CHECKED].join(", ")}`);
  }
  return fameChecked as "never" | "checked";
}

/** Only "true" is a meaningful filter value (the "Locked" stat tile) — there
 * is no fameLocked=false view, so any other value is rejected rather than
 * silently accepted as a no-op. */
function validateFameLocked(fameLocked: string | undefined): true | undefined {
  if (fameLocked === undefined || fameLocked === "") return undefined;
  if (fameLocked !== "true") {
    throw new ValidationError('fameLocked must be "true"');
  }
  return true;
}

function validateQ(q: string | undefined): string | undefined {
  if (q === undefined) return undefined;
  if (typeof q !== "string" || q.length > MAX_Q_LEN) {
    throw new ValidationError(`q must be a string of at most ${MAX_Q_LEN} characters`);
  }
  const trimmed = q.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateStatus(status: string | undefined): string | undefined {
  if (status === undefined || status === "") return undefined;
  if (!VALID_STATUSES.has(status)) {
    throw new ValidationError(`status must be one of: ${[...VALID_STATUSES].join(", ")}`);
  }
  return status;
}

function validateFame(fame: string | undefined): string | undefined {
  if (fame === undefined || fame === "") return undefined;
  if (!VALID_FAME.has(fame)) {
    throw new ValidationError(`fame must be one of: ${[...VALID_FAME].join(", ")}`);
  }
  return fame;
}

function validateLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ValidationError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

function validateOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ValidationError("offset must be a non-negative integer");
  }
  return offset;
}

/** status/fame are pushed down to SQL (cheap, exact-match filters); q is
 * matched in JS via normalizeName — the SAME scheme extract-v2.ts uses at
 * ingest time, so search behaves like ingest's own name resolution. Porting
 * NFKD-fold/corporate-suffix-stripping into SQL would risk the two schemes
 * drifting apart. This mirrors /api/entities's existing single-name lookup,
 * which already loads the full table and matches in JS. Four branches
 * (rather than dynamic SQL-fragment building) since the Sql contract is a
 * plain tagged template with no query-builder escape hatch. */
async function loadFilteredRows(sql: Sql, status: string | undefined, fame: string | undefined): Promise<SqlRow[]> {
  if (status !== undefined && fame !== undefined) {
    return sql`
      SELECT id, canonical_name, type, status, aliases, fame, fame_locked,
             wiki_title, wiki_sitelinks, wiki_pageviews_monthly, fame_checked_at, first_seen_at, last_seen_at
      FROM entities WHERE status = ${status} AND fame = ${fame} ORDER BY id ASC
    `;
  }
  if (status !== undefined) {
    return sql`
      SELECT id, canonical_name, type, status, aliases, fame, fame_locked,
             wiki_title, wiki_sitelinks, wiki_pageviews_monthly, fame_checked_at, first_seen_at, last_seen_at
      FROM entities WHERE status = ${status} ORDER BY id ASC
    `;
  }
  if (fame !== undefined) {
    return sql`
      SELECT id, canonical_name, type, status, aliases, fame, fame_locked,
             wiki_title, wiki_sitelinks, wiki_pageviews_monthly, fame_checked_at, first_seen_at, last_seen_at
      FROM entities WHERE fame = ${fame} ORDER BY id ASC
    `;
  }
  return sql`
    SELECT id, canonical_name, type, status, aliases, fame, fame_locked,
           wiki_title, wiki_sitelinks, wiki_pageviews_monthly, fame_checked_at, first_seen_at, last_seen_at
    FROM entities ORDER BY id ASC
  `;
}

function matchesQuery(row: SqlRow, normalizedQ: string): boolean {
  if (normalizeName(String(row.canonical_name)).includes(normalizedQ)) return true;
  const aliases = Array.isArray(row.aliases) ? (row.aliases as string[]) : [];
  return aliases.some((alias) => normalizeName(alias).includes(normalizedQ));
}

function matchesFameChecked(row: SqlRow, fameChecked: "never" | "checked"): boolean {
  const checked = row.fame_checked_at != null;
  return fameChecked === "never" ? !checked : checked;
}

/** q/fameChecked/fameLocked all filter in JS over the status/fame-filtered
 * SQL rows — the same reasoning as matchesQuery's own comment (no
 * query-builder escape hatch for the plain Sql tagged-template contract, and
 * these are all cheap column checks over rows already in memory). */
function filterMatchedRows(
  rows: SqlRow[],
  normalizedQ: string | undefined,
  fameChecked: "never" | "checked" | undefined,
  fameLocked: true | undefined,
): SqlRow[] {
  return rows.filter((row) => {
    if (normalizedQ !== undefined && !matchesQuery(row, normalizedQ)) return false;
    if (fameChecked !== undefined && !matchesFameChecked(row, fameChecked)) return false;
    if (fameLocked !== undefined && !row.fame_locked) return false;
    return true;
  });
}

function toEntityListItemJson(
  row: SqlRow,
  mentions7dById: Map<number, number>,
  sources7dById: Map<number, number>,
): EntityListItemDraft {
  const base = toEntityAdminJson(row);
  return {
    ...base,
    lastSeenAt: row.last_seen_at != null ? toIsoString(row.last_seen_at) : null,
    mentions7d: mentions7dById.get(base.id) ?? 0,
    sources7d: sources7dById.get(base.id) ?? 0,
  };
}

/** last_seen sorts nulls (an entity with no recorded mention yet) after
 * every real timestamp in either comparison direction — a null last-seen is
 * never "more recent" than a real one. */
function compareLastSeenDesc(a: EntityListItemDraft, b: EntityListItemDraft): number {
  if (a.lastSeenAt === b.lastSeenAt) return 0;
  if (a.lastSeenAt === null) return 1;
  if (b.lastSeenAt === null) return -1;
  return b.lastSeenAt.localeCompare(a.lastSeenAt);
}

/** Each sort option is a fixed, opinionated direction (TABS-REDESIGN-PLAN.md
 * §6: no direction param). ISO-8601 timestamp strings sort correctly under
 * plain string comparison, so no Date parsing is needed here. */
function compareEntities(a: EntityListItemDraft, b: EntityListItemDraft, sort: EntitySort): number {
  if (sort === "name") return a.canonicalName.localeCompare(b.canonicalName);
  if (sort === "first_seen") return b.firstSeenAt.localeCompare(a.firstSeenAt);
  if (sort === "activity") return b.mentions7d - a.mentions7d;
  return compareLastSeenDesc(a, b);
}

/** SUM(mentions) per entity over the trailing windowDays, for the given
 * entity ids only. Shared by list mode's 7-day activity column and detail
 * mode's 30-day activity summary. */
export async function loadMentionsInWindow(sql: Sql, entityIds: number[], windowDays: number): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (entityIds.length === 0) return map;
  const rows = await sql`
    SELECT entity_id, SUM(mentions) AS mentions_in_window
    FROM entity_mentions_hourly
    WHERE entity_id = ANY(${entityIds}::bigint[])
      AND bucket >= now() - make_interval(days => ${windowDays}::int)
    GROUP BY entity_id
  `;
  for (const row of rows) map.set(Number(row.entity_id), Number(row.mentions_in_window));
  return map;
}

/** Distinct source_name count per entity over the trailing windowDays, via
 * article_entities/articles windowed on articles.first_seen_at — mirrors
 * fame.ts's loadLifetimeSourceBreadth, windowed. NEVER summed from
 * entity_mentions_hourly.source_count across hourly buckets: a source
 * appearing in multiple hours would be double-counted that way. */
export async function loadSourcesInWindow(sql: Sql, entityIds: number[], windowDays: number): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (entityIds.length === 0) return map;
  const rows = await sql`
    SELECT ae.entity_id, COUNT(DISTINCT a.source_name) AS sources_in_window
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE ae.entity_id = ANY(${entityIds}::bigint[])
      AND a.first_seen_at >= now() - make_interval(days => ${windowDays}::int)
    GROUP BY ae.entity_id
  `;
  for (const row of rows) map.set(Number(row.entity_id), Number(row.sources_in_window));
  return map;
}

/** Case-insensitive search over canonical_name and aliases, filterable by
 * status/fame/fameChecked/fameLocked, sortable, bounded and paged (default
 * 50, max 200 per page). Every input is validated at this module boundary —
 * a malformed value is REJECTED, never silently coerced to a default.
 * Activity aggregates (mentions7d/sources7d) and sort are computed over the
 * FULL matched set — one GROUP BY query each, per TABS-REDESIGN-PLAN.md §6's
 * query-cost note — before the existing offset/limit slice is applied.
 * role/roleReasons (see attachEntityRoles) are computed AFTER that slice,
 * for the returned page only — the baseline panel plus one breadth query
 * bounded to the page's own ids, never the full matched set. */
export async function searchEntities(sql: Sql, params: SearchEntitiesParams): Promise<SearchEntitiesResult> {
  const q = validateQ(params.q);
  const status = validateStatus(params.status);
  const fame = validateFame(params.fame);
  const fameChecked = validateFameChecked(params.fameChecked);
  const fameLocked = validateFameLocked(params.fameLocked);
  const sort = validateSort(params.sort);
  const limit = validateLimit(params.limit);
  const offset = validateOffset(params.offset);

  const rows = await loadFilteredRows(sql, status, fame);
  const normalizedQ = q !== undefined ? normalizeName(q) : undefined;
  const matched = filterMatchedRows(rows, normalizedQ, fameChecked, fameLocked);

  const ids = matched.map((row) => Number(row.id));
  const [mentions7dById, sources7dById] = await Promise.all([
    loadMentionsInWindow(sql, ids, ACTIVITY_WINDOW_DAYS),
    loadSourcesInWindow(sql, ids, ACTIVITY_WINDOW_DAYS),
  ]);
  const enriched = matched.map((row) => toEntityListItemJson(row, mentions7dById, sources7dById));
  enriched.sort((a, b) => compareEntities(a, b, sort));

  // role/roleReasons is display metadata computed for the RETURNED PAGE only
  // (post-slice), never the whole matched set — see attachEntityRoles.
  const page = enriched.slice(offset, offset + limit);
  const withRoles = await attachEntityRoles(sql, page);

  return {
    entities: withRoles,
    total: enriched.length,
  };
}

// ---- loadEntityStats ----

export interface EntityStats {
  totalTracked: number;
  famousCount: number;
  notFamousCount: number;
  unknownCount: number;
  parkedCount: number;
  neverCheckedCount: number;
  lockedCount: number;
  oldestFameCheckedAt: string | null;
  newestFameCheckedAt: string | null;
}

/** One-query health readout for the tracked fame layer, so the system can
 * report its own state without a SQL paste. Scoped to status='tracked'
 * throughout — fame is only meaningfully maintained for tracked entities
 * (see fame-sweep.ts). "Parked" (fame='unknown' but a check DID run and
 * found nothing — a real, if inconclusive, verdict) is counted separately
 * from "never checked" (fame_checked_at IS NULL) — DESIGN.md spine #4:
 * honest time never collapses those two into one bucket. Bare aggregates
 * with no GROUP BY always return exactly one row, so an empty table yields
 * all-zero counts and null timestamps rather than an empty result set. */
export async function loadEntityStats(sql: Sql): Promise<EntityStats> {
  const rows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'tracked') AS total_tracked,
      COUNT(*) FILTER (WHERE status = 'tracked' AND fame = 'famous') AS famous_count,
      COUNT(*) FILTER (WHERE status = 'tracked' AND fame = 'not_famous') AS not_famous_count,
      COUNT(*) FILTER (WHERE status = 'tracked' AND fame = 'unknown') AS unknown_count,
      COUNT(*) FILTER (WHERE status = 'tracked' AND fame = 'unknown' AND fame_checked_at IS NOT NULL) AS parked_count,
      COUNT(*) FILTER (WHERE status = 'tracked' AND fame_checked_at IS NULL) AS never_checked_count,
      COUNT(*) FILTER (WHERE status = 'tracked' AND fame_locked = true) AS locked_count,
      MIN(fame_checked_at) FILTER (WHERE status = 'tracked') AS oldest_checked_at,
      MAX(fame_checked_at) FILTER (WHERE status = 'tracked') AS newest_checked_at
    FROM entities
  `;
  const row = rows[0];
  return {
    totalTracked: Number(row.total_tracked),
    famousCount: Number(row.famous_count),
    notFamousCount: Number(row.not_famous_count),
    unknownCount: Number(row.unknown_count),
    parkedCount: Number(row.parked_count),
    neverCheckedCount: Number(row.never_checked_count),
    lockedCount: Number(row.locked_count),
    oldestFameCheckedAt: row.oldest_checked_at != null ? toIsoString(row.oldest_checked_at) : null,
    newestFameCheckedAt: row.newest_checked_at != null ? toIsoString(row.newest_checked_at) : null,
  };
}

// ---- findSimilarNames (pure, no DB) ----

export interface SimilarNameEntity {
  id: number;
  canonicalName: string;
}

export interface SimilarNameGroup {
  entities: SimilarNameEntity[];
}

/** Strips punctuation (periods, commas, hyphens, ...) from an
 * already-normalizeName'd string, leaving letters/digits/spaces — folds
 * "u.s. military" to "us military", matching "US military" after its own
 * normalizeName pass (which has no periods to strip in the first place). */
function stripPunctuation(normalized: string): string {
  return normalized
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the shorter word list is a whole-word run at the START or END
 * of the longer one — "air force"/"air force one" (start), "modi"/"narendra
 * modi" (end). Whole-word only, never a substring within a word ("iran"
 * must never match inside "iranian"). Equal-length lists are never a match
 * here (identical ones are already caught by the exact-key rule above). */
function isWholeWordRun(wordsA: string[], wordsB: string[]): boolean {
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  if (shorter.length === 0 || shorter.length === longer.length) return false;
  if (shorter.every((word, i) => word === longer[i])) return true;
  const offset = longer.length - shorter.length;
  return shorter.every((word, i) => word === longer[offset + i]);
}

function likelyDuplicate(keyA: string, keyB: string): boolean {
  return keyA === keyB || isWholeWordRun(keyA.split(" "), keyB.split(" "));
}

/** Groups canonical names that are likely the same entity under different
 * spellings — deliberately simple and explainable, two rules only: (1)
 * identical once punctuation/periods are stripped ("U.S. military"/"US
 * military"), or (2) one name is a whole-word prefix or suffix of the other
 * ("Air Force"/"Air Force One", "Modi"/"Narendra Modi"). No fuzzy distance
 * metrics. Pure and DB-free — the caller loads entities, this only groups
 * them; it never merges anything, only suggests. Order-independent:
 * grouping is by connected components (union-find) over pairwise matches,
 * so the result never depends on input order. */
export function findSimilarNames(entities: SimilarNameEntity[]): SimilarNameGroup[] {
  const keys = entities.map((e) => stripPunctuation(normalizeName(e.canonicalName)));
  const parent = entities.map((_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      if (!likelyDuplicate(keys[i], keys[j])) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    }
  }

  const groups = new Map<number, SimilarNameEntity[]>();
  for (let i = 0; i < entities.length; i++) {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), entities[i]]);
  }

  return [...groups.values()]
    .filter((group) => group.length >= 2)
    .map((group) => ({ entities: [...group].sort((a, b) => a.id - b.id) }))
    .sort((a, b) => a.entities[0].id - b.entities[0].id);
}
