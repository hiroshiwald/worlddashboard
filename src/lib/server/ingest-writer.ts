import type { FeedItem } from "../types";
import { titleSignature } from "../story-cluster";
import { contentHash } from "./article-identity";
import type { Sql } from "./db";

const INSERT_BATCH_SIZE = 200;

interface ArticleRow {
  contentHash: string;
  titleSignature: string;
  title: string;
  link: string;
  publishedAt: string | null;
  sourceName: string;
  sourceCategory: string;
  sourceTier: string;
  summary: string;
  imageUrl: string;
}

function toArticleRow(item: FeedItem): ArticleRow {
  return {
    contentHash: contentHash(item.title, item.link),
    titleSignature: titleSignature(item.title),
    title: item.title,
    link: item.link,
    publishedAt: item.publishedEstimated ? null : item.published,
    sourceName: item.sourceName,
    sourceCategory: item.sourceCategory,
    sourceTier: item.sourceTier,
    summary: item.summary,
    imageUrl: item.imageUrl,
  };
}

async function insertBatch(sql: Sql, items: FeedItem[]): Promise<number> {
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
    RETURNING id
  `;
  return result.length;
}

/** Links every ungrouped article from the last 48h to the earliest actual
 * head sharing its title_signature within the 48h window before it (ties
 * broken by lowest id); heads keep dup_group_id NULL. Only attaches to a
 * row that is itself a head (dup_group_id IS NULL) — otherwise recurring
 * same-signature headlines would chain member-to-member indefinitely, and
 * once a head ages out of the window, its most recent same-signature
 * article becomes the new head instead of staying hidden. One set-based
 * UPDATE, run after all insert batches; the CTE reads a pre-update
 * snapshot, so same-run grouping of a fresh batch still works, and it
 * self-heals rows an earlier partial ingest left ungrouped. */
async function assignDupGroups(sql: Sql): Promise<void> {
  await sql`
    WITH heads AS (
      SELECT DISTINCT ON (a.id)
        a.id AS article_id,
        h.id AS head_id
      FROM articles a
      JOIN articles h
        ON h.title_signature = a.title_signature
       AND h.first_seen_at <= a.first_seen_at
       AND h.first_seen_at >= a.first_seen_at - INTERVAL '48 hours'
       AND h.dup_group_id IS NULL
      WHERE a.first_seen_at >= now() - INTERVAL '48 hours'
        AND a.dup_group_id IS NULL
      ORDER BY a.id, h.first_seen_at ASC, h.id ASC
    )
    UPDATE articles
    SET dup_group_id = heads.head_id
    FROM heads
    WHERE articles.id = heads.article_id
      AND heads.head_id <> heads.article_id
  `;
}

export async function persistArticles(
  sql: Sql,
  items: FeedItem[],
): Promise<{ inserted: number; duplicates: number }> {
  if (items.length === 0) return { inserted: 0, duplicates: 0 };

  let inserted = 0;
  for (let offset = 0; offset < items.length; offset += INSERT_BATCH_SIZE) {
    const batch = items.slice(offset, offset + INSERT_BATCH_SIZE);
    inserted += await insertBatch(sql, batch);
  }

  await assignDupGroups(sql);

  return { inserted, duplicates: items.length - inserted };
}

export async function sweepRetention(sql: Sql): Promise<void> {
  await sql`DELETE FROM articles WHERE first_seen_at < now() - INTERVAL '30 days'`;
  await sql`DELETE FROM entity_mentions_hourly WHERE bucket < now() - INTERVAL '180 days'`;
  await sql`DELETE FROM signals WHERE state = 'dismissed' AND state_changed_at < now() - INTERVAL '90 days'`;
  await sql`DELETE FROM entity_candidates WHERE last_seen_at < now() - INTERVAL '14 days'`;
}
