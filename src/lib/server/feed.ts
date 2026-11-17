import type { Sql, SqlRow } from "./db";
import { attachEntityRoles, type EntityRole } from "./entity-admin";
import { getLastIngestAt } from "./tick";
import { buildMergeGroups, type MergeEntity } from "../soft-merge";
import { buildCandidateMatcher, foldText, publisherSuffix, stripPublisherSuffix, type CandidateMatcher } from "../candidate-match";

export class FeedParamError extends Error {}

export interface FeedEntity {
  id: string;
  name: string;
  type: string;
  status: "candidate" | "tracked" | "dismissed";
  role: EntityRole;
  firstSeenAt: string;
}

/** An untracked name (entity_candidates row) whose name appears in the
 * article's title or summary. Matched at read time; see candidate-match.ts. */
export interface FeedCandidate {
  nameNorm: string;
  name: string;
  typeHint: string;
  firstSeenAt: string;
  mentionCount: number;
}

export interface FeedArticle {
  id: string;
  title: string;
  link: string;
  sourceName: string;
  sourceCategory: string;
  firstSeenAt: string;
  publishedAt: string | null;
  titleEn: string | null;
  entities: FeedEntity[];
  candidates: FeedCandidate[];
}

export interface FeedResponse {
  items: FeedArticle[];
  nextCursor: string | null;
  lastIngestAt: string | null;
}

export interface Cursor {
  firstSeenAt: string;
  id: string;
}

export interface FeedParams {
  limit: number;
  before: Cursor | null;
  after: Cursor | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const ENTITY_STATUSES = new Set(["candidate", "tracked", "dismissed"]);
// Candidates seen up to this long before the page's oldest article can match it.
const CANDIDATE_PAD_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 3000;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.firstSeenAt}|${cursor.id}`, "utf8").toString("base64url");
}

/** Throws FeedParamError on anything that is not a base64url "<ISO>|<digits>". */
export function decodeCursor(raw: string): Cursor {
  const parts = Buffer.from(raw, "base64url").toString("utf8").split("|");
  if (parts.length !== 2) throw new FeedParamError("invalid cursor");
  const [firstSeenAt, id] = parts;
  const parsed = new Date(firstSeenAt);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== firstSeenAt) {
    throw new FeedParamError("invalid cursor");
  }
  if (!/^\d{1,18}$/.test(id)) throw new FeedParamError("invalid cursor");
  return { firstSeenAt, id };
}

function parseLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) throw new FeedParamError("limit must be an integer");
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_LIMIT) throw new FeedParamError(`limit must be between 1 and ${MAX_LIMIT}`);
  return limit;
}

export function parseFeedParams(params: URLSearchParams): FeedParams {
  const limit = parseLimit(params.get("limit"));
  const beforeRaw = params.get("before");
  const afterRaw = params.get("after");
  if (beforeRaw !== null && afterRaw !== null) {
    throw new FeedParamError("before and after cannot be combined");
  }
  return {
    limit,
    before: beforeRaw === null ? null : decodeCursor(beforeRaw),
    after: afterRaw === null ? null : decodeCursor(afterRaw),
  };
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(value as string).toISOString();
}

/** "tracked" in the Newsfeed means the operator followed it. A row the
 * system knows (status 'tracked') but nobody followed reads as untracked. */
function feedStatus(status: string, followed: unknown): FeedEntity["status"] {
  if (typeof followed !== "boolean") throw new Error("feed: entities.followed missing; run migration 011");
  if (followed) return "tracked";
  if (status === "dismissed") return "dismissed";
  return "candidate";
}

export function toFeedEntity(row: SqlRow, role: EntityRole): FeedEntity {
  const status = String(row.status);
  if (!ENTITY_STATUSES.has(status)) throw new Error(`feed: unexpected entity status "${status}"`);
  return {
    id: String(row.entity_id),
    name: String(row.canonical_name),
    type: String(row.type),
    status: feedStatus(status, row.followed),
    role,
    firstSeenAt: toIso(row.entity_first_seen_at),
  };
}

export function toFeedArticle(row: SqlRow, entities: FeedEntity[], candidates: FeedCandidate[] = []): FeedArticle {
  return {
    id: String(row.id),
    title: String(row.title),
    link: String(row.link),
    sourceName: String(row.source_name),
    sourceCategory: String(row.source_category),
    firstSeenAt: toIso(row.first_seen_at),
    publishedAt: row.published_at == null ? null : toIso(row.published_at),
    titleEn: row.title_en == null ? null : String(row.title_en),
    entities,
    candidates,
  };
}

export function toFeedCandidate(row: SqlRow): FeedCandidate & { displayName: string } {
  const name = String(row.display_name);
  return {
    nameNorm: String(row.name_norm),
    name,
    displayName: name,
    typeHint: String(row.type_hint),
    firstSeenAt: toIso(row.first_seen_at),
    mentionCount: Number(row.mention_count),
  };
}

/** Title (publisher suffix removed) plus summary: the text names are matched in. */
function articleText(row: SqlRow): string {
  return `${stripPublisherSuffix(String(row.title))}\n${row.summary == null ? "" : String(row.summary)}`;
}

/** The source's own name and the title's publisher suffix are not news content. */
function publisherNames(row: SqlRow): Set<string> {
  const names = new Set([foldText(String(row.source_name))]);
  const publisher = publisherSuffix(String(row.title));
  if (publisher !== null) names.add(foldText(publisher));
  return names;
}

type MatchableCandidate = FeedCandidate & { displayName: string };

/** Pure. Raw article title -> candidates that list it in sample_titles. Links
 * names the text matcher misses ("Lionfish UUVs" vs "Lionfish UUV", "HII"). */
export function buildTitleIndex(candidateRows: SqlRow[]): Map<string, MatchableCandidate[]> {
  const index = new Map<string, MatchableCandidate[]>();
  for (const row of candidateRows) {
    if (!Array.isArray(row.sample_titles)) continue;
    const candidate = toFeedCandidate(row);
    for (const title of row.sample_titles as unknown[]) {
      if (typeof title !== "string") continue;
      const list = index.get(title) ?? [];
      list.push(candidate);
      index.set(title, list);
    }
  }
  return index;
}

/** Pure. Candidates whose name is in the title (publisher suffix removed) or
 * summary, or who list the article's raw title in sample_titles, minus names
 * already linked as entities and the source's own name. One per nameNorm. */
export function matchArticleCandidates(
  row: SqlRow,
  entities: FeedEntity[],
  matcher: CandidateMatcher<MatchableCandidate>,
  titleIndex: Map<string, MatchableCandidate[]> = new Map(),
): FeedCandidate[] {
  const exclude = publisherNames(row);
  for (const entity of entities) exclude.add(foldText(entity.name));
  const byNorm = new Map<string, MatchableCandidate>();
  const linked = titleIndex.get(String(row.title)) ?? [];
  for (const candidate of [...matcher.match(articleText(row), exclude), ...linked]) {
    if (exclude.has(foldText(candidate.displayName))) continue;
    if (!byNorm.has(candidate.nameNorm)) byNorm.set(candidate.nameNorm, candidate);
  }
  return [...byNorm.values()].map(({ displayName: _unused, ...candidate }) => candidate);
}

/** One matchable name form (canonical name or alias) of a tracked entity. */
export interface TrackedName {
  nameNorm: string;
  displayName: string;
  row: SqlRow;
}

/** One entry per canonical name and per alias. A bare surname matches only
 * when it is listed as an alias; no surname is derived. */
export function buildTrackedMatcher(entityRows: SqlRow[]): CandidateMatcher<TrackedName> {
  const names: TrackedName[] = [];
  for (const row of entityRows) {
    const aliases = Array.isArray(row.aliases) ? (row.aliases as string[]) : [];
    for (const name of [String(row.canonical_name), ...aliases]) {
      names.push({ nameNorm: foldText(name), displayName: name, row });
    }
  }
  return buildCandidateMatcher(names);
}

/** Pure. Tracked entity rows named in the article's title or summary, one per
 * entity id, in order of first match. Same guards as candidate matching. */
export function matchTrackedEntities(row: SqlRow, matcher: CandidateMatcher<TrackedName>): SqlRow[] {
  const byId = new Map<string, SqlRow>();
  for (const found of matcher.match(articleText(row), publisherNames(row))) {
    byId.set(String(found.row.entity_id), found.row);
  }
  return [...byId.values()];
}

/** Groups entity rows by article id, preserving row order. */
export function groupEntitiesByArticle(
  rows: SqlRow[],
  roleById: Map<string, EntityRole>,
): Map<string, FeedEntity[]> {
  const grouped = new Map<string, FeedEntity[]>();
  for (const row of rows) {
    const entity = toFeedEntity(row, roleById.get(String(row.entity_id)) ?? "satellite");
    const key = String(row.article_id);
    const list = grouped.get(key) ?? [];
    list.push(entity);
    grouped.set(key, list);
  }
  return grouped;
}

/** Fetches limit+1 rows so the caller can tell whether another page exists. */
async function loadArticlePage(sql: Sql, params: FeedParams): Promise<SqlRow[]> {
  const fetchCount = params.limit + 1;
  if (params.before) {
    const { firstSeenAt, id } = params.before;
    return sql`SELECT id, title, link, source_name, source_category, first_seen_at, published_at, title_en, summary
      FROM articles
      WHERE (first_seen_at, id) < (${firstSeenAt}::timestamptz, ${id}::bigint)
      ORDER BY first_seen_at DESC, id DESC LIMIT ${fetchCount}`;
  }
  if (params.after) {
    const { firstSeenAt, id } = params.after;
    // Exactly `limit` rows nearest the cursor (no probe row: trimming would
    // drop the row adjacent to the cursor), flipped to newest first.
    return sql`SELECT * FROM (
        SELECT id, title, link, source_name, source_category, first_seen_at, published_at, title_en, summary
        FROM articles
        WHERE (first_seen_at, id) > (${firstSeenAt}::timestamptz, ${id}::bigint)
        ORDER BY first_seen_at ASC, id ASC LIMIT ${params.limit}
      ) newer ORDER BY first_seen_at DESC, id DESC`;
  }
  return sql`SELECT id, title, link, source_name, source_category, first_seen_at, published_at, title_en, summary
    FROM articles ORDER BY first_seen_at DESC, id DESC LIMIT ${fetchCount}`;
}

async function loadArticleEntities(sql: Sql, articleIds: string[]): Promise<SqlRow[]> {
  if (articleIds.length === 0) return [];
  return sql`SELECT ae.article_id, e.id AS entity_id, e.canonical_name, e.type, e.status, e.followed,
      e.aliases, e.fame, e.wiki_title, e.first_seen_at AS entity_first_seen_at
    FROM article_entities ae JOIN entities e ON e.id = ae.entity_id
    WHERE ae.article_id = ANY(${articleIds}::bigint[])
    ORDER BY ae.article_id, e.id`;
}

async function loadTrackedEntities(sql: Sql): Promise<SqlRow[]> {
  return sql`SELECT tn.id AS entity_id, tn.canonical_name, tn.type, tn.status, tn.followed, tn.aliases, tn.fame, tn.wiki_title,
      tn.first_seen_at AS entity_first_seen_at
    FROM entities tn WHERE tn.status = 'tracked'`;
}

async function loadCandidates(sql: Sql, pageRows: SqlRow[]): Promise<SqlRow[]> {
  if (pageRows.length === 0) return [];
  let oldest = Infinity;
  for (const row of pageRows) oldest = Math.min(oldest, new Date(toIso(row.first_seen_at)).getTime());
  const since = new Date(oldest - CANDIDATE_PAD_MS).toISOString();
  return sql`SELECT name_norm, display_name, type_hint, first_seen_at, mention_count, sample_titles
    FROM entity_candidates WHERE last_seen_at >= ${since}::timestamptz
    ORDER BY mention_count DESC, name_norm LIMIT ${MAX_CANDIDATES}`;
}

async function loadRoles(sql: Sql, entityRows: SqlRow[]): Promise<Map<string, EntityRole>> {
  const distinct = new Map<string, SqlRow>();
  for (const row of entityRows) distinct.set(String(row.entity_id), row);
  const inputs = [...distinct.values()].map((row) => ({
    id: Number(row.entity_id),
    canonicalName: String(row.canonical_name),
    type: String(row.type),
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
    fame: String(row.fame),
  }));
  const classified = await attachEntityRoles(sql, inputs);
  return new Map(classified.map((e) => [String(e.id), e.role]));
}

/** Trims the probe row. Plain and `before` pages get a nextCursor when the
 * probe row exists; an `after` page (polling) never does. */
export function paginate(
  rows: SqlRow[],
  params: FeedParams,
): { pageRows: SqlRow[]; nextCursor: string | null } {
  const pageRows = rows.slice(0, params.limit);
  const last = pageRows[pageRows.length - 1];
  if (params.after || rows.length <= params.limit || !last) return { pageRows, nextCursor: null };
  return { pageRows, nextCursor: encodeCursor({ firstSeenAt: toIso(last.first_seen_at), id: String(last.id) }) };
}

/** Pure. Merge-group input for one entity row; no mention count is loaded. */
function toMergeEntity(row: SqlRow): MergeEntity {
  return {
    id: String(row.entity_id),
    name: String(row.canonical_name),
    type: String(row.type),
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
    wikiTitle: row.wiki_title == null ? null : String(row.wiki_title),
    mentions: 0,
  };
}

/** Pure. Replaces each article-entity row by its merge group's canonical row
 * (from allRows) and dedupes per article. The shown row is followed if any
 * member of its group is followed. */
export function mergeArticleRows(articleRows: SqlRow[], allRows: SqlRow[]): SqlRow[] {
  const rowById = new Map(allRows.map((row) => [String(row.entity_id), row]));
  const groups = buildMergeGroups([...rowById.values()].map(toMergeEntity));
  const shownById = new Map<string, SqlRow>();
  for (const group of groups) {
    const canonical = rowById.get(group.canonicalId) as SqlRow;
    const followed = group.memberIds.some((id) => rowById.get(id)?.followed === true);
    const shown = { ...canonical, followed: followed || canonical.followed };
    for (const id of group.memberIds) shownById.set(id, shown);
  }
  const seen = new Set<string>();
  const merged: SqlRow[] = [];
  for (const row of articleRows) {
    const shown = shownById.get(String(row.entity_id)) ?? row;
    const key = `${String(row.article_id)}|${String(shown.entity_id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...shown, article_id: row.article_id });
  }
  return merged;
}

/** Per article: ingest-linked entities, plus tracked entities named in the
 * text that ingest did not link, merged by group and deduped. Roles are
 * classified once, on the entities shown. */
async function buildArticleEntities(sql: Sql, pageRows: SqlRow[]): Promise<Map<string, FeedEntity[]>> {
  const [linkedRows, trackedRows] = await Promise.all([
    loadArticleEntities(sql, pageRows.map((r) => String(r.id))),
    loadTrackedEntities(sql),
  ]);
  const trackedMatcher = buildTrackedMatcher(trackedRows);
  const extraRows = pageRows.flatMap((row) =>
    matchTrackedEntities(row, trackedMatcher).map((entity) => ({ ...entity, article_id: row.id })),
  );
  const shownRows = mergeArticleRows([...linkedRows, ...extraRows], [...linkedRows, ...trackedRows]);
  const roleById = await loadRoles(sql, shownRows);
  return groupEntitiesByArticle(shownRows, roleById);
}

export async function loadFeed(sql: Sql, params: FeedParams): Promise<FeedResponse> {
  const [rows, lastIngest] = await Promise.all([loadArticlePage(sql, params), getLastIngestAt(sql)]);
  const { pageRows, nextCursor } = paginate(rows, params);
  const [byArticle, candidateRows] = await Promise.all([buildArticleEntities(sql, pageRows), loadCandidates(sql, pageRows)]);
  const matcher = buildCandidateMatcher(candidateRows.map(toFeedCandidate));
  const titleIndex = buildTitleIndex(candidateRows);
  const items = pageRows.map((row) => {
    const entities = byArticle.get(String(row.id)) ?? [];
    return toFeedArticle(row, entities, matchArticleCandidates(row, entities, matcher, titleIndex));
  });
  return {
    items,
    nextCursor,
    lastIngestAt: lastIngest ? lastIngest.toISOString() : null,
  };
}
