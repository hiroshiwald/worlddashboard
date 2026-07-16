import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import type { Sql, SqlRow } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const RECENT_ARTICLES_LIMIT = 20;
const TOP_EDGES_LIMIT = 10;
const SERIES_WINDOW_DAYS = 7;

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value as string).toISOString();
}

function toEntityJson(row: SqlRow) {
  return {
    id: Number(row.id),
    canonicalName: String(row.canonical_name),
    type: String(row.type),
    status: String(row.status),
    firstSeenAt: toIsoString(row.first_seen_at),
    lastSeenAt: row.last_seen_at != null ? toIsoString(row.last_seen_at) : null,
  };
}

async function loadHourlySeries(sql: Sql, id: number) {
  const rows = await sql`
    SELECT bucket, mentions, source_count, sentiment_sum
    FROM entity_mentions_hourly
    WHERE entity_id = ${id}
      AND bucket >= now() - make_interval(days => ${SERIES_WINDOW_DAYS}::int)
    ORDER BY bucket ASC
  `;
  return rows.map((row) => ({
    bucket: toIsoString(row.bucket),
    mentions: Number(row.mentions),
    sourceCount: Number(row.source_count),
    sentimentSum: Number(row.sentiment_sum),
  }));
}

async function loadRecentArticles(sql: Sql, id: number) {
  const rows = await sql`
    SELECT a.id, a.title, a.link, a.source_name, a.published_at, a.first_seen_at
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE ae.entity_id = ${id} AND a.dup_group_id IS NULL
    ORDER BY COALESCE(a.published_at, a.first_seen_at) DESC
    LIMIT ${RECENT_ARTICLES_LIMIT}
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    title: String(row.title),
    link: String(row.link),
    sourceName: String(row.source_name),
    published: toIsoString(row.published_at ?? row.first_seen_at),
  }));
}

function toRelationJson(row: SqlRow) {
  return {
    relation: String(row.relation),
    id: Number(row.other_id),
    name: String(row.other_name),
    articleCount: Number(row.article_count),
    lastSeenAt: toIsoString(row.last_seen_at),
  };
}

async function loadOutgoingRelations(sql: Sql, id: number) {
  const rows = await sql`
    SELECT er.relation, er.target_id AS other_id, e.canonical_name AS other_name, er.article_count, er.last_seen_at
    FROM entity_relations er
    JOIN entities e ON e.id = er.target_id
    WHERE er.source_id = ${id}
    ORDER BY er.article_count DESC
  `;
  return rows.map(toRelationJson);
}

async function loadIncomingRelations(sql: Sql, id: number) {
  const rows = await sql`
    SELECT er.relation, er.source_id AS other_id, e.canonical_name AS other_name, er.article_count, er.last_seen_at
    FROM entity_relations er
    JOIN entities e ON e.id = er.source_id
    WHERE er.target_id = ${id}
    ORDER BY er.article_count DESC
  `;
  return rows.map(toRelationJson);
}

async function loadTopEdges(sql: Sql, id: number) {
  const rows = await sql`
    SELECT
      CASE WHEN ee.entity_a = ${id} THEN ee.entity_b ELSE ee.entity_a END AS other_id,
      e.canonical_name AS other_name,
      ee.article_count
    FROM entity_edges ee
    JOIN entities e ON e.id = CASE WHEN ee.entity_a = ${id} THEN ee.entity_b ELSE ee.entity_a END
    WHERE ee.entity_a = ${id} OR ee.entity_b = ${id}
    ORDER BY ee.article_count DESC
    LIMIT ${TOP_EDGES_LIMIT}
  `;
  return rows.map((row) => ({
    id: Number(row.other_id),
    name: String(row.other_name),
    articleCount: Number(row.article_count),
  }));
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid entity id" }, { status: 400 });
  }

  const sql = getSql();
  const entityRows = await sql`
    SELECT id, canonical_name, type, status, first_seen_at, last_seen_at
    FROM entities WHERE id = ${id}
  `;
  if (entityRows.length === 0) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  const [series, articles, edges, outgoing, incoming] = await Promise.all([
    loadHourlySeries(sql, id),
    loadRecentArticles(sql, id),
    loadTopEdges(sql, id),
    loadOutgoingRelations(sql, id),
    loadIncomingRelations(sql, id),
  ]);

  return NextResponse.json({
    entity: toEntityJson(entityRows[0]),
    series,
    articles,
    edges,
    relations: { incoming, outgoing },
  });
}
