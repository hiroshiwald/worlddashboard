import {
  ExtractedEntity,
  FeedItem,
  Signal,
  SignalSeverity,
} from "./types";

const SEVERITY_ORDER: Record<SignalSeverity, number> = {
  critical: 0,
  warning: 1,
  advisory: 2,
};

function detectSurges(entities: ExtractedEntity[]): Signal[] {
  const signals: Signal[] = [];
  const now = new Date().toISOString();

  for (const e of entities) {
    const { hour, day } = e.recentMentions;
    if (hour < 3 || day < 4) continue;

    const baseRate = (day - hour) / 23;
    const ratio = baseRate === 0 ? hour * 3 : hour / baseRate;

    if (ratio < 3) continue;

    const severity: SignalSeverity =
      ratio > 8 || hour >= 10
        ? "critical"
        : ratio > 5 || hour >= 6
          ? "warning"
          : "advisory";

    signals.push({
      id: `surge-${e.name}`,
      type: "surge",
      severity,
      title: `SURGE: ${e.name} (+${hour} in 1h)`,
      description: `Mention velocity ${ratio.toFixed(1)}x above daily baseline. ${hour} mentions in the last hour vs ${day} over 24h.`,
      entities: [e.name],
      confidence: Math.min(1, ratio / 10),
      detectedAt: now,
      metric: hour,
    });
  }

  return signals;
}

function detectSentimentDeteriorations(
  entities: ExtractedEntity[]
): Signal[] {
  const signals: Signal[] = [];
  const now = new Date().toISOString();

  for (const e of entities) {
    if (e.sentiment > -0.3 || e.mentions < 5) continue;

    const compound = Math.abs(e.sentiment) * e.mentions;
    const severity: SignalSeverity =
      e.sentiment <= -0.6 && e.mentions >= 10
        ? "critical"
        : e.sentiment <= -0.4
          ? "warning"
          : "advisory";

    signals.push({
      id: `sentiment_deterioration-${e.name}`,
      type: "sentiment_deterioration",
      severity,
      title: `NEG SENTIMENT: ${e.name}`,
      description: `Sentiment score ${e.sentiment.toFixed(2)} across ${e.mentions} mentions. High-volume negative coverage indicates brewing crisis.`,
      entities: [e.name],
      confidence: Math.min(1, compound / 10),
      detectedAt: now,
      metric: compound,
    });
  }

  return signals;
}

function detectCrossCategoryConvergence(
  entities: ExtractedEntity[],
  itemCategoryMap: Map<string, string>
): Signal[] {
  const signals: Signal[] = [];
  const now = new Date().toISOString();

  for (const e of entities) {
    if (e.mentions < 3) continue;

    const categories = new Set<string>();
    for (const itemId of e.itemIds) {
      const cat = itemCategoryMap.get(itemId);
      if (cat) categories.add(cat);
    }

    if (categories.size < 3) continue;

    const catList = Array.from(categories)
      .slice(0, 5)
      .map((c) => c.toUpperCase())
      .join(", ");
    const severity: SignalSeverity =
      categories.size >= 5
        ? "critical"
        : categories.size >= 4
          ? "warning"
          : "advisory";

    signals.push({
      id: `cross_category-${e.name}`,
      type: "cross_category",
      severity,
      title: `CONVERGENCE: ${e.name}`,
      description: `Appearing across ${categories.size} categories: ${catList}. Multi-domain coverage suggests compound situation.`,
      entities: [e.name],
      confidence: Math.min(1, categories.size / 5),
      detectedAt: now,
      metric: categories.size,
    });
  }

  return signals;
}

function detectNovelCooccurrences(
  entities: ExtractedEntity[]
): Signal[] {
  const entityMap = new Map<string, ExtractedEntity>();
  for (const e of entities) entityMap.set(e.name, e);

  const seen = new Set<string>();
  const pairs: {
    a: ExtractedEntity;
    b: ExtractedEntity;
    count: number;
  }[] = [];

  for (const e of entities) {
    for (const [coName, count] of e.cooccurrences) {
      if (count < 3) continue;
      const co = entityMap.get(coName);
      if (!co || co.type === e.type) continue;
      if (co.mentions < 3) continue;

      const key = [e.name, coName].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      pairs.push({ a: e, b: co, count });
    }
  }

  pairs.sort((x, y) => y.count - x.count);
  const now = new Date().toISOString();

  return pairs.slice(0, 10).map(({ a, b, count }) => {
    const negSentiment = a.sentiment <= -0.3 || b.sentiment <= -0.3;
    const severity: SignalSeverity = negSentiment
      ? "critical"
      : count >= 6
        ? "warning"
        : "advisory";

    return {
      id: `novel_cooccurrence-${[a.name, b.name].sort().join(",")}`,
      type: "novel_cooccurrence" as const,
      severity,
      title: `CO-OCCURRENCE: ${a.name} + ${b.name}`,
      description: `${a.type} "${a.name}" and ${b.type} "${b.name}" co-mentioned ${count} times. Cross-type linkage may indicate emerging nexus.`,
      entities: [a.name, b.name],
      confidence: Math.min(1, count / 8),
      detectedAt: now,
      metric: count,
    };
  });
}

function detectEscalationPatterns(
  entities: ExtractedEntity[]
): Signal[] {
  const signals: Signal[] = [];
  const now = new Date().toISOString();

  for (const e of entities) {
    if (e.mentions < 4) continue;

    const critWarn =
      (e.urgencyBreakdown.critical || 0) +
      (e.urgencyBreakdown.warning || 0);
    const ratio = critWarn / e.mentions;

    if (ratio < 0.5) continue;

    const severity: SignalSeverity =
      ratio >= 0.8 || (e.urgencyBreakdown.critical || 0) >= 5
        ? "critical"
        : ratio >= 0.6
          ? "warning"
          : "advisory";

    signals.push({
      id: `escalation-${e.name}`,
      type: "escalation",
      severity,
      title: `ESCALATION: ${e.name}`,
      description: `${Math.round(ratio * 100)}% of ${e.mentions} mentions are critical/warning urgency. Predominantly high-threat coverage.`,
      entities: [e.name],
      confidence: ratio,
      detectedAt: now,
      metric: ratio * e.mentions,
    });
  }

  return signals;
}

export function detectSignals(
  entities: ExtractedEntity[],
  items: FeedItem[]
): Signal[] {
  // Build item → category lookup once
  const itemCategoryMap = new Map<string, string>();
  for (const item of items) {
    itemCategoryMap.set(item.id, item.sourceCategory);
  }

  const all = [
    ...detectSurges(entities),
    ...detectSentimentDeteriorations(entities),
    ...detectCrossCategoryConvergence(entities, itemCategoryMap),
    ...detectNovelCooccurrences(entities),
    ...detectEscalationPatterns(entities),
  ];

  // Deduplicate by id, keep higher confidence
  const byId = new Map<string, Signal>();
  for (const s of all) {
    const existing = byId.get(s.id);
    if (!existing || s.confidence > existing.confidence) {
      byId.set(s.id, s);
    }
  }

  // Sort: severity → confidence → metric
  return Array.from(byId.values()).sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.metric - a.metric;
  });
}
