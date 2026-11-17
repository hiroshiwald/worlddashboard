import type { Sql, SqlRow } from "./db";
import { estimateCostUsd, MAX_BATCH_SIZE } from "./llm-extract";

// ONE-OFF: November catch-up so articles first seen in this window get the
// LLM pass (entities, topic, title_en) that the paused ingest never gave them.
// DELETE this file, its call sites in entity-ingest.ts, and
// src/app/api/backfill once GET /api/backfill reports remaining = 0.
export const BACKFILL_FROM = "2026-11-01T00:00:00Z";
export const BACKFILL_TO = "2026-11-17T00:00:00Z";
// 16 chunks of MAX_BATCH_SIZE per run: bounded spend and submit time.
export const BACKFILL_MAX_PER_RUN = MAX_BATCH_SIZE * 16;

// Per-article token assumption for the estimate (batch pricing): ~300 input
// (title + 300-char summary ~100, plus the system prompt and topic labels
// amortised over a 25-article chunk) and ~200 output (entities, relations,
// topic, title_en JSON).
export const BACKFILL_INPUT_TOKENS_PER_ARTICLE = 300;
export const BACKFILL_OUTPUT_TOKENS_PER_ARTICLE = 200;

export function estimateBackfillUsd(articles: number): number {
  return estimateCostUsd(0, 0, articles * BACKFILL_INPUT_TOKENS_PER_ARTICLE, articles * BACKFILL_OUTPUT_TOKENS_PER_ARTICLE);
}

/** Oldest-first cluster heads in the window still lacking a topic. */
export async function selectBackfillRows(sql: Sql, limit: number, excludeIds: number[]): Promise<SqlRow[]> {
  if (limit <= 0) return [];
  return sql`
    SELECT bf.id, bf.title, bf.summary, bf.published_at, bf.first_seen_at, bf.source_name, bf.entities_processed_at
    FROM articles bf
    WHERE bf.dup_group_id IS NULL
      AND bf.topic IS NULL
      AND bf.first_seen_at >= ${BACKFILL_FROM}::timestamptz
      AND bf.first_seen_at < ${BACKFILL_TO}::timestamptz
      AND NOT (bf.id = ANY(${excludeIds}::bigint[]))
    ORDER BY bf.first_seen_at ASC, bf.id ASC
    LIMIT ${limit}::int
  `;
}

/** Heads in the window still lacking a topic (includes batches in flight). */
export async function countBackfillRemaining(sql: Sql): Promise<number> {
  const rows = await sql`
    SELECT count(*) AS remaining_heads
    FROM articles bfc
    WHERE bfc.dup_group_id IS NULL
      AND bfc.topic IS NULL
      AND bfc.first_seen_at >= ${BACKFILL_FROM}::timestamptz
      AND bfc.first_seen_at < ${BACKFILL_TO}::timestamptz
  `;
  return Number(rows[0].remaining_heads);
}

export async function getBackfillStatus(sql: Sql): Promise<{ remaining: number; estimatedUsd: number }> {
  const remaining = await countBackfillRemaining(sql);
  return { remaining, estimatedUsd: estimateBackfillUsd(remaining) };
}
