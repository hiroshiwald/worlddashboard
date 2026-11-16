import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import type { Sql } from "@/lib/server/db";
import { getSettings } from "@/lib/server/settings";
import { computeWarmupState } from "@/lib/server/detectors";
import { getDevelopmentsDetailed } from "@/lib/server/developments";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const CACHE_HEADERS = { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" };

// The platform's operating epoch (earliest article ARRIVAL ever recorded) —
// duplicated from detectors.ts's private getSystemEpoch rather than
// exported from there, keeping this route decoupled from detector
// internals. Same precedent as brief.ts and /api/signals, both of which
// duplicate this exact tiny query for the same reason.
async function getSystemEpoch(sql: Sql): Promise<Date | null> {
  const rows = await sql`SELECT MIN(first_seen_at) AS min_first_seen FROM articles`;
  const value = rows[0]?.min_first_seen;
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value as string);
}

/** null (absent) param -> the default; anything else must be a whole number
 * within [MIN_LIMIT, MAX_LIMIT] or the request is rejected outright — no
 * silent clamping of an out-of-range or malformed value. */
function parseLimit(param: string | null): number | null {
  if (param === null) return DEFAULT_LIMIT;
  const value = Number(param);
  if (!Number.isInteger(value) || value < MIN_LIMIT || value > MAX_LIMIT) return null;
  return value;
}

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const limit = parseLimit(new URL(req.url).searchParams.get("limit"));
  if (limit === null) return NextResponse.json({ error: "Invalid limit parameter" }, { status: 400 });

  const sql = getSql();
  const now = new Date();
  const [settings, epoch] = await Promise.all([getSettings(sql), getSystemEpoch(sql)]);
  const warmup = computeWarmupState(epoch, settings.warmup_days, now);

  // Mirrors brief.ts's warmup gating: nothing history-dependent runs while
  // the system hasn't accumulated a real operating history yet.
  if (warmup.active) {
    return NextResponse.json(
      { developments: [], diagnostics: null, warmup, generatedAt: now.toISOString() },
      { headers: CACHE_HEADERS },
    );
  }

  const { cards, diagnostics } = await getDevelopmentsDetailed(sql, now, { cap: limit });
  return NextResponse.json(
    { developments: cards, diagnostics, warmup, generatedAt: now.toISOString() },
    { headers: CACHE_HEADERS },
  );
}
