import {
  ExtractedEntity,
  FeedItem,
  EnrichedEntity,
  NoveltyReason,
} from "./types";
import {
  loadEdgeHistory,
  saveEdgeHistory,
  edgeKey,
  loadEntityBaselines,
  updateEntityBaselines,
  getBaselineRate,
} from "./signal-storage";

/**
 * Enrich entities with novelty scores and reasons.
 *
 * Novelty score composite (0-100):
 *   1. Category spread   (0-30)
 *   2. Source diversity   (0-15)
 *   3. Edge novelty      (0-25)
 *   4. Baseline surprise  (0-20)
 *   5. Entity emergence   (0-10)
 */
export function enrichEntities(
  entities: ExtractedEntity[],
  items: FeedItem[]
): EnrichedEntity[] {
  const itemMap = new Map<string, FeedItem>();
  for (const item of items) itemMap.set(item.id, item);

  const edgeHistory = loadEdgeHistory();
  const baselines = loadEntityBaselines();

  // Build current edge set
  const currentEdges = new Map<string, number>();
  for (const e of entities) {
    for (const [coName, count] of e.cooccurrences) {
      const key = edgeKey(e.name, coName);
      currentEdges.set(key, Math.max(currentEdges.get(key) || 0, count));
    }
  }

  const enriched: EnrichedEntity[] = entities.map((entity) => {
    // Compute categorySpread and sourceCount from itemIds
    const cats = new Set<string>();
    const srcs = new Set<string>();
    for (const itemId of entity.itemIds) {
      const item = itemMap.get(itemId);
      if (item) {
        cats.add(item.sourceCategory);
        srcs.add(item.sourceName);
      }
    }

    const categorySpread = cats.size;
    const categories = Array.from(cats);
    const sourceCount = srcs.size;

    const reasons: NoveltyReason[] = [];
    let totalScore = 0;

    // 1. Category spread (0-30)
    const catScore = Math.min(30, Math.round(categorySpread * (30 / 5)));
    if (categorySpread >= 3) {
      reasons.push({
        type: "category_crossover",
        label: `appearing across ${categorySpread} categories: ${categories.slice(0, 4).join(", ")}`,
        score: catScore,
      });
    }
    totalScore += catScore;

    // 2. Source diversity ratio (0-15)
    const diversityRatio =
      entity.mentions > 0 ? sourceCount / entity.mentions : 0;
    const diversityScore = Math.min(15, Math.round(diversityRatio * 20));
    totalScore += diversityScore;

    // 3. Edge novelty (0-25)
    const novelEdgeNames: string[] = [];
    for (const [coName] of entity.cooccurrences) {
      const key = edgeKey(entity.name, coName);
      if (!edgeHistory.has(key)) {
        novelEdgeNames.push(coName);
      }
    }
    let novelEdgeScore = 0;
    if (novelEdgeNames.length > 0) {
      novelEdgeScore = Math.min(25, novelEdgeNames.length * 8);
      reasons.push({
        type: "novel_edge",
        label: `novel co-occurrence: ${entity.name} + ${novelEdgeNames.slice(0, 3).join(", ")}`,
        score: novelEdgeScore,
      });
    }
    totalScore += novelEdgeScore;

    // 4. Baseline surprise (0-20) / Entity emergence (0-10)
    const baselineRate = getBaselineRate(baselines, entity.name);
    if (baselineRate > 0) {
      const ratio = entity.mentions / baselineRate;
      if (ratio > 2) {
        const surpriseScore = Math.min(20, Math.round((ratio - 1) * 5));
        reasons.push({
          type: "baseline_surprise",
          label: `${ratio.toFixed(1)}\u00d7 above ${Math.round(baselineRate)}-mention baseline`,
          score: surpriseScore,
        });
        totalScore += surpriseScore;
      }
    } else if (entity.mentions >= 2) {
      const emergenceScore = 10;
      reasons.push({
        type: "entity_emergence",
        label: `first appearance (${entity.mentions} mentions, no prior history)`,
        score: emergenceScore,
      });
      totalScore += emergenceScore;
    }

    // 5. Quiet mover bonus
    if (entity.mentions <= 5 && reasons.length > 0) {
      const quietBonus = Math.min(10, Math.round((6 - entity.mentions) * 2));
      if (quietBonus > 0) {
        reasons.push({
          type: "quiet_mover",
          label: `low volume (${entity.mentions} mentions) with novel signals`,
          score: quietBonus,
        });
        totalScore += quietBonus;
      }
    }

    return {
      ...entity,
      categorySpread,
      categories,
      sourceCount,
      noveltyScore: Math.min(100, totalScore),
      noveltyReasons: reasons.sort((a, b) => b.score - a.score),
    };
  });

  // Persist state for next refresh
  saveEdgeHistory(currentEdges);
  updateEntityBaselines(
    entities.map((e) => ({ name: e.name, mentions: e.mentions }))
  );

  return enriched;
}

/**
 * Entities with noveltyScore < 20 AND mentions >= 15 are "known situations".
 */
export function isKnownSituation(entity: EnrichedEntity): boolean {
  return entity.noveltyScore < 20 && entity.mentions >= 15;
}
