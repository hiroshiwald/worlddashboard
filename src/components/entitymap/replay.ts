// Pure helpers for the replay: which day comes next, and what is hidden on a given day.
export const DAY_MS = 86_400_000;
export const REPLAY_STEP_MS = 800;

/** The first replay day: `days` before now. */
export function replayStart(nowMs: number, days: number): number {
  return nowMs - days * DAY_MS;
}

/** One day on, or null once the replay has reached now. */
export function nextReplay(at: number, nowMs: number): number | null {
  const next = at + DAY_MS;
  return next >= nowMs ? null : next;
}

/** True when the item first appeared after the replay day. Not replaying (null) hides nothing. */
export function hiddenAt(firstSeenMs: number, replayAt: number | null): boolean {
  return replayAt !== null && firstSeenMs > replayAt;
}

export function replayLabel(replayAt: number): string {
  return new Date(replayAt).toISOString().slice(0, 10);
}
