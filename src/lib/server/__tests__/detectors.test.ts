import { describe, it, expect } from "vitest";
import {
  scoreSurge,
  scoreFirstSeenNovelty,
  scoreNovelEdge,
  scoreCrossCategory,
  scoreSentimentDeterioration,
  isBootstrapCohort,
  computeWarmupState,
  computeEffectiveBaselineDays,
  runDetectors,
} from "../detectors";
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

describe("scoreCrossCategory", () => {
  it("does not fire below 3 categories", () => {
    expect(scoreCrossCategory(2)).toBeNull();
  });

  it("advisory at 3, warning at 4, critical at >=5", () => {
    expect(scoreCrossCategory(3)!.severity).toBe("advisory");
    expect(scoreCrossCategory(4)!.severity).toBe("warning");
    expect(scoreCrossCategory(5)!.severity).toBe("critical");
    expect(scoreCrossCategory(6)!.severity).toBe("critical");
  });
});

describe("scoreSentimentDeterioration", () => {
  it("does not fire below 5 mentions", () => {
    expect(scoreSentimentDeterioration(4, -0.9)).toBeNull();
  });

  it("does not fire above the -0.3 threshold", () => {
    expect(scoreSentimentDeterioration(10, -0.2)).toBeNull();
  });

  it("fires warning between -0.3 and -0.6, or below -0.6 with <10 mentions", () => {
    expect(scoreSentimentDeterioration(5, -0.4)!.severity).toBe("warning");
    expect(scoreSentimentDeterioration(9, -0.7)!.severity).toBe("warning");
  });

  it("fires critical at <=-0.6 with >=10 mentions", () => {
    expect(scoreSentimentDeterioration(10, -0.6)!.severity).toBe("critical");
    expect(scoreSentimentDeterioration(12, -0.8)!.severity).toBe("critical");
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
});
