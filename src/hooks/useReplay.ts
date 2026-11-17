"use client";

import { useCallback, useEffect, useState } from "react";
import { REPLAY_STEP_MS, nextReplay, replayStart } from "@/components/entitymap/replay";

/** replayAt is null when idle; start() steps it a day per tick up to now, then it resets to null. */
export function useReplay(nowMs: number, days: number) {
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const running = replayAt !== null;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setReplayAt((at) => (at === null ? null : nextReplay(at, nowMs))), REPLAY_STEP_MS);
    return () => window.clearInterval(timer);
  }, [running, nowMs]);
  const start = useCallback(() => setReplayAt(replayStart(nowMs, days)), [nowMs, days]);
  const stop = useCallback(() => setReplayAt(null), []);
  // A new window or snapshot makes the running replay meaningless.
  useEffect(stop, [days, nowMs, stop]);
  return { replayAt, start, stop };
}
