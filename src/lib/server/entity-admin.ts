import type { Sql, SqlRow } from "./db";
import { normalizeName } from "./extract-v2";

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

export interface SearchEntitiesParams {
  q?: string;
  status?: string;
  fame?: string;
  limit?: number;
  offset?: number;
}

export interface SearchEntitiesResult {
  entities: EntityAdminJson[];
  total: number;
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
             wiki_title, wiki_sitelinks, wiki_pageviews_monthly, fame_checked_at, first_seen_at
      FROM entities WHERE status = ${status} AND fame = ${fame} ORDER BY id ASC
    `;
  }
  if (status !== undefined) {
    return sql`
      SELECT id, canonical_name, type, status, aliases, fame, fame_locked,
             wiki_title, wiki_sitelinks, wiki_pageviews_monthly, fame_checked_at, first_seen_at
      FROM entities WHERE status = ${status} ORDER BY id ASC
    `;
  }
  if (fame !== undefined) {
    return sql`
      SELECT id, canonical_name, type, status, aliases, fame, fame_locked,
             wiki_title, wiki_sitelinks, wiki_pageviews_monthly, fame_checked_at, first_seen_at
      FROM entities WHERE fame = ${fame} ORDER BY id ASC
    `;
  }
  return sql`
    SELECT id, canonical_name, type, status, aliases, fame, fame_locked,
           wiki_title, wiki_sitelinks, wiki_pageviews_monthly, fame_checked_at, first_seen_at
    FROM entities ORDER BY id ASC
  `;
}

function matchesQuery(row: SqlRow, normalizedQ: string): boolean {
  if (normalizeName(String(row.canonical_name)).includes(normalizedQ)) return true;
  const aliases = Array.isArray(row.aliases) ? (row.aliases as string[]) : [];
  return aliases.some((alias) => normalizeName(alias).includes(normalizedQ));
}

/** Case-insensitive search over canonical_name and aliases, filterable by
 * status/fame, bounded and paged (default 50, max 200 per page). Every
 * input is validated at this module boundary — a malformed limit, offset,
 * status, or fame is REJECTED, never silently coerced to a default. */
export async function searchEntities(sql: Sql, params: SearchEntitiesParams): Promise<SearchEntitiesResult> {
  const q = validateQ(params.q);
  const status = validateStatus(params.status);
  const fame = validateFame(params.fame);
  const limit = validateLimit(params.limit);
  const offset = validateOffset(params.offset);

  const rows = await loadFilteredRows(sql, status, fame);
  const normalizedQ = q !== undefined ? normalizeName(q) : undefined;
  const matched = normalizedQ !== undefined ? rows.filter((row) => matchesQuery(row, normalizedQ)) : rows;

  return {
    entities: matched.slice(offset, offset + limit).map(toEntityAdminJson),
    total: matched.length,
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
