// Pure formatters: activity counts and relative-time strings for the
// tracked table's Activity/Last seen columns, EntityPanel's 30-day summary
// and edge since-dates, and the review queue's reported-window wording.

import { timeAgo } from "@/lib/date-utils";

const NEW_EDGE_WINDOW_DAYS = 7;

/** Table Activity (7d) column — an honest zero renders as "0 · 0 src", not
 * a blank cell (DESIGN.md spine #4). */
export function formatActivity7d(mentions: number, sources: number): string {
  return `${mentions} · ${sources} src`;
}

/** EntityPanel's 30-day activity summary line, next to the (7-day)
 * sparkline — the two windows are labeled so they can't be confused. */
export function formatActivity30d(mentions: number, sources: number): string {
  return `${mentions} mentions · ${sources} sources · last 30 days`;
}

/** Table Last seen column — "—" for an entity with no recorded mention yet,
 * never a blank cell. */
export function formatLastSeen(lastSeenAt: string | null): string {
  return lastSeenAt ? timeAgo(lastSeenAt) : "—";
}

/** "since {short date}" for a Related-entities edge chip. */
export function formatSinceDate(firstSeenAt: string): string {
  const short = new Date(firstSeenAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `since ${short}`;
}

/** Whether an edge's first co-occurrence falls within the trailing 7 days —
 * the "new" marker. `now` is injectable so this stays pure/testable rather
 * than reading the clock itself. */
export function isNewEdge(firstSeenAt: string, now: Date = new Date()): boolean {
  const ageMs = now.getTime() - new Date(firstSeenAt).getTime();
  return ageMs >= 0 && ageMs <= NEW_EDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** Candidate timestamps are NEWS time (publish-derived), not arrival time
 * (DEVELOPMENTS-PLAN.md §3) — always worded "reported", never "seen"/
 * "observed" (DESIGN.md spine #4). Collapses to a single point when both
 * ends land in the same display bucket ("reported 3d ago") instead of a
 * redundant "3d–3d ago" range. */
export function formatReportedWindow(firstSeenAt: string, lastSeenAt: string): string {
  const first = timeAgo(firstSeenAt);
  const last = timeAgo(lastSeenAt);
  if (first === last) return `reported ${last} ago`;
  return `reported ${first}–${last} ago`;
}
