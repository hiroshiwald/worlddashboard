"use client";

import { useMemo } from "react";
import { FeedItem, ExtractedEntity, EnrichedEntity } from "@/lib/types";
import { enrichEntities, computeCurrentEdges } from "@/lib/novelty-scorer";
import {
  loadAnalysisStores,
  saveEdgeHistory,
  updateEntityBaselines,
} from "@/lib/signal-storage";

/**
 * Loads persisted analysis stores, enriches entities with novelty scores,
 * then persists updated edge history and baselines for the next refresh.
 * Centralizes the load+enrich+save sequence previously hidden inside
 * novelty-scorer.ts, which is now a pure module.
 */
export function useEnrichedEntities(
  entities: ExtractedEntity[],
  items: FeedItem[],
): EnrichedEntity[] {
  return useMemo(() => {
    const stores = loadAnalysisStores();
    const enriched = enrichEntities(entities, items, stores);
    saveEdgeHistory(computeCurrentEdges(entities));
    updateEntityBaselines(
      entities.map((e) => ({ name: e.name, mentions: e.mentions })),
    );
    return enriched;
  }, [entities, items]);
}
