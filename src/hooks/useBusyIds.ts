"use client";

import { useState, useCallback } from "react";

/** Tracks a set of "in flight" ids (e.g. one per signal card action) instead
 * of a single shared id — a single id is overwritten by whichever action
 * starts most recently, wrongly re-enabling an earlier action's controls
 * while its request is still outstanding. */
export function useBusyIds() {
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const withBusy = useCallback(async (id: number, fn: () => Promise<void>) => {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await fn();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  return { busyIds, withBusy };
}
