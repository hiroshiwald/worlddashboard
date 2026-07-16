import sourcesData from "@/lib/sources-data.json";
import { fetchAllFeeds, CacheEntry } from "@/lib/feed-fetcher";
import { SourceMeta } from "@/lib/types";
import { getSql, Sql } from "@/lib/server/db";
import { persistArticles, sweepRetention } from "@/lib/server/ingest-writer";
import { processNewArticles } from "@/lib/server/entity-ingest";
import { getSettings } from "@/lib/server/settings";
import { runDetectors, computeWarmupState, WarmupState } from "@/lib/server/detectors";
import { persistSignals } from "@/lib/server/signal-store";

const ingestCache = new Map<string, CacheEntry>();

function loadSources(): SourceMeta[] {
  return sourcesData.map((s) => ({
    name: s.name,
    category: s.category,
    tier: s.tier,
    url: s.url,
    type: s.type,
    altUrl: (s as Record<string, unknown>).altUrl as string | undefined,
  }));
}

class IngestStageError extends Error {
  constructor(public readonly stage: string, public readonly cause: unknown) {
    super(`Ingest stage "${stage}" failed`);
  }
}

async function runStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new IngestStageError(stage, err);
  }
}

// Duplicated from detectors.ts's private getSystemEpoch (deliberately not
// exported, to keep this module decoupled from detector internals) — the
// same system epoch anchors both.
async function getSystemEpoch(sql: Sql): Promise<Date | null> {
  const rows = await sql`SELECT MIN(first_seen_at) AS min_first_seen FROM articles`;
  const value = rows[0]?.min_first_seen;
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value as string);
}

async function getIngestWarmupState(sql: Sql): Promise<WarmupState> {
  const [settings, epoch] = await Promise.all([getSettings(sql), getSystemEpoch(sql)]);
  return computeWarmupState(epoch, settings.warmup_days, new Date());
}

export interface IngestResult {
  status: number;
  body: Record<string, unknown>;
}

// Every stage is wrapped so a mid-pipeline throw is attributable: the
// result names which stage failed and includes whatever counts prior
// stages already produced, instead of a generic failure that can't
// distinguish a feed-fetch outage from an entity-step bug. Callers (both
// /api/ingest and /api/tick) turn this into a NextResponse themselves, so
// this stays a plain data result rather than importing next/server.
export async function runIngest(): Promise<IngestResult> {
  const start = Date.now();
  const counts: Record<string, unknown> = {};

  try {
    const { items, feedsAttempted, feedsSucceeded } = await runStage("fetch-feeds", () =>
      fetchAllFeeds(loadSources(), ingestCache),
    );
    counts.feedsSucceeded = feedsSucceeded;
    counts.feedsAttempted = feedsAttempted;

    const sql = getSql();
    const { inserted, duplicates } = await runStage("persist-articles", () => persistArticles(sql, items));
    counts.inserted = inserted;
    counts.duplicates = duplicates;

    await runStage("sweep-retention", () => sweepRetention(sql));
    const entityStats = await runStage("process-entities", () => processNewArticles(sql));
    counts.entities = entityStats;
    counts.llm = entityStats.llm;
    counts.signals = await runStage("detect-signals", async () => {
      const settings = await getSettings(sql);
      const candidates = await runDetectors(sql, settings);
      return persistSignals(sql, candidates, settings);
    });
    counts.warmup = await runStage("compute-warmup", () => getIngestWarmupState(sql));

    return { status: 200, body: { ...counts, tookMs: Date.now() - start } };
  } catch (err) {
    const stage = err instanceof IngestStageError ? err.stage : "unknown";
    const cause = err instanceof IngestStageError ? err.cause : err;
    console.error(`[ingest] stage "${stage}" failed`, cause);
    return { status: 500, body: { error: "Ingest failed", stage, ...counts } };
  }
}
