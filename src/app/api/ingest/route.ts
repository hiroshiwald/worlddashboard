import { NextRequest, NextResponse } from "next/server";
import sourcesData from "@/lib/sources-data.json";
import { fetchAllFeeds, CacheEntry } from "@/lib/feed-fetcher";
import { SourceMeta } from "@/lib/types";
import { getSql } from "@/lib/server/db";
import { persistArticles, sweepRetention } from "@/lib/server/ingest-writer";
import { processNewArticles } from "@/lib/server/entity-ingest";
import { getSettings } from "@/lib/server/settings";
import { runDetectors } from "@/lib/server/detectors";
import { persistSignals } from "@/lib/server/signal-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

// Accepts either the direct ingest key or Vercel's Authorization: Bearer
// CRON_SECRET convention (Vercel cron requests can't set custom headers).
function isAuthorized(req: NextRequest): boolean {
  const ingestKey = req.headers.get("x-ingest-key");
  if (ingestKey && ingestKey === process.env.INGEST_SECRET) return true;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;
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

// Every stage is wrapped so a mid-pipeline throw is attributable: the
// response names which stage failed and includes whatever counts prior
// stages already produced, instead of a generic 500 that can't distinguish
// a feed-fetch outage from an entity-step bug.
async function runIngest() {
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
    counts.entities = await runStage("process-entities", () => processNewArticles(sql));
    counts.signals = await runStage("detect-signals", async () => {
      const settings = await getSettings(sql);
      const candidates = await runDetectors(sql, settings);
      return persistSignals(sql, candidates, settings);
    });

    return NextResponse.json({ ...counts, tookMs: Date.now() - start });
  } catch (err) {
    const stage = err instanceof IngestStageError ? err.stage : "unknown";
    const cause = err instanceof IngestStageError ? err.cause : err;
    console.error(`[ingest] stage "${stage}" failed`, cause);
    return NextResponse.json({ error: "Ingest failed", stage, ...counts }, { status: 500 });
  }
}

function checkAccess(req: NextRequest): NextResponse | null {
  if (!process.env.INGEST_SECRET) {
    return NextResponse.json(
      { error: "INGEST_SECRET is not configured" },
      { status: 500 },
    );
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const denied = checkAccess(req);
  if (denied) return denied;
  return runIngest();
}

// Vercel Cron Jobs always trigger via GET, so vercel.json's daily fallback
// cron needs a GET handler too, authorized via the CRON_SECRET bearer path.
export async function GET(req: NextRequest) {
  const denied = checkAccess(req);
  if (denied) return denied;
  return runIngest();
}
