"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { FeedItem, ExtractedEntity, Signal, EnrichedEntity } from "@/lib/types";
import { extractEntities } from "@/lib/entity-extractor";
import { detectSignals } from "@/lib/signal-detector";
import { enrichEntities } from "@/lib/novelty-scorer";
import { buildSituations } from "@/lib/situation-builder";
import {
  MUTE_DURATION,
  SNAPSHOT_INTERVAL,
  loadMutedEntities,
  saveMutedEntities,
  loadPreviousEntityNames,
  saveEntitySnapshot,
} from "@/lib/signal-storage";

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

interface UseSignalsTabParams {
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

const INITIAL_LIMIT = 12;

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

// Exception to 50-line rule: tightly-coupled state management hook.
// 4 source memos (entities, enriched, situations, signals), 2 pieces
// of persisted UI state (mute map, snapshot refs), 4 derived memos
// (activeSignals, itemMap, entityLookup, entitySituationMap), plus
// 4 display memos (topEntities, sparklineData, severityCounts,
// visibleSignals). Splitting would fragment related state wiring
// across files. Only the pure theme block is extracted (buildSignalsTheme).
export function useSignalsTab({ items, dark, onEntityClick }: UseSignalsTabParams) {
  const entities = useMemo(() => extractEntities(items), [items]);
  const enriched = useMemo(() => enrichEntities(entities, items), [entities, items]);
  const situations = useMemo(() => buildSituations(enriched, items), [enriched, items]);

  const [mutedEntities, setMutedEntities] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    setMutedEntities(loadMutedEntities());
  }, []);

  const handleMute = useCallback((name: string) => {
    setMutedEntities((prev) => {
      const next = new Map(prev);
      next.set(name, Date.now() + MUTE_DURATION);
      saveMutedEntities(next);
      return next;
    });
  }, []);

  const handleUnmuteAll = useCallback(() => {
    setMutedEntities(new Map());
    localStorage.removeItem("wd-muted-entities");
  }, []);

  const previousEntityNames = useRef<Set<string>>(new Set());
  const lastSnapshotTime = useRef<number>(0);

  useEffect(() => {
    previousEntityNames.current = loadPreviousEntityNames();
  }, []);

  useEffect(() => {
    const now = Date.now();
    if (entities.length > 0 && now - lastSnapshotTime.current > SNAPSHOT_INTERVAL) {
      lastSnapshotTime.current = now;
      saveEntitySnapshot(entities);
    }
  }, [entities]);

  const signals = useMemo(
    () => detectSignals(entities, items, previousEntityNames.current),
    [entities, items]
  );

  const activeSignals = useMemo(() => {
    const now = Date.now();
    return signals
      .filter((s) => s.confidence >= 0.70)
      .filter((s) => !s.entities.every((e) => {
        const expiry = mutedEntities.get(e);
        return expiry !== undefined && expiry > now;
      }));
  }, [signals, mutedEntities]);

  const [showAll, setShowAll] = useState(false);
  const visibleSignals = showAll ? activeSignals : activeSignals.slice(0, INITIAL_LIMIT);

  const itemMap = useMemo(() => {
    const map = new Map<string, FeedItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const entityLookup = useMemo(() => {
    const map = new Map<string, EnrichedEntity>();
    for (const e of enriched) map.set(e.name, e);
    return map;
  }, [enriched]);

  const entitySituationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const sit of situations) {
      for (const name of sit.entities) {
        if (!map.has(name)) map.set(name, sit.title);
      }
    }
    return map;
  }, [situations]);

  const getEvidenceArticles = useCallback(
    (signal: Signal): FeedItem[] => {
      const articleIds = new Set<string>();
      for (const entityName of signal.entities) {
        const entity = entityLookup.get(entityName);
        if (entity) {
          for (const id of entity.itemIds) articleIds.add(id);
        }
      }
      return Array.from(articleIds)
        .map((id) => itemMap.get(id))
        .filter((item): item is FeedItem => !!item)
        .sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime())
        .slice(0, 3);
    },
    [entityLookup, itemMap]
  );

  const topEntities = useMemo(() => {
    const now = Date.now();
    return [...enriched]
      .filter((e) => {
        const expiry = mutedEntities.get(e.name);
        return !expiry || expiry <= now;
      })
      .sort((a, b) => b.recentMentions.day - a.recentMentions.day)
      .slice(0, 12);
  }, [enriched, mutedEntities]);

  const sparklineData = useMemo(() => {
    const now = Date.now();
    const result = new Map<string, number[]>();

    for (const entity of topEntities) {
      const bins = new Array(24).fill(0);
      for (const itemId of entity.itemIds) {
        const item = itemMap.get(itemId);
        if (!item) continue;
        const age = now - new Date(item.published).getTime();
        const hoursAgo = Math.floor(age / (60 * 60 * 1000));
        if (hoursAgo >= 0 && hoursAgo < 24) {
          bins[23 - hoursAgo]++;
        }
      }
      result.set(entity.name, bins);
    }

    return result;
  }, [topEntities, itemMap]);

  const severityCounts = useMemo(() => {
    const c = { critical: 0, warning: 0, advisory: 0 };
    for (const s of activeSignals) c[s.severity]++;
    return c;
  }, [activeSignals]);

  const mutedCount = mutedEntities.size;

  const t = buildSignalsTheme(dark);

  return {
    entities,
    activeSignals,
    visibleSignals,
    severityCounts,
    topEntities,
    sparklineData,
    entitySituationMap,
    getEvidenceArticles,
    mutedCount,
    handleMute,
    handleUnmuteAll,
    showAll,
    setShowAll,
    initialLimit: INITIAL_LIMIT,
    totalSignalCount: activeSignals.length,
    dark,
    onEntityClick,
    t,
  };
}
