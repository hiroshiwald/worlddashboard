"use client";

import { useMemo, useState, useCallback } from "react";
import { FeedItem, EnrichedEntity, EntityType } from "@/lib/types";
import { extractEntities } from "@/lib/entity-extractor";
import { enrichEntities } from "@/lib/novelty-scorer";
import { loadEdgeHistory, edgeKey } from "@/lib/signal-storage";

export type EdgeMode = "all" | "novel" | "none";

export interface EdgeData {
  from: string;
  to: string;
  count: number;
  novel: boolean;
}

export interface DiscoveryTabTheme {
  bg: string;
  text: string;
  textMuted: string;
  textFaint: string;
  controlBg: string;
  controlActive: string;
  controlInactive: string;
  tooltipBg: string;
  legendBg: string;
}

interface UseDiscoveryTabParams {
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

const ENTITY_TYPES: EntityType[] = ["country", "organization", "person", "region"];

function buildDiscoveryTheme(dark: boolean): DiscoveryTabTheme {
  return {
    bg: dark ? "bg-slate-950" : "bg-white",
    text: dark ? "text-slate-200" : "text-gray-800",
    textMuted: dark ? "text-slate-400" : "text-gray-500",
    textFaint: dark ? "text-slate-600" : "text-gray-300",
    controlBg: dark ? "bg-slate-900 border-slate-700" : "bg-gray-50 border-gray-200",
    controlActive: dark ? "bg-slate-700 text-slate-200" : "bg-gray-200 text-gray-800",
    controlInactive: dark ? "bg-transparent text-slate-500 hover:text-slate-300" : "bg-transparent text-gray-400 hover:text-gray-700",
    tooltipBg: dark ? "bg-slate-800 border-slate-600" : "bg-white border-gray-200 shadow-lg",
    legendBg: dark ? "bg-slate-900/80" : "bg-gray-50/80",
  };
}

// Exception to 50-line rule: tightly-coupled state management hook.
// 5 pieces of UI state (edgeMode, typeFilter, minMentions, hoveredEntity,
// tooltipPos) feeding 8+ interleaved memoized computations (filteredEntities,
// maxCat, maxMentions, entityPositions, edges, itemMap, entityLookup,
// hoveredLatestArticle) that depend on each other. Splitting would fragment
// the memo dependency chain. Only the pure theme block is extracted.
export function useDiscoveryTab({ items, dark }: UseDiscoveryTabParams) {
  const entities = useMemo(() => extractEntities(items), [items]);
  const enriched = useMemo(() => enrichEntities(entities, items), [entities, items]);

  const [edgeMode, setEdgeMode] = useState<EdgeMode>("novel");
  const [typeFilter, setTypeFilter] = useState<Set<EntityType>>(
    new Set(["country", "organization", "person", "region"])
  );
  const [minMentions, setMinMentions] = useState(2);
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const edgeHistory = useMemo(() => loadEdgeHistory(), []);

  const filteredEntities = useMemo(
    () => enriched.filter((e) => typeFilter.has(e.type) && e.mentions >= minMentions),
    [enriched, typeFilter, minMentions]
  );

  const maxCat = useMemo(() => Math.max(1, ...filteredEntities.map((e) => e.categorySpread)), [filteredEntities]);
  const maxMentions = useMemo(() => Math.max(1, ...filteredEntities.map((e) => e.mentions)), [filteredEntities]);

  const entityPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; size: number }>();
    for (const e of filteredEntities) {
      const xPct = ((e.categorySpread - 1) / Math.max(1, maxCat - 1)) * 90 + 5;
      const yPct = (1 - Math.log(e.mentions + 1) / Math.log(maxMentions + 1)) * 85 + 5;
      const size = Math.max(8, Math.min(32, 8 + (e.sourceCount / Math.max(1, ...filteredEntities.map((f) => f.sourceCount))) * 24));
      positions.set(e.name, { x: xPct, y: yPct, size });
    }
    return positions;
  }, [filteredEntities, maxCat, maxMentions]);

  const edges: EdgeData[] = useMemo(() => {
    if (edgeMode === "none") return [];
    const edgeList: EdgeData[] = [];
    const seen = new Set<string>();
    const posNames = new Set(entityPositions.keys());

    for (const e of filteredEntities) {
      for (const [coName, count] of e.cooccurrences) {
        if (!posNames.has(coName)) continue;
        const key = edgeKey(e.name, coName);
        if (seen.has(key)) continue;
        seen.add(key);

        const isNovel = !edgeHistory.has(key);
        if (edgeMode === "novel" && !isNovel) continue;

        edgeList.push({ from: e.name, to: coName, count, novel: isNovel });
      }
    }
    return edgeList;
  }, [filteredEntities, edgeMode, edgeHistory, entityPositions]);

  const toggleType = useCallback((type: EntityType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleDotHover = useCallback((name: string | null, e?: React.MouseEvent) => {
    setHoveredEntity(name);
    if (e && name) {
      const rect = (e.currentTarget as HTMLElement).closest(".scatter-container")?.getBoundingClientRect();
      if (rect) {
        setTooltipPos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    }
  }, []);

  const itemMap = useMemo(() => {
    const map = new Map<string, FeedItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const entityLookup = useMemo(() => {
    const map = new Map<string, EnrichedEntity>();
    for (const e of filteredEntities) map.set(e.name, e);
    return map;
  }, [filteredEntities]);

  const hoveredEntityData = hoveredEntity ? entityLookup.get(hoveredEntity) ?? null : null;

  const hoveredLatestArticle = useMemo(() => {
    if (!hoveredEntityData) return null;
    let latest: FeedItem | null = null;
    let latestTime = 0;
    for (const id of hoveredEntityData.itemIds) {
      const item = itemMap.get(id);
      if (item) {
        const t = new Date(item.published).getTime();
        if (t > latestTime) { latestTime = t; latest = item; }
      }
    }
    return latest;
  }, [hoveredEntityData, itemMap]);

  const t = buildDiscoveryTheme(dark);

  return {
    filteredEntities,
    entityPositions,
    edges,
    edgeMode,
    setEdgeMode,
    typeFilter,
    toggleType,
    minMentions,
    setMinMentions,
    hoveredEntity,
    hoveredEntityData,
    hoveredLatestArticle,
    tooltipPos,
    handleDotHover,
    entityTypes: ENTITY_TYPES,
    t,
  };
}
