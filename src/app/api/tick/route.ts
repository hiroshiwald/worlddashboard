import { NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import { runIngest } from "@/lib/server/run-ingest";
import { getLastIngestAt, isRecent, tryAcquireLock, FRESHNESS_THRESHOLD_MS } from "@/lib/server/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Unauthenticated by design (see DEVLOG): this route takes no request body
// or query params — POST/GET below accept no `req` at all — and can only
// ever do what the hourly cron already does. The freshness check and the
// anti-stampede lock make every call idempotent and self-rate-limiting.
async function tick(): Promise<NextResponse> {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const sql = getSql();
  const lastIngestAt = await getLastIngestAt(sql);
  if (isRecent(lastIngestAt, new Date(), FRESHNESS_THRESHOLD_MS)) {
    return NextResponse.json({ triggered: false, reason: "fresh" });
  }

  const wonLock = await tryAcquireLock(sql);
  if (!wonLock) {
    return NextResponse.json({ triggered: false, reason: "locked" });
  }

  const result = await runIngest();
  return NextResponse.json({ triggered: true, ...result.body }, { status: result.status });
}

export async function POST() {
  return tick();
}

export async function GET() {
  return tick();
}
