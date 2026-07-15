import type { FeedItem } from "../types";
import { titleSignature } from "../story-cluster";
import { contentHash } from "./article-identity";
import type { Sql, SqlRow } from "./db";

const INSERT_BATCH_SIZE = 200;

interface ArticleRow {
  contentHash: string;
  titleSignature: string;
  title: string;
  link: string;
  publishedAt: string;
  sourceName: string;
  sourceCategory: string;
  sourceTier: string;
  summary: string;
  imageUrl: string;
}

interface InsertedArticle {
  id: string;
  titleSignature: string;
  firstSeenAt: string;
}

function toArticleRow(item: FeedItem): ArticleRow {
  return {
    contentHash: contentHash(item.title, item.link),
    titleSignature: titleSignature(item.title),
    title: item.title,
    link: item.link,
    // TODO: feed-fetcher stamps dateless items with new Date().toISOString()
    // at parse time (both RSS and Atom parsers), so a real published date
    // and a fallback stamp are indistinguishable here. Store as given;
    // proper dateless detection lands with extraction v2.
    publishedAt: item.published,
    sourceName: item.sourceName,
    sourceCategory: item.sourceCategory,
    sourceTier: item.sourceTier,
    summary: item.summary,
    imageUrl: item.imageUrl,
  };
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new Error(`ingest-writer: expected a date-like value, got ${JSON.stringify(value)}`);
}

function parseInsertedRow(row: SqlRow): InsertedArticle {
  const { id, title_signature: signature, first_seen_at: firstSeenAt } = row;
  if (typeof id !== "string" && typeof id !== "number") {
    throw new Error(`persistArticles: malformed inserted row, missing id: ${JSON.stringify(row)}`);
  }
  if (typeof signature !== "string") {
    throw new Error(`persistArticles: malformed inserted row, missing title_signature: ${JSON.stringify(row)}`);
  }
  return { id: String(id), titleSignature: signature, firstSeenAt: toIsoString(firstSeenAt) };
}

async function insertBatch(sql: Sql, items: FeedItem[]): Promise<InsertedArticle[]> {
  const rows = items.map(toArticleRow);
  const result = await sql`
    INSERT INTO articles (
      content_hash, title_signature, title, link, published_at,
      source_name, source_category, source_tier, summary, image_url
    )
    SELECT * FROM UNNEST(
      ${rows.map((r) => r.contentHash)}::text[],
      ${rows.map((r) => r.titleSignature)}::text[],
      ${rows.map((r) => r.title)}::text[],
      ${rows.map((r) => r.link)}::text[],
      ${rows.map((r) => r.publishedAt)}::timestamptz[],
      ${rows.map((r) => r.sourceName)}::text[],
      ${rows.map((r) => r.sourceCategory)}::text[],
      ${rows.map((r) => r.sourceTier)}::text[],
      ${rows.map((r) => r.summary)}::text[],
      ${rows.map((r) => r.imageUrl)}::text[]
    )
    ON CONFLICT (content_hash) DO NOTHING
    RETURNING id, title_signature, first_seen_at
  `;
  return result.map(parseInsertedRow);
}

/** Links a newly inserted article to the earliest article sharing its
 * title_signature within a 48h window, if one exists and isn't itself. */
async function assignDupGroup(sql: Sql, article: InsertedArticle): Promise<void> {
  const rows = await sql`
    SELECT id FROM articles
    WHERE title_signature = ${article.titleSignature}
      AND first_seen_at <= ${article.firstSeenAt}::timestamptz
      AND first_seen_at >= ${article.firstSeenAt}::timestamptz - INTERVAL '48 hours'
    ORDER BY first_seen_at ASC, id ASC
    LIMIT 1
  `;
  const head = rows[0];
  if (!head) return;
  const headId = String(head.id);
  if (headId === article.id) return;
  await sql`UPDATE articles SET dup_group_id = ${headId}::bigint WHERE id = ${article.id}::bigint`;
}

export async function persistArticles(
  sql: Sql,
  items: FeedItem[],
): Promise<{ inserted: number; duplicates: number }> {
  if (items.length === 0) return { inserted: 0, duplicates: 0 };

  const insertedRows: InsertedArticle[] = [];
  for (let offset = 0; offset < items.length; offset += INSERT_BATCH_SIZE) {
    const batch = items.slice(offset, offset + INSERT_BATCH_SIZE);
    insertedRows.push(...(await insertBatch(sql, batch)));
  }

  // Sequential, oldest-first: an earlier article in this same batch must
  // already be linked before a later one checks for a head to attach to.
  const oldestFirst = [...insertedRows].sort(
    (a, b) => new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime(),
  );
  for (const article of oldestFirst) {
    await assignDupGroup(sql, article);
  }

  return { inserted: insertedRows.length, duplicates: items.length - insertedRows.length };
}

export async function sweepRetention(sql: Sql): Promise<void> {
  await sql`DELETE FROM articles WHERE first_seen_at < now() - INTERVAL '30 days'`;
  await sql`DELETE FROM entity_mentions_hourly WHERE bucket < now() - INTERVAL '180 days'`;
  await sql`DELETE FROM signals WHERE state = 'dismissed' AND state_changed_at < now() - INTERVAL '90 days'`;
  await sql`DELETE FROM entity_candidates WHERE last_seen_at < now() - INTERVAL '14 days'`;
}
