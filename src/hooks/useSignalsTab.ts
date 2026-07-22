"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { SignalCardData, SignalAction } from "@/components/signals/types";
import { useBusyIds } from "./useBusyIds";

export const STATE_FILTERS = ["all", "new", "seen", "dismissed", "promoted"] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];
const FETCH_STATES = ["new", "seen", "dismissed", "promoted"];

function countByState(signals: SignalCardData[]): Record<StateFilter, number> {
  const counts: Record<StateFilter, number> = { all: signals.length, new: 0, seen: 0, dismissed: 0, promoted: 0 };
  for (const s of signals) {
    if (s.state in counts) counts[s.state as StateFilter]++;
  }
  return counts;
}

export interface SignalsWarmup {
  active: boolean;
  daysRemaining: number;
}

interface FetchSignalsResult {
  signals: SignalCardData[];
  warmup: SignalsWarmup | null;
}

class DatabaseNotConfiguredError extends Error {}

function parseWarmup(raw: unknown): SignalsWarmup | null {
  if (typeof raw !== "object" || raw === null) return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.active !== "boolean" || typeof w.daysRemaining !== "number") return null;
  return { active: w.active, daysRemaining: w.daysRemaining };
}

async function fetchSignals(): Promise<FetchSignalsResult> {
  const res = await fetch(`/api/signals?state=${FETCH_STATES.join(",")}`, { cache: "no-store" });
  if (res.status === 503) throw new DatabaseNotConfiguredError();
  if (!res.ok) throw new Error(`Failed to load signals (${res.status})`);
  const data = await res.json();
  return {
    signals: Array.isArray(data.signals) ? data.signals : [],
    warmup: parseWarmup(data.warmup),
  };
}

async function postSignalAction(id: number, action: SignalAction): Promise<void> {
  const res = await fetch("/api/signals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.error === "string" ? data.error : `Action failed (${res.status})`);
  }
}

interface UseSignalsTabParams {
  dark: boolean;
  onEntityClick: (name: string) => void;
}

// Exception to 50-line rule: fetch/action/state-filter state for the signal
// manager is tightly coupled — warmup, busyIds, and load()'s sequence guard
// all feed the same lifecycle; splitting them would scatter one hook's state
// across files without improving readability.
export function useSignalsTab({ dark, onEntityClick }: UseSignalsTabParams) {
  const [signals, setSignals] = useState<SignalCardData[]>([]);
  const [warmup, setWarmup] = useState<SignalsWarmup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dbUnconfigured, setDbUnconfigured] = useState(false);
  const { busyIds, withBusy } = useBusyIds();
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const loadSeq = useRef(0);

  useEffect(() => {
    // One-time cleanup: client-side muting is superseded by server-side dismiss.
    localStorage.removeItem("wd-muted-entities");
  }, []);

  // Guards against an in-flight load's response landing after a newer one
  // was started (e.g. a second action's refetch resolving before the
  // first's) and overwriting fresher data with stale data.
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    setDbUnconfigured(false);
    try {
      const result = await fetchSignals();
      if (seq !== loadSeq.current) return;
      setSignals(result.signals);
      setWarmup(result.warmup);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      if (e instanceof DatabaseNotConfiguredError) setDbUnconfigured(true);
      else setError(e instanceof Error ? e.message : "Failed to load signals");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fire-and-forget: load() owns its own try/catch and reports via state.
    load();
  }, [load]);

  const act = useCallback(
    (id: number, action: SignalAction) =>
      withBusy(id, async () => {
        setError(null);
        try {
          await postSignalAction(id, action);
          await load();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Action failed");
        }
      }),
    [load, withBusy],
  );

  const visibleSignals = useMemo(
    () => (stateFilter === "all" ? signals : signals.filter((s) => s.state === stateFilter)),
    [signals, stateFilter],
  );
  const stateCounts = useMemo(() => countByState(signals), [signals]);

  return {
    signals, warmup, visibleSignals, stateCounts, stateFilter, setStateFilter,
    loading, error, dbUnconfigured, busyIds, act, dark, onEntityClick,
  };
}
