"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { FeedItem, EnrichedEntity } from "@/lib/types";
import { extractEntities } from "@/lib/entity-extractor";
import { SignalCardData, SignalAction } from "@/components/signals/types";
import { useEnrichedEntities } from "./useEnrichedEntities";
import { useBusyIds } from "./useBusyIds";

// Unchanged shape: WatchlistCard.tsx / WatchlistSection.tsx import this type
// structurally and are kept exactly as-is by this rewrite.
export interface SignalsTabTheme {
  cardBg: string;
  summaryBg: string;
  summaryText: string;
  text: string;
  textMuted: string;
  entityName: string;
  confidenceBg: string;
  muteBtnBg: string;
  sectionLabel: string;
  evidenceBg: string;
  linkText: string;
  sparkBarActive: string;
  sparkBarEmpty: string;
}

export const STATE_FILTERS = ["all", "new", "seen", "dismissed", "promoted"] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];
const FETCH_STATES = ["new", "seen", "dismissed", "promoted"];

function buildSignalsTheme(dark: boolean): SignalsTabTheme {
  return {
    cardBg: dark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-100 shadow-sm",
    summaryBg: dark ? "bg-slate-900 shadow-lg shadow-black/20" : "bg-white shadow-sm",
    summaryText: dark ? "text-slate-300" : "text-gray-700",
    text: dark ? "text-slate-200" : "text-gray-800",
    textMuted: dark ? "text-slate-400" : "text-gray-500",
    entityName: dark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700",
    confidenceBg: dark ? "bg-slate-700" : "bg-gray-200",
    muteBtnBg: dark
      ? "text-slate-500 hover:text-red-400 hover:bg-red-500/10"
      : "text-gray-400 hover:text-red-600 hover:bg-red-50",
    sectionLabel: dark ? "text-slate-300" : "text-gray-700",
    evidenceBg: dark ? "bg-slate-800/50 border-slate-700" : "bg-gray-50 border-gray-200",
    linkText: dark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700",
    sparkBarActive: dark ? "bg-emerald-500" : "bg-emerald-500",
    sparkBarEmpty: dark ? "bg-slate-700" : "bg-gray-200",
  };
}

function computeTopEntities(enriched: EnrichedEntity[]): EnrichedEntity[] {
  return [...enriched].sort((a, b) => b.recentMentions.day - a.recentMentions.day).slice(0, 12);
}

function computeSparklineData(topEntities: EnrichedEntity[], itemMap: Map<string, FeedItem>): Map<string, number[]> {
  const now = Date.now();
  const result = new Map<string, number[]>();
  for (const entity of topEntities) {
    const bins = new Array(24).fill(0);
    for (const itemId of entity.itemIds) {
      const item = itemMap.get(itemId);
      if (!item) continue;
      const hoursAgo = Math.floor((now - new Date(item.published).getTime()) / (60 * 60 * 1000));
      if (hoursAgo >= 0 && hoursAgo < 24) bins[23 - hoursAgo]++;
    }
    result.set(entity.name, bins);
  }
  return result;
}

function countByState(signals: SignalCardData[]): Record<StateFilter, number> {
  const counts: Record<StateFilter, number> = { all: signals.length, new: 0, seen: 0, dismissed: 0, promoted: 0 };
  for (const s of signals) {
    if (s.state in counts) counts[s.state as StateFilter]++;
  }
  return counts;
}

class DatabaseNotConfiguredError extends Error {}

async function fetchSignals(): Promise<SignalCardData[]> {
  const res = await fetch(`/api/signals?state=${FETCH_STATES.join(",")}`, { cache: "no-store" });
  if (res.status === 503) throw new DatabaseNotConfiguredError();
  if (!res.ok) throw new Error(`Failed to load signals (${res.status})`);
  const data = await res.json();
  return Array.isArray(data.signals) ? data.signals : [];
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
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

// Exception to 50-line rule: tightly-coupled state management hook —
// watchlist memos (entities/enriched/topEntities/sparklineData/itemMap) plus
// the signal-manager fetch/action state (signals/loading/error/busyIds/
// stateFilter) genuinely belong together as one hook's public surface.
// Pure helpers (buildSignalsTheme, computeTopEntities, computeSparklineData,
// countByState, fetchSignals, postSignalAction) are already extracted above.
export function useSignalsTab({ items, dark, onEntityClick }: UseSignalsTabParams) {
  const entities = useMemo(() => extractEntities(items), [items]);
  const enriched = useEnrichedEntities(entities, items);
  const topEntities = useMemo(() => computeTopEntities(enriched), [enriched]);

  const itemMap = useMemo(() => {
    const map = new Map<string, FeedItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);
  const sparklineData = useMemo(() => computeSparklineData(topEntities, itemMap), [topEntities, itemMap]);

  const [signals, setSignals] = useState<SignalCardData[]>([]);
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
      setSignals(result);
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

  const t = buildSignalsTheme(dark);

  return {
    topEntities,
    sparklineData,
    signals,
    visibleSignals,
    stateCounts,
    stateFilter,
    setStateFilter,
    loading,
    error,
    dbUnconfigured,
    busyIds,
    act,
    dark,
    onEntityClick,
    t,
  };
}
