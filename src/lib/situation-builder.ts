import {
  FeedItem,
  EnrichedEntity,
  Situation,
  SituationArticle,
  UrgencyLevel,
} from "./types";

/**
 * Cluster articles that share 2+ co-occurring entities into Situations.
 */
export function buildSituations(
  enrichedEntities: EnrichedEntity[],
  items: FeedItem[]
): Situation[] {
  // Reverse index: itemId -> entity names
  const itemEntityMap = new Map<string, Set<string>>();
  for (const entity of enrichedEntities) {
    for (const itemId of entity.itemIds) {
      if (!itemEntityMap.has(itemId)) itemEntityMap.set(itemId, new Set());
      itemEntityMap.get(itemId)!.add(entity.name);
    }
  }

  const entityLookup = new Map<string, EnrichedEntity>();
  for (const e of enrichedEntities) entityLookup.set(e.name, e);

  // Find entity pairs and their shared articles
  const pairArticles = new Map<string, Set<string>>();
  for (const [itemId, entityNames] of itemEntityMap) {
    const arr = Array.from(entityNames);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = [arr[i], arr[j]].sort().join("|");
        if (!pairArticles.has(key)) pairArticles.set(key, new Set());
        pairArticles.get(key)!.add(itemId);
      }
    }
  }

  // Keep pairs with >= 2 articles
  const significantPairs = new Map<string, Set<string>>();
  for (const [pair, articleIds] of pairArticles) {
    if (articleIds.size >= 2) significantPairs.set(pair, articleIds);
  }

  // Greedy clustering: merge overlapping article sets
  const clusters: { entities: Set<string>; articleIds: Set<string> }[] = [];
  const sortedPairs = Array.from(significantPairs.entries()).sort(
    (a, b) => b[1].size - a[1].size
  );

  for (const [pair, articleIds] of sortedPairs) {
    const [entityA, entityB] = pair.split("|");

    let bestCluster: (typeof clusters)[0] | null = null;
    let bestOverlap = 0;

    for (const cluster of clusters) {
      const overlap = Array.from(articleIds).filter((id) =>
        cluster.articleIds.has(id)
      ).length;
      const overlapRatio = overlap / articleIds.size;
      if (overlapRatio > 0.5 && overlap > bestOverlap) {
        bestCluster = cluster;
        bestOverlap = overlap;
      }
    }

    if (bestCluster) {
      bestCluster.entities.add(entityA);
      bestCluster.entities.add(entityB);
      for (const id of articleIds) bestCluster.articleIds.add(id);
    } else {
      clusters.push({
        entities: new Set([entityA, entityB]),
        articleIds: new Set(articleIds),
      });
    }
  }

  // Convert clusters to Situations
  const itemMap = new Map<string, FeedItem>();
  for (const item of items) itemMap.set(item.id, item);

  const urgencyPriority: Record<UrgencyLevel, number> = {
    critical: 6,
    warning: 5,
    advisory: 4,
    monitoring: 3,
    system: 2,
    neutral: 1,
  };

  const situations: Situation[] = clusters
    .filter((c) => c.articleIds.size >= 2)
    .map((cluster, idx) => {
      const articles: SituationArticle[] = [];
      const sources = new Set<string>();
      const cats = new Set<string>();
      let earliestTime = Infinity;
      let latestArticle: SituationArticle | null = null;
      let latestTime = 0;
      let sentimentSum = 0;

      for (const articleId of cluster.articleIds) {
        const item = itemMap.get(articleId);
        if (!item) continue;

        const sa: SituationArticle = {
          id: item.id,
          title: item.title,
          sourceName: item.sourceName,
          published: item.published,
          link: item.link,
          sourceCategory: item.sourceCategory,
        };
        articles.push(sa);
        sources.add(item.sourceName);
        cats.add(item.sourceCategory);

        const t = new Date(item.published).getTime();
        if (t < earliestTime) earliestTime = t;
        if (t > latestTime) {
          latestTime = t;
          latestArticle = sa;
        }
      }

      articles.sort(
        (a, b) =>
          new Date(b.published).getTime() - new Date(a.published).getTime()
      );

      const entityNames = Array.from(cluster.entities);
      let maxNovelty = 0;
      const allReasons: EnrichedEntity["noveltyReasons"] = [];
      let maxUrgency: UrgencyLevel = "neutral";

      for (const name of entityNames) {
        const e = entityLookup.get(name);
        if (!e) continue;
        if (e.noveltyScore > maxNovelty) maxNovelty = e.noveltyScore;
        allReasons.push(...e.noveltyReasons);
        sentimentSum += e.sentiment;

        for (const [level, count] of Object.entries(e.urgencyBreakdown) as [
          UrgencyLevel,
          number,
        ][]) {
          if (
            count > 0 &&
            urgencyPriority[level] > urgencyPriority[maxUrgency]
          ) {
            maxUrgency = level;
          }
        }
      }

      // Deduplicate reasons
      const seenReasons = new Set<string>();
      const uniqueReasons = allReasons
        .filter((r) => {
          const key = `${r.type}:${r.label}`;
          if (seenReasons.has(key)) return false;
          seenReasons.add(key);
          return true;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      // Determine tempo
      let tempo: Situation["tempo"] = "steady";
      const totalMentionsHour = entityNames.reduce((sum, name) => {
        const e = entityLookup.get(name);
        return sum + (e?.recentMentions.hour || 0);
      }, 0);
      const totalMentionsDay = entityNames.reduce((sum, name) => {
        const e = entityLookup.get(name);
        return sum + (e?.recentMentions.day || 0);
      }, 0);

      if (totalMentionsDay === 0) {
        tempo = "new";
      } else {
        const dailyAvgRate = (totalMentionsDay - totalMentionsHour) / 23;
        if (dailyAvgRate > 0 && totalMentionsHour / dailyAvgRate > 2)
          tempo = "accelerating";
        else if (totalMentionsHour === 0 && totalMentionsDay > 5)
          tempo = "fading";
      }

      // Title from top entities
      const topEntities = entityNames
        .map((n) => ({
          name: n,
          mentions: entityLookup.get(n)?.mentions || 0,
        }))
        .sort((a, b) => b.mentions - a.mentions)
        .slice(0, 2)
        .map((e) => e.name);
      const title = latestArticle?.title || topEntities.join(" \u2014 ");

      return {
        id: `sit-${idx}`,
        title,
        entities: entityNames,
        articleCount: articles.length,
        sourceCount: sources.size,
        articles,
        urgency: maxUrgency,
        tempo,
        noveltyScore: maxNovelty,
        noveltyReasons: uniqueReasons,
        sentiment:
          entityNames.length > 0 ? sentimentSum / entityNames.length : 0,
        firstSeen:
          earliestTime < Infinity
            ? new Date(earliestTime).toISOString()
            : new Date().toISOString(),
        latestArticle: latestArticle || articles[0],
        categorySpread: cats.size,
      };
    })
    .sort(
      (a, b) =>
        b.noveltyScore - a.noveltyScore || b.articleCount - a.articleCount
    );

  return situations;
}
