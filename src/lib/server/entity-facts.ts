import { computeGrowth, diversity, type DiversityLabel, type GrowthState, type HourlyCount } from "../entity-growth";
import type { Sql, SqlRow } from "./db";
import { buildMergeGroups, type MergeEntity } from "../soft-merge";

export interface EntityFacts {
  id: string;
  mentions14d: number;
  recent72h: number;
  usualPerDay: number;
  ratio: number;
  state: GrowthState;
  daily: number[];
  sources: { count: number; label: DiversityLabel; top: string[] };
  firstSeenAt: string;
  lastSeenAt: string | null;
}

const MAX_IDS = 2000;
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const TOP_SOURCES = 3;
const ID_PATTERN = /^\d+$/;

function validateIds(ids: string[]): void {
  if (ids.length > MAX_IDS) {
    throw new Error(`loadEntityFacts: at most ${MAX_IDS} ids, got ${ids.length}`);
  }
  for (const id of ids) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      throw new Error(`loadEntityFacts: id must be a digit string, got ${String(id)}`);
    }
  }
}

function toDate(value: unknown, label: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date: ${String(value)}`);
  }
  return date;
}

function groupBy(rows: SqlRow[], key: string): Map<string, SqlRow[]> {
  const groups = new Map<string, SqlRow[]>();
  for (const row of rows) {
    const id = String(row[key]);
    const group = groups.get(id);
    if (group) {
      group.push(row);
    } else {
      groups.set(id, [row]);
    }
  }
  return groups;
}

function topSources(rows: SqlRow[]): string[] {
  return rows
    .map((row) => ({ name: String(row.source_name), count: Number(row.article_count) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_SOURCES)
    .map((entry) => entry.name);
}

/** Pure. Each entity id -> every id in its display-merge group (soft-merge.ts).
 * Duplicates such as "US" and "United States" split mentions between rows,
 * so growth is computed on the group. Nothing in the database changes. */
export function groupMembersById(entities: MergeEntity[]): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const group of buildMergeGroups(entities)) {
    for (const id of group.memberIds) members.set(id, group.memberIds);
  }
  return members;
}

function membersOf(id: string, membersById: Map<string, string[]>): string[] {
  return membersById.get(id) ?? [id];
}

function collect(ids: string[], byId: Map<string, SqlRow[]>): SqlRow[] {
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** One row per source: a group's members can share sources. */
function combineSources(rows: SqlRow[]): SqlRow[] {
  const byName = new Map<string, number>();
  for (const row of rows) {
    const name = String(row.source_name);
    byName.set(name, (byName.get(name) ?? 0) + Number(row.article_count));
  }
  return [...byName].map(([source_name, article_count]) => ({ source_name, article_count }));
}

/** Earliest first_seen_at and latest last_seen_at across the group, status from the entity itself. */
function combineEntity(entity: SqlRow, groupRows: SqlRow[]): SqlRow {
  let first = toDate(entity.first_seen_at, "first_seen_at");
  let last = entity.last_seen_at == null ? null : toDate(entity.last_seen_at, "last_seen_at");
  for (const row of groupRows) {
    const rowFirst = toDate(row.first_seen_at, "first_seen_at");
    if (rowFirst < first) first = rowFirst;
    if (row.last_seen_at == null) continue;
    const rowLast = toDate(row.last_seen_at, "last_seen_at");
    if (last === null || rowLast > last) last = rowLast;
  }
  return { ...entity, first_seen_at: first, last_seen_at: last };
}

function assembleOne(entity: SqlRow, hourlyRows: SqlRow[], sourceRows: SqlRow[], now: Date): EntityFacts {
  const firstSeen = toDate(entity.first_seen_at, "first_seen_at");
  const hourly: HourlyCount[] = hourlyRows.map((row) => ({
    hourStart: toDate(row.bucket, "bucket"),
    count: Number(row.mentions),
  }));
  const growth = computeGrowth({ hourly, firstSeenAt: firstSeen, tracked: entity.status === "tracked", now });
  const names = sourceRows.map((row) => String(row.source_name));
  let mentions14d = 0;
  for (const row of sourceRows) {
    mentions14d += Number(row.article_count);
  }
  return {
    id: String(entity.id),
    mentions14d,
    ...growth,
    sources: { ...diversity(names), top: topSources(sourceRows) },
    firstSeenAt: firstSeen.toISOString(),
    lastSeenAt: entity.last_seen_at == null ? null : toDate(entity.last_seen_at, "last_seen_at").toISOString(),
  };
}

/** Pure. Rows: entities {id,status,first_seen_at,last_seen_at}; hourly
 * {entity_id,bucket,mentions}; sources {entity_id,source_name,article_count}
 * (one row per entity+source, so article_count sums to distinct articles).
 * requestedIds: the ids to return; entityRows may hold their group members too.
 * membersById: from groupMembersById; an id missing from it stands alone. */
export function assembleEntityFacts(
  entityRows: SqlRow[],
  hourlyRows: SqlRow[],
  sourceRows: SqlRow[],
  now: Date,
  membersById: Map<string, string[]> = new Map(),
  requestedIds: string[] = entityRows.map((row) => String(row.id)),
): Map<string, EntityFacts> {
  const hourlyById = groupBy(hourlyRows, "entity_id");
  const sourcesById = groupBy(sourceRows, "entity_id");
  const entityById = groupBy(entityRows, "id");
  const facts = new Map<string, EntityFacts>();
  for (const id of requestedIds) {
    const entity = entityById.get(id)?.[0];
    if (!entity) continue;
    const members = membersOf(id, membersById);
    const combined = combineEntity(entity, collect(members, entityById));
    const sources = combineSources(collect(members, sourcesById));
    facts.set(id, assembleOne(combined, collect(members, hourlyById), sources, now));
  }
  return facts;
}

function toMergeEntity(row: SqlRow): MergeEntity {
  return {
    id: String(row.id),
    name: String(row.canonical_name),
    type: String(row.type),
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
    wikiTitle: row.wiki_title == null ? null : String(row.wiki_title),
    mentions: 0,
  };
}

async function loadMergeMembers(sql: Sql): Promise<Map<string, string[]>> {
  const rows = await sql`
    SELECT id, canonical_name, type, aliases, wiki_title
    FROM entities WHERE status <> 'dismissed'`;
  return groupMembersById(rows.map(toMergeEntity));
}

export async function loadEntityFacts(sql: Sql, ids: string[], now: Date): Promise<Map<string, EntityFacts>> {
  validateIds(ids);
  if (ids.length === 0) {
    return new Map();
  }
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const membersById = await loadMergeMembers(sql);
  const expanded = [...new Set(ids.flatMap((id) => membersOf(id, membersById)))];
  const entityRows = await sql`
    SELECT id, status, first_seen_at, last_seen_at
    FROM entities WHERE id = ANY(${expanded}::bigint[])`;
  const hourlyRows = await sql`
    SELECT entity_id, bucket, mentions
    FROM entity_mentions_hourly
    WHERE entity_id = ANY(${expanded}::bigint[]) AND bucket >= ${since}::timestamptz`;
  const sourceRows = await sql`
    SELECT ae.entity_id, a.source_name, COUNT(*) AS article_count
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE ae.entity_id = ANY(${expanded}::bigint[]) AND a.first_seen_at >= ${since}::timestamptz
    GROUP BY ae.entity_id, a.source_name`;
  return assembleEntityFacts(entityRows, hourlyRows, sourceRows, now, membersById, ids);
}
