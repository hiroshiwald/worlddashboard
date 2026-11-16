import type { Sql, SqlRow } from "./db";
import { attachEntityRoles, type EntityRole } from "./entity-admin";
import { getLastIngestAt } from "./tick";

export class FeedParamError extends Error {}

export interface FeedEntity {
  id: string;
  name: string;
  type: string;
  status: "candidate" | "tracked" | "dismissed";
  role: EntityRole;
  firstSeenAt: string;
}

export interface FeedArticle {
  id: string;
  title: string;
  link: string;
  sourceName: string;
  sourceCategory: string;
  firstSeenAt: string;
  publishedAt: string | null;
  entities: FeedEntity[];
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

export function toFeedEntity(row: SqlRow, role: EntityRole): FeedEntity {
  const status = String(row.status);
  if (!ENTITY_STATUSES.has(status)) throw new Error(`feed: unexpected entity status "${status}"`);
  return {
    id: String(row.entity_id),
    name: String(row.canonical_name),
    type: String(row.type),
    status: status as FeedEntity["status"],
    role,
    firstSeenAt: toIso(row.entity_first_seen_at),
  };
}

export function toFeedArticle(row: SqlRow, entities: FeedEntity[]): FeedArticle {
  return {
    id: String(row.id),
    title: String(row.title),
    link: String(row.link),
    sourceName: String(row.source_name),
    sourceCategory: String(row.source_category),
    firstSeenAt: toIso(row.first_seen_at),
    publishedAt: row.published_at == null ? null : toIso(row.published_at),
    entities,
  };
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
    return sql`SELECT id, title, link, source_name, source_category, first_seen_at, published_at
      FROM articles
      WHERE (first_seen_at, id) < (${firstSeenAt}::timestamptz, ${id}::bigint)
      ORDER BY first_seen_at DESC, id DESC LIMIT ${fetchCount}`;
  }
  if (params.after) {
    const { firstSeenAt, id } = params.after;
    // Exactly `limit` rows nearest the cursor (no probe row: trimming would
    // drop the row adjacent to the cursor), flipped to newest first.
    return sql`SELECT * FROM (
        SELECT id, title, link, source_name, source_category, first_seen_at, published_at
        FROM articles
        WHERE (first_seen_at, id) > (${firstSeenAt}::timestamptz, ${id}::bigint)
        ORDER BY first_seen_at ASC, id ASC LIMIT ${params.limit}
      ) newer ORDER BY first_seen_at DESC, id DESC`;
  }
  return sql`SELECT id, title, link, source_name, source_category, first_seen_at, published_at
    FROM articles ORDER BY first_seen_at DESC, id DESC LIMIT ${fetchCount}`;
}

async function loadArticleEntities(sql: Sql, articleIds: string[]): Promise<SqlRow[]> {
  if (articleIds.length === 0) return [];
  return sql`SELECT ae.article_id, e.id AS entity_id, e.canonical_name, e.type, e.status,
      e.aliases, e.fame, e.first_seen_at AS entity_first_seen_at
    FROM article_entities ae JOIN entities e ON e.id = ae.entity_id
    WHERE ae.article_id = ANY(${articleIds}::bigint[])
    ORDER BY ae.article_id, e.id`;
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

export async function loadFeed(sql: Sql, params: FeedParams): Promise<FeedResponse> {
  const [rows, lastIngest] = await Promise.all([loadArticlePage(sql, params), getLastIngestAt(sql)]);
  const { pageRows, nextCursor } = paginate(rows, params);
  const entityRows = await loadArticleEntities(sql, pageRows.map((r) => String(r.id)));
  const roleById = await loadRoles(sql, entityRows);
  const byArticle = groupEntitiesByArticle(entityRows, roleById);
  return {
    items: pageRows.map((row) => toFeedArticle(row, byArticle.get(String(row.id)) ?? [])),
    nextCursor,
    lastIngestAt: lastIngest ? lastIngest.toISOString() : null,
  };
}
