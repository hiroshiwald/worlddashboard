import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import type { Sql, SqlRow } from "@/lib/server/db";
import type { FeedItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
const MAX_ITEMS = 500;

function parseDays(raw: string | null): number {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DAYS;
  return Math.min(Math.floor(parsed), MAX_DAYS);
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value as string).toISOString();
}

function toFeedItem(row: SqlRow): FeedItem {
  return {
    id: String(row.id),
    title: String(row.title),
    link: String(row.link),
    published: toIsoString(row.published_at ?? row.first_seen_at),
    summary: row.summary != null ? String(row.summary) : "",
    sourceName: String(row.source_name),
    sourceCategory: String(row.source_category),
    sourceTier: String(row.source_tier),
    imageUrl: row.image_url != null ? String(row.image_url) : "",
  };
}

async function queryClusterHeads(
  sql: Sql,
  days: number,
  category: string | null,
): Promise<FeedItem[]> {
  const rows = category
    ? await sql`SELECT id, title, link, published_at, first_seen_at,
        source_name, source_category, source_tier, summary, image_url
        FROM articles
        WHERE dup_group_id IS NULL
          AND first_seen_at >= now() - make_interval(days => ${days}::int)
          AND source_category = ${category}
        ORDER BY COALESCE(published_at, first_seen_at) DESC
        LIMIT ${MAX_ITEMS}`
    : await sql`SELECT id, title, link, published_at, first_seen_at,
        source_name, source_category, source_tier, summary, image_url
        FROM articles
        WHERE dup_group_id IS NULL
          AND first_seen_at >= now() - make_interval(days => ${days}::int)
        ORDER BY COALESCE(published_at, first_seen_at) DESC
        LIMIT ${MAX_ITEMS}`;
  return rows.map(toFeedItem);
}

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const sql = getSql();
  const summaryRows = await sql`SELECT COUNT(*)::int AS count, MAX(first_seen_at) AS last_ingest_at FROM articles`;
  const totalCount = Number(summaryRows[0]?.count ?? 0);
  if (totalCount === 0) {
    return NextResponse.json({ error: "No articles ingested yet" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const days = parseDays(searchParams.get("days"));
  const category = searchParams.get("category");
  const items = await queryClusterHeads(sql, days, category);
  const lastIngestAtRaw = summaryRows[0]?.last_ingest_at;

  return NextResponse.json({
    items,
    lastIngestAt: lastIngestAtRaw ? toIsoString(lastIngestAtRaw) : null,
    count: items.length,
  });
}
