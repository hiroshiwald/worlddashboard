import type { Sql } from "./db";

// Short enough that an open, visible dashboard keeps itself fresh on its
// own — useSources.ts checks on load, on visibilitychange, and on an
// interval while the tab is visible. This is attention-driven upkeep, not
// a cron replacement: the lock threshold below is still the real ceiling
// on how often an ingest run can actually start.
export const FRESHNESS_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
export const LOCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// An explicit user click (?manual=1 on /api/tick) uses the lock window
// itself as its freshness threshold, not the 15min passive one — so a click
// almost always triggers a real collection attempt. This is safe because
// the lock, not the freshness check, is the actual abuse ceiling: at most
// one ingest run can start per LOCK_THRESHOLD_MS no matter which threshold
// let it past the freshness gate. Extra attempts are cheap too —
// persistArticles dedupes by content hash, so a run that finds nothing new
// does no entity/LLM work.
export const MANUAL_FRESHNESS_THRESHOLD_MS = LOCK_THRESHOLD_MS;

/** True when `timestamp` is younger than `thresholdMs` relative to `now`.
 * `null` (no data yet) is never recent. Shared by the freshness check (is
 * ingest data stale?) and the lock check (is another tick still running?) —
 * same boundary math, different threshold. */
export function isRecent(timestamp: Date | null, now: Date, thresholdMs: number): boolean {
  if (timestamp === null) return false;
  return now.getTime() - timestamp.getTime() < thresholdMs;
}

/** Which freshness threshold governs a tick request: the 10-minute manual
 * window for an explicit user click, or the 15-minute passive window that
 * keeps an open, visible dashboard fresh on its own. */
export function selectFreshnessThreshold(manual: boolean): number {
  return manual ? MANUAL_FRESHNESS_THRESHOLD_MS : FRESHNESS_THRESHOLD_MS;
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
