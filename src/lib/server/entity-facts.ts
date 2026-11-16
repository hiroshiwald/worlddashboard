import { buildCoverage, computeGrowth, diversity, type DiversityLabel, type GrowthState, type HourlyCount } from "../entity-growth";
import type { Sql, SqlRow } from "./db";

export interface EntityFacts {
  id: string;
  mentions14d: number;
  recent72h: number;
  usualPerDay: number;
  ratio: number;
  baselineDays: number;
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

function assembleOne(entity: SqlRow, hourlyRows: SqlRow[], sourceRows: SqlRow[], coverage: number[], now: Date): EntityFacts {
  const firstSeen = toDate(entity.first_seen_at, "first_seen_at");
  const hourly: HourlyCount[] = hourlyRows.map((row) => ({
    hourStart: toDate(row.bucket, "bucket"),
    count: Number(row.mentions),
  }));
  const growth = computeGrowth({ hourly, coverage, firstSeenAt: firstSeen, tracked: entity.status === "tracked", now });
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
 * (one row per entity+source, so article_count sums to distinct articles);
 * totalRows {bucket,collected_mentions}: mentions of all entities per hour (collection volume). */
export function assembleEntityFacts(
  entityRows: SqlRow[],
  hourlyRows: SqlRow[],
  sourceRows: SqlRow[],
  totalRows: SqlRow[],
  now: Date,
): Map<string, EntityFacts> {
  const totals = totalRows.map((row) => ({ hourStart: toDate(row.bucket, "total bucket"), count: Number(row.collected_mentions) }));
  const coverage = buildCoverage(totals, now);
  const hourlyById = groupBy(hourlyRows, "entity_id");
  const sourcesById = groupBy(sourceRows, "entity_id");
  const facts = new Map<string, EntityFacts>();
  for (const entity of entityRows) {
    const id = String(entity.id);
    facts.set(id, assembleOne(entity, hourlyById.get(id) ?? [], sourcesById.get(id) ?? [], coverage, now));
  }
  return facts;
}

export async function loadEntityFacts(sql: Sql, ids: string[], now: Date): Promise<Map<string, EntityFacts>> {
  validateIds(ids);
  if (ids.length === 0) {
    return new Map();
  }
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const entityRows = await sql`
    SELECT id, status, first_seen_at, last_seen_at
    FROM entities WHERE id = ANY(${ids}::bigint[])`;
  const hourlyRows = await sql`
    SELECT entity_id, bucket, mentions
    FROM entity_mentions_hourly
    WHERE entity_id = ANY(${ids}::bigint[]) AND bucket >= ${since}::timestamptz`;
  const sourceRows = await sql`
    SELECT ae.entity_id, a.source_name, COUNT(*) AS article_count
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE ae.entity_id = ANY(${ids}::bigint[]) AND a.first_seen_at >= ${since}::timestamptz
    GROUP BY ae.entity_id, a.source_name`;
  const totalRows = await sql`
    SELECT bucket, SUM(mentions) AS collected_mentions FROM entity_mentions_hourly
    WHERE bucket >= ${since}::timestamptz GROUP BY bucket`;
  return assembleEntityFacts(entityRows, hourlyRows, sourceRows, totalRows, now);
}
