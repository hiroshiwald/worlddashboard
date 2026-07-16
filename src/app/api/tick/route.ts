import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import { runIngest } from "@/lib/server/run-ingest";
import { getLastIngestAt, isRecent, tryAcquireLock, selectFreshnessThreshold } from "@/lib/server/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Unauthenticated by design (see DEVLOG): this route reads nothing from the
// request except one optional query flag, `?manual=1` — no body, and any
// other value or param is ignored (treated as the same passive default as
// no query at all). The freshness check and the anti-stampede lock make
// every call idempotent and self-rate-limiting regardless of who calls it.
function isManualRequest(req: NextRequest): boolean {
  return new URL(req.url).searchParams.get("manual") === "1";
}

async function tick(manual: boolean): Promise<NextResponse> {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const sql = getSql();
  const lastIngestAt = await getLastIngestAt(sql);
  const freshnessThresholdMs = selectFreshnessThreshold(manual);
  if (isRecent(lastIngestAt, new Date(), freshnessThresholdMs)) {
    return NextResponse.json({ triggered: false, reason: "fresh" });
  }

  const wonLock = await tryAcquireLock(sql);
  if (!wonLock) {
    return NextResponse.json({ triggered: false, reason: "locked" });
  }

  const result = await runIngest();
  return NextResponse.json({ triggered: true, ...result.body }, { status: result.status });
}

export async function POST(req: NextRequest) {
  return tick(isManualRequest(req));
}

export async function GET(req: NextRequest) {
  return tick(isManualRequest(req));
}
