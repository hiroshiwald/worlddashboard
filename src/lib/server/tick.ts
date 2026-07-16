import type { Sql } from "./db";

export const FRESHNESS_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
export const LOCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/** True when `timestamp` is younger than `thresholdMs` relative to `now`.
 * `null` (no data yet) is never recent. Shared by the freshness check (is
 * ingest data stale?) and the lock check (is another tick still running?) —
 * same boundary math, different threshold. */
export function isRecent(timestamp: Date | null, now: Date, thresholdMs: number): boolean {
  if (timestamp === null) return false;
  return now.getTime() - timestamp.getTime() < thresholdMs;
}

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value as string);
}

/** MAX(first_seen_at) across all articles, or null if none exist yet. */
export async function getLastIngestAt(sql: Sql): Promise<Date | null> {
  const rows = await sql`SELECT MAX(first_seen_at) AS last_ingest_at FROM articles`;
  return toDate(rows[0]?.last_ingest_at);
}

// LOCK_THRESHOLD_MS is always a whole number of minutes (10) — asserted via
// the exact-division test in tick.test.ts so this can't silently drift into
// a fractional interval.
const LOCK_THRESHOLD_MINUTES = LOCK_THRESHOLD_MS / 60_000;

/** Atomically claims the anti-stampede lock: inserts the 'tick_lock' row if
 * absent, or overwrites it only if the stored timestamp is at least
 * LOCK_THRESHOLD_MS old. The DO UPDATE...WHERE clause is the sole arbiter
 * under concurrent callers — Postgres evaluates it per-row after lock
 * contention resolves, so exactly one concurrent caller ever gets a row
 * back. Returns true for that one winner, false for every other caller. */
export async function tryAcquireLock(sql: Sql): Promise<boolean> {
  const rows = await sql`
    INSERT INTO settings (key, value)
    VALUES ('tick_lock', to_jsonb(now()))
    ON CONFLICT (key) DO UPDATE
      SET value = to_jsonb(now())
      WHERE (settings.value #>> '{}')::timestamptz <= now() - make_interval(mins => ${LOCK_THRESHOLD_MINUTES}::int)
    RETURNING key
  `;
  return rows.length > 0;
}
