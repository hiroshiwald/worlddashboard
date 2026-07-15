import { NextRequest, NextResponse } from "next/server";
import sourcesData from "@/lib/sources-data.json";
import { fetchAllFeeds, CacheEntry } from "@/lib/feed-fetcher";
import { SourceMeta } from "@/lib/types";
import { getSql } from "@/lib/server/db";
import { persistArticles, sweepRetention } from "@/lib/server/ingest-writer";

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

async function runIngest() {
  const start = Date.now();
  const { items, feedsAttempted, feedsSucceeded } = await fetchAllFeeds(
    loadSources(),
    ingestCache,
  );

  const sql = getSql();
  const { inserted, duplicates } = await persistArticles(sql, items);
  await sweepRetention(sql);

  return NextResponse.json({
    inserted,
    duplicates,
    feedsSucceeded,
    feedsAttempted,
    tookMs: Date.now() - start,
  });
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
