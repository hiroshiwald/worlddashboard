import {
  ExtractedEntity,
  FeedItem,
  EnrichedEntity,
  NoveltyReason,
} from "./types";
import { EdgeHistoryEntry } from "./types";
import {
  loadEdgeHistory,
  saveEdgeHistory,
  edgeKey,
  loadEntityBaselines,
  updateEntityBaselines,
  getBaselineRate,
  EntityBaseline,
} from "./signal-storage";

interface CategorySpreadResult {
  catScore: number;
  categorySpread: number;
  categories: string[];
  sourceCount: number;
  reason?: NoveltyReason;
}

interface ScoredReason {
  score: number;
  reason?: NoveltyReason;
}

function scoreCategorySpread(
  entity: ExtractedEntity,
  itemMap: Map<string, FeedItem>,
): CategorySpreadResult {
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
  const catScore = Math.min(30, Math.round(categorySpread * (30 / 5)));
  const reason: NoveltyReason | undefined = categorySpread >= 3
    ? {
        type: "category_crossover",
        label: `appearing across ${categorySpread} categories: ${categories.slice(0, 4).join(", ")}`,
        score: catScore,
      }
    : undefined;
  return { catScore, categorySpread, categories, sourceCount, reason };
}

function scoreSourceDiversity(entity: ExtractedEntity, sourceCount: number): number {
  const diversityRatio = entity.mentions > 0 ? sourceCount / entity.mentions : 0;
  return Math.min(15, Math.round(diversityRatio * 20));
}

function scoreEdgeNovelty(
  entity: ExtractedEntity,
  edgeHistory: Map<string, EdgeHistoryEntry>,
): ScoredReason {
  const novelEdgeNames: string[] = [];
  for (const [coName] of entity.cooccurrences) {
    const key = edgeKey(entity.name, coName);
    if (!edgeHistory.has(key)) novelEdgeNames.push(coName);
  }
  if (novelEdgeNames.length === 0) return { score: 0 };
  const score = Math.min(25, novelEdgeNames.length * 8);
  const reason: NoveltyReason = {
    type: "novel_edge",
    label: `novel co-occurrence: ${entity.name} + ${novelEdgeNames.slice(0, 3).join(", ")}`,
    score,
  };
  return { score, reason };
}

function scoreBaselineSurprise(
  entity: ExtractedEntity,
  baselines: Map<string, EntityBaseline>,
): ScoredReason {
  const baselineRate = getBaselineRate(baselines, entity.name);
  if (baselineRate > 0) {
    const ratio = entity.mentions / baselineRate;
    if (ratio <= 2) return { score: 0 };
    const score = Math.min(20, Math.round((ratio - 1) * 5));
    const reason: NoveltyReason = {
      type: "baseline_surprise",
      label: `${ratio.toFixed(1)}\u00d7 above ${Math.round(baselineRate)}-mention baseline`,
      score,
    };
    return { score, reason };
  }
  if (entity.mentions < 2) return { score: 0 };
  const score = 10;
  const reason: NoveltyReason = {
    type: "entity_emergence",
    label: `first appearance (${entity.mentions} mentions, no prior history)`,
    score,
  };
  return { score, reason };
}

function scoreQuietMover(entity: ExtractedEntity, hasOtherReasons: boolean): ScoredReason {
  if (!(entity.mentions <= 5 && hasOtherReasons)) return { score: 0 };
  const quietBonus = Math.min(10, Math.round((6 - entity.mentions) * 2));
  if (quietBonus <= 0) return { score: 0 };
  const reason: NoveltyReason = {
    type: "quiet_mover",
    label: `low volume (${entity.mentions} mentions) with novel signals`,
    score: quietBonus,
  };
  return { score: quietBonus, reason };
}

function buildCurrentEdges(entities: ExtractedEntity[]): Map<string, number> {
  const currentEdges = new Map<string, number>();
  for (const e of entities) {
    for (const [coName, count] of e.cooccurrences) {
      const key = edgeKey(e.name, coName);
      currentEdges.set(key, Math.max(currentEdges.get(key) || 0, count));
    }
  }
  return currentEdges;
}

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
function enrichSingleEntity(
  entity: ExtractedEntity,
  itemMap: Map<string, FeedItem>,
  edgeHistory: Map<string, EdgeHistoryEntry>,
  baselines: Map<string, EntityBaseline>,
): EnrichedEntity {
  const reasons: NoveltyReason[] = [];
  let totalScore = 0;
  const cat = scoreCategorySpread(entity, itemMap);
  totalScore += cat.catScore;
  if (cat.reason) reasons.push(cat.reason);
  totalScore += scoreSourceDiversity(entity, cat.sourceCount);
  const edge = scoreEdgeNovelty(entity, edgeHistory);
  totalScore += edge.score;
  if (edge.reason) reasons.push(edge.reason);
  const baseline = scoreBaselineSurprise(entity, baselines);
  totalScore += baseline.score;
  if (baseline.reason) reasons.push(baseline.reason);
  const quiet = scoreQuietMover(entity, reasons.length > 0);
  totalScore += quiet.score;
  if (quiet.reason) reasons.push(quiet.reason);
  return {
    ...entity,
    categorySpread: cat.categorySpread,
    categories: cat.categories,
    sourceCount: cat.sourceCount,
    noveltyScore: Math.min(100, totalScore),
    noveltyReasons: reasons.sort((a, b) => b.score - a.score),
  };
}

export function enrichEntities(
  entities: ExtractedEntity[],
  items: FeedItem[]
): EnrichedEntity[] {
  const itemMap = new Map<string, FeedItem>();
  for (const item of items) itemMap.set(item.id, item);
  const edgeHistory = loadEdgeHistory();
  const baselines = loadEntityBaselines();
  const currentEdges = buildCurrentEdges(entities);
  const enriched = entities.map((entity) =>
    enrichSingleEntity(entity, itemMap, edgeHistory, baselines),
  );
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
