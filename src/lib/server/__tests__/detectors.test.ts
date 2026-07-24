import { describe, it, expect } from "vitest";
import {
  scoreSurge,
  scoreFirstSeenNovelty,
  scoreNovelEdge,
  scoreCategorySpread,
  scoreSentimentDelta,
  isBootstrapCohort,
  computeWarmupState,
  computeEffectiveBaselineDays,
  runDetectors,
} from "../detectors";
import type { CandidateSignal } from "../detectors";
import { DEFAULTS } from "../settings";
import type { Sql, SqlRow } from "../db";

describe("scoreSurge", () => {
  it("flat history (observed == baseline) never fires", () => {
    expect(scoreSurge(10, 10, 14, 3, 14)).toBeNull();
  });

  it("10x spike fires critical with the correct z", () => {
    // observed=50, baseline=5: z = (50-5)/sqrt(6) ≈ 18.371
    const result = scoreSurge(50, 5, 14, 3, 14);
    expect(result).not.toBeNull();
    expect(result!.z).toBeCloseTo(18.371, 3);
    expect(result!.severity).toBe("critical");
    expect(result!.confidence).toBe(1); // min(1, 18.371/6)
  });

  it("skips entities with fewer than 3 days of baseline history (cold start)", () => {
    expect(scoreSurge(50, 5, 2, 3, 14)).toBeNull();
  });

  it("does not fire below the k threshold", () => {
    // observed=8, baseline=5: z = 3/sqrt(6) ≈ 1.2247, k=3
    expect(scoreSurge(8, 5, 14, 3, 14)).toBeNull();
  });

  it("fires advisory just at the k threshold", () => {
    // Choose baseline=5 (sqrt(6)≈2.449); k=3 => need z in [3, 4.5)
    // observed=13: z = 8/2.449 ≈ 3.266
    const result = scoreSurge(13, 5, 14, 3, 14);
    expect(result!.severity).toBe("advisory");
  });

  it("fires warning at 1.5k", () => {
    // baseline=5, need z in [4.5, 6): observed=16 => z=11/2.449≈4.49 (just under) try observed=17 => 12/2.449≈4.899
    const result = scoreSurge(17, 5, 14, 3, 14);
    expect(result!.severity).toBe("warning");
  });

  it("skips a system under MIN_DAYS_SINCE_EPOCH days old, even with a valid baseline (warm-up defense-in-depth)", () => {
    expect(scoreSurge(50, 5, 14, 3, 3)).toBeNull();
    expect(scoreSurge(50, 5, 14, 3, 4)).not.toBeNull();
  });
});

describe("scoreFirstSeenNovelty", () => {
  it("does not fire with fewer than 2 distinct sources", () => {
    expect(scoreFirstSeenNovelty(1)).toBeNull();
  });

  it("fires warning below the critical threshold (2-7 sources)", () => {
    expect(scoreFirstSeenNovelty(2)!.severity).toBe("warning");
    expect(scoreFirstSeenNovelty(7)!.severity).toBe("warning");
  });

  it("fires critical at >=8 sources, confidence capped at 1", () => {
    expect(scoreFirstSeenNovelty(8)).toEqual({ severity: "critical", confidence: 1 });
    expect(scoreFirstSeenNovelty(16)).toEqual({ severity: "critical", confidence: 1 });
  });

  it("confidence scales as sources/8 below the cap", () => {
    expect(scoreFirstSeenNovelty(2)!.confidence).toBeCloseTo(0.25, 5);
    expect(scoreFirstSeenNovelty(4)!.confidence).toBeCloseTo(0.5, 5);
  });
});

describe("scoreNovelEdge", () => {
  it("does not fire below 2 articles", () => {
    expect(scoreNovelEdge(1)).toBeNull();
  });

  it("fires warning below the critical threshold (2-5 articles)", () => {
    expect(scoreNovelEdge(2)!.severity).toBe("warning");
    expect(scoreNovelEdge(2)!.confidence).toBeCloseTo(1 / 3, 5);
    expect(scoreNovelEdge(5)!.severity).toBe("warning");
    expect(scoreNovelEdge(5)!.confidence).toBeCloseTo(5 / 6, 5);
  });

  it("fires critical at >=6 articles, confidence capped at 1", () => {
    expect(scoreNovelEdge(6)).toEqual({ severity: "critical", confidence: 1 });
    expect(scoreNovelEdge(12)).toEqual({ severity: "critical", confidence: 1 });
  });
});

describe("computeWarmupState", () => {
  const epoch = new Date("2026-07-01T00:00:00Z");

  it("is active with no epoch at all (no articles observed yet)", () => {
    expect(computeWarmupState(null, 7, new Date())).toEqual({ active: true, daysRemaining: 7 });
  });

  it("is still active 6.9 days after epoch (detectors stay silent)", () => {
    const now = new Date(epoch.getTime() + 6.9 * 24 * 3600 * 1000);
    expect(computeWarmupState(epoch, 7, now).active).toBe(true);
  });

  it("has cleared 7.1 days after epoch (detectors go active)", () => {
    const now = new Date(epoch.getTime() + 7.1 * 24 * 3600 * 1000);
    expect(computeWarmupState(epoch, 7, now).active).toBe(false);
  });
});

describe("computeEffectiveBaselineDays", () => {
  it("computes the correct effective baseline days and resulting daily rate (λ denominator math)", () => {
    expect(computeEffectiveBaselineDays(14)).toBe(13);
    expect(130 / computeEffectiveBaselineDays(14)).toBe(10);
  });

  it("clamps to a minimum of 1 effective day", () => {
    expect(computeEffectiveBaselineDays(1)).toBe(1);
    expect(computeEffectiveBaselineDays(0)).toBe(1);
  });

  it("clamps to the 14-day baseline window ceiling", () => {
    expect(computeEffectiveBaselineDays(100)).toBe(14);
  });
});

describe("scoreCategorySpread", () => {
  it("skips entities with fewer than 3 active baseline days (cold start)", () => {
    expect(scoreCategorySpread(5, 2, 2)).toBeNull();
  });

  it("does not fire below 4 categories in the 24h window, regardless of excess", () => {
    expect(scoreCategorySpread(3, 0, 5)).toBeNull();
  });

  it("does not fire when excess (24h count - baseline avg) is below 2", () => {
    expect(scoreCategorySpread(4, 3, 5)).toBeNull(); // excess = 1
  });

  it("does not fire for a prominent entity whose 24h count matches its own steady baseline", () => {
    // The Iran/cross-category failure mode: high absolute count, zero excess.
    expect(scoreCategorySpread(6, 6, 14)).toBeNull();
  });

  it("advisory at excess=2, warning at excess=3, critical at excess>=4", () => {
    expect(scoreCategorySpread(4, 2, 5)).toEqual({ excess: 2, severity: "advisory", confidence: 0.5 });
    expect(scoreCategorySpread(5, 2, 5)).toEqual({ excess: 3, severity: "warning", confidence: 0.75 });
    expect(scoreCategorySpread(6, 2, 5)).toEqual({ excess: 4, severity: "critical", confidence: 1 });
  });

  it("confidence caps at 1 for excess beyond 4", () => {
    expect(scoreCategorySpread(8, 2, 5)!.confidence).toBe(1); // excess = 6
  });
});

describe("scoreSentimentDelta", () => {
  it("does not fire below 5 mentions in the 24h window", () => {
    expect(scoreSentimentDelta(4, -0.9, 0, 5, 20)).toBeNull();
  });

  it("skips entities with fewer than 3 baseline days", () => {
    expect(scoreSentimentDelta(10, -0.5, 0, 2, 20)).toBeNull();
  });

  it("skips entities with fewer than 10 baseline mentions", () => {
    expect(scoreSentimentDelta(10, -0.5, 0, 5, 9)).toBeNull();
  });

  it("an always-negative entity with a stable tone does not fire (delta ~= 0)", () => {
    // The Black Sea/sentiment failure mode: very negative absolute level, no real shift.
    expect(scoreSentimentDelta(10, -0.6, -0.6, 5, 20)).toBeNull();
  });

  it("a neutral entity dropping 0.4 from its own baseline fires warning", () => {
    const result = scoreSentimentDelta(10, -0.4, 0, 5, 20);
    expect(result).toEqual({ delta: -0.4, severity: "warning", confidence: 0.8 });
  });

  it("fires at the -0.3 delta threshold boundary (inclusive)", () => {
    expect(scoreSentimentDelta(10, -0.3, 0, 5, 20)).not.toBeNull();
  });

  it("does not fire above (less negative than) the -0.3 delta threshold", () => {
    expect(scoreSentimentDelta(10, -0.29, 0, 5, 20)).toBeNull();
  });

  it("fires critical when delta <= -0.5 and mentions24h >= 10", () => {
    const result = scoreSentimentDelta(10, -0.7, -0.1, 5, 20);
    expect(result).toEqual({ delta: -0.6, severity: "critical", confidence: 1 });
  });

  it("stays warning at delta <= -0.5 if mentions24h < 10", () => {
    expect(scoreSentimentDelta(5, -0.7, -0.1, 5, 20)!.severity).toBe("warning");
  });
});

describe("isBootstrapCohort", () => {
  const globalMin = new Date("2026-07-01T00:00:00Z");

  it("suppresses an entity first seen within 72h of the global minimum", () => {
    expect(isBootstrapCohort(new Date("2026-07-01T00:00:00Z"), globalMin)).toBe(true);
    expect(isBootstrapCohort(new Date("2026-07-03T23:59:00Z"), globalMin)).toBe(true);
  });

  it("does not suppress an entity first seen after the 72h bootstrap window", () => {
    expect(isBootstrapCohort(new Date("2026-07-05T00:00:00Z"), globalMin)).toBe(false);
  });
});

function makeMockSql(handler: (query: string, values: unknown[]) => SqlRow[]): Sql {
  return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    return handler(strings.join(" ? "), values);
  }) as Sql;
}

// A system epoch comfortably past warmup_days, so first_seen/novel_edge (and
// their query paths) actually run instead of being warm-up-skipped —
// otherwise this file's queries-array assertions below would only ever see
// the unconditional panel queries.
function pastEpochRow(): SqlRow {
  return { min_first_seen: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() };
}

describe("runDetectors query shape", () => {
  it("only queries tracked entities and cluster-head articles", async () => {
    const queries: string[] = [];
    const sql = makeMockSql((query) => {
      queries.push(query);
      if (query.includes("MIN(first_seen_at)") && query.includes("FROM articles")) return [pastEpochRow()];
      return [];
    });

    await runDetectors(sql, DEFAULTS);

    const entityQueries = queries.filter((q) => q.includes("FROM entities"));
    expect(entityQueries.length).toBeGreaterThan(0);
    for (const q of entityQueries) {
      if (q.includes("MIN(first_seen_at)")) continue;
      expect(q).toContain("status = 'tracked'");
    }

    const articleQueries = queries.filter((q) => q.includes("FROM articles") || q.includes("JOIN articles"));
    for (const q of articleQueries) {
      // The system-epoch query is deliberately unscoped by dup_group_id — it
      // wants the earliest arrival ever, duplicate members included.
      if (q.includes("MIN(first_seen_at)")) continue;
      expect(q).toContain("dup_group_id IS NULL");
    }
  });

  it("returns no signals when every panel is empty and no epoch exists yet (warm-up, no articles)", async () => {
    const sql = makeMockSql(() => []);
    const signals = await runDetectors(sql, DEFAULTS);
    expect(signals).toEqual([]);
  });

  it("returns no signals when every panel is empty even once warm-up has cleared", async () => {
    const sql = makeMockSql((query) => {
      if (query.includes("MIN(first_seen_at)") && query.includes("FROM articles")) return [pastEpochRow()];
      return [];
    });
    const signals = await runDetectors(sql, DEFAULTS);
    expect(signals).toEqual([]);
  });

  it("all detectors stay silent during warm-up, and no history-dependent query runs at all", async () => {
    const sql = makeMockSql((query) => {
      if (query.includes("MIN(first_seen_at)") && query.includes("FROM articles")) {
        return [{ min_first_seen: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString() }];
      }
      throw new Error(`unexpected query during warm-up: ${query}`);
    });
    const signals = await runDetectors(sql, DEFAULTS);
    expect(signals).toEqual([]);
  });
});

// ---- L2A: novel-edge fame suppression ----
//
// Same query-substring routing convention as makeMockSql above, extended
// with the additional query shapes a full runDetectors call exercises once
// every detector actually fires (rather than the empty/warm-up panels
// above). "aliases_a"/"source_breadth" are new substrings introduced by
// this change (loadRecentNovelEdges's added alias columns, fame.ts's
// loadLifetimeSourceBreadth); every other branch matches a pre-existing
// query untouched by it.
const RICH_EPOCH = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
const OLD_FLOOR = new Date(Date.now() - 500 * 3600 * 1000).toISOString();
const RECENT = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
const FIRST_SEEN_RECENT = new Date(Date.now() - 20 * 3600 * 1000).toISOString();

function makeRichMockSql(responses: Partial<Record<string, SqlRow[]>>): Sql {
  return (async (strings: TemplateStringsArray) => {
    const q = strings.join(" ? ");
    if (q.includes("source_breadth")) return responses.breadth ?? [];
    if (q.includes("aliases_a")) return responses.novelEdges ?? [];
    if (q.includes("MIN(ee.first_seen_at)")) return responses.edgeGlobalMin ?? [];
    if (q.includes("v.a AS entity_a, v.b AS entity_b")) return responses.edgeArticles ?? [];
    if (q.includes("MIN(first_seen_at)") && q.includes("FROM articles")) return responses.epoch ?? [];
    if (q.includes("MIN(first_seen_at)") && q.includes("FROM entities")) return responses.entityGlobalMin ?? [];
    if (q.includes("id, canonical_name, first_seen_at")) return responses.newEntities ?? [];
    if (q.includes("a.id AS article_id, a.source_name")) return responses.entityArticles ?? [];
    if (q.includes("id, canonical_name FROM entities")) return responses.entityNames ?? [];
    if (q.includes("FROM entity_mentions_hourly")) return responses.aggRows ?? [];
    // loadCategoryBaseline's own query also contains "a.source_category"
    // (inside its nested COUNT(DISTINCT ...)) — day_categories distinguishes
    // it and must be checked first.
    if (q.includes("day_categories")) return responses.categoryBaseline ?? [];
    if (q.includes("a.source_category")) return responses.articles24h ?? [];
    return [];
  }) as Sql;
}

// One entity per detector type (surge/sentiment/cross_category/first_seen),
// chosen to reproduce the exact numbers this file's own pure-function tests
// already hand-check above (e.g. scoreSurge(50,5,...) -> z=18.371 critical).
function baseRichResponses(): Partial<Record<string, SqlRow[]>> {
  return {
    epoch: [{ min_first_seen: RICH_EPOCH }],
    entityGlobalMin: [{ min_first_seen: OLD_FLOOR }],
    edgeGlobalMin: [{ min_first_seen: OLD_FLOOR }],
    entityNames: [
      { id: 6, canonical_name: "SurgeEntity" },
      { id: 7, canonical_name: "SentimentEntity" },
      { id: 8, canonical_name: "CrossCategoryEntity" },
    ],
    aggRows: [
      { entity_id: 6, observed_24h: 50, sentiment_sum_24h: 0, baseline_sum: 70, baseline_sentiment_sum: 0, baseline_days: 14 },
      { entity_id: 7, observed_24h: 10, sentiment_sum_24h: -4, baseline_sum: 20, baseline_sentiment_sum: 0, baseline_days: 5 },
    ],
    articles24h: ["world", "politics", "business", "tech", "sports"].map((cat, i) => ({
      entity_id: 8,
      article_id: 300 + i,
      source_category: cat,
    })),
    categoryBaseline: [{ entity_id: 8, active_days: 3, avg_categories: 1 }],
    newEntities: [{ id: 9, canonical_name: "FirstSeenEntity", first_seen_at: FIRST_SEEN_RECENT }],
    entityArticles: ["Source A", "Source B", "Source C"].map((name, i) => ({
      entity_id: 9,
      article_id: 400 + i,
      source_name: name,
    })),
  };
}

describe("runDetectors — novel-edge fame suppression (L2A)", () => {
  // Russia/China: real COUNTRY_DICT entries — dictionary-famous with zero
  // baseline/breadth data, proving the dictionary prong alone suffices.
  // QuietOrg*: no dictionary entry, no aggRows row (baseline 0), no breadth
  // mock (0) — never famous by any prong.
  const famousFamousEdge = {
    entity_a: 1, entity_b: 2, name_a: "Russia", name_b: "China",
    aliases_a: [], aliases_b: [], first_seen_at: RECENT, article_count: 2,
  };
  const famousSatelliteEdge = {
    entity_a: 1, entity_b: 3, name_a: "Russia", name_b: "QuietOrgA",
    aliases_a: [], aliases_b: [], first_seen_at: RECENT, article_count: 2,
  };
  const satelliteSatelliteEdge = {
    entity_a: 4, entity_b: 5, name_a: "QuietOrgB", name_b: "QuietOrgC",
    aliases_a: [], aliases_b: [], first_seen_at: RECENT, article_count: 2,
  };
  const edgeArticles = [
    { article_id: 701, entity_a: 1, entity_b: 3 },
    { article_id: 702, entity_a: 1, entity_b: 3 },
    { article_id: 703, entity_a: 4, entity_b: 5 },
    { article_id: 704, entity_a: 4, entity_b: 5 },
  ];

  it("suppresses famous-famous, keeps famous-satellite and satellite-satellite, alongside unaffected surge/sentiment/cross_category/first_seen", async () => {
    const sql = makeRichMockSql({
      ...baseRichResponses(),
      novelEdges: [famousFamousEdge, famousSatelliteEdge, satelliteSatelliteEdge],
      edgeArticles,
    });

    const signals = await runDetectors(sql, DEFAULTS);

    const novelEdgeKeys = signals
      .filter((s) => s.type === "novel_edge")
      .map((s) => s.dedupeKey)
      .sort();
    expect(novelEdgeKeys).toEqual(["novel_edge:1:3", "novel_edge:4:5"]);

    const surge = signals.find((s) => s.dedupeKey === "surge:6");
    expect(surge?.severity).toBe("critical");
    expect(surge?.evidence.z).toBeCloseTo(18.371, 3);

    const sentiment = signals.find((s) => s.dedupeKey === "sentiment:7");
    expect(sentiment?.severity).toBe("warning");
    expect(sentiment?.evidence.delta).toBeCloseTo(-0.4, 5);

    const crossCategory = signals.find((s) => s.dedupeKey === "cross_category:8");
    expect(crossCategory?.severity).toBe("critical");
    expect(crossCategory?.evidence.excess).toBe(4);

    const firstSeen = signals.find((s) => s.dedupeKey === "first_seen:9");
    expect(firstSeen?.severity).toBe("warning");
    expect(firstSeen?.evidence.sourceCount).toBe(3);
  });

  it("surge/sentiment/cross_category/first_seen are byte-identical whether or not a famous-famous novel edge is present", async () => {
    const withoutFamousPair = await runDetectors(
      makeRichMockSql({ ...baseRichResponses(), novelEdges: [famousSatelliteEdge, satelliteSatelliteEdge], edgeArticles }),
      DEFAULTS,
    );
    const withFamousPair = await runDetectors(
      makeRichMockSql({
        ...baseRichResponses(),
        novelEdges: [famousFamousEdge, famousSatelliteEdge, satelliteSatelliteEdge],
        edgeArticles,
      }),
      DEFAULTS,
    );

    const others = (signals: CandidateSignal[]) => signals.filter((s) => s.type !== "novel_edge");
    expect(others(withFamousPair)).toEqual(others(withoutFamousPair));
  });
});
