"use client";

import { useMemo, useState } from "react";
import { FeedItem, EnrichedEntity, Situation } from "@/lib/types";
import { extractEntities } from "@/lib/entity-extractor";
import { enrichEntities, isKnownSituation } from "@/lib/novelty-scorer";
import { buildSituations } from "@/lib/situation-builder";
import { CardTheme } from "@/components/intel/utils";

export interface IntelTabTheme extends CardTheme {
  summaryBg: string;
  summaryText: string;
  knownBg: string;
  knownRowBorder: string;
  knownRowHover: string;
  sectionLabel: string;
}

interface UseIntelTabParams {
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

const KNOWN_LIMIT = 6;
const NOVEL_LIMIT = 15;

export function useIntelTab({ items, dark, onEntityClick }: UseIntelTabParams) {
  const entities = useMemo(() => extractEntities(items), [items]);
  const enriched = useMemo(() => enrichEntities(entities, items), [entities, items]);
  const situations = useMemo(() => buildSituations(enriched, items), [enriched, items]);

  const [expandedSituations, setExpandedSituations] = useState<Set<string>>(new Set());
  const [showAllKnown, setShowAllKnown] = useState(false);
  const [showAllNovel, setShowAllNovel] = useState(false);

  const entityLookup = useMemo(() => {
    const map = new Map<string, EnrichedEntity>();
    for (const e of enriched) map.set(e.name, e);
    return map;
  }, [enriched]);

  const { knownSituations, novelSituations } = useMemo(() => {
    const known: Situation[] = [];
    const novel: Situation[] = [];

    for (const sit of situations) {
      const dominantEntity = sit.entities
        .map((n) => entityLookup.get(n))
        .filter(Boolean)
        .sort((a, b) => b!.mentions - a!.mentions)[0];

      if (dominantEntity && isKnownSituation(dominantEntity)) {
        known.push(sit);
      } else {
        novel.push(sit);
      }
    }

    return { knownSituations: known, novelSituations: novel };
  }, [situations, entityLookup]);

  const situationEntityNames = useMemo(() => {
    const names = new Set<string>();
    for (const sit of situations) {
      for (const n of sit.entities) names.add(n);
    }
    return names;
  }, [situations]);

  const standaloneNovelEntities = useMemo(() => {
    return enriched
      .filter((e) => !situationEntityNames.has(e.name) && !isKnownSituation(e) && e.noveltyScore > 0)
      .sort((a, b) => b.noveltyScore - a.noveltyScore);
  }, [enriched, situationEntityNames]);

  const toggleSituation = (id: string) => {
    setExpandedSituations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleKnown = showAllKnown ? knownSituations : knownSituations.slice(0, KNOWN_LIMIT);
  const visibleNovel = showAllNovel ? novelSituations : novelSituations.slice(0, NOVEL_LIMIT);

  const hasFewItems = items.length < 10;

  const t: IntelTabTheme = {
    summaryBg: dark ? "bg-slate-900 shadow-lg shadow-black/20" : "bg-white shadow-sm",
    summaryText: dark ? "text-slate-300" : "text-gray-700",
    text: dark ? "text-slate-200" : "text-gray-800",
    textMuted: dark ? "text-slate-400" : "text-gray-500",
    entityName: dark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700",
    cardBg: dark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-100 shadow-sm",
    knownBg: dark ? "bg-slate-900/80" : "bg-gray-50",
    knownRowBorder: dark ? "border-slate-800/60" : "border-gray-100",
    knownRowHover: dark ? "hover:bg-slate-800/80" : "hover:bg-blue-50/40",
    sectionLabel: dark ? "text-slate-300" : "text-gray-700",
    confidenceBg: dark ? "bg-slate-700" : "bg-gray-200",
    noveltyBar: dark ? "bg-emerald-500" : "bg-emerald-500",
    linkText: dark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700",
  };

  return {
    enriched,
    situations,
    knownSituations,
    novelSituations,
    standaloneNovelEntities,
    visibleKnown,
    visibleNovel,
    expandedSituations,
    toggleSituation,
    showAllKnown,
    setShowAllKnown,
    showAllNovel,
    setShowAllNovel,
    knownLimit: KNOWN_LIMIT,
    novelLimit: NOVEL_LIMIT,
    hasFewItems,
    dark,
    onEntityClick,
    t,
  };
}
