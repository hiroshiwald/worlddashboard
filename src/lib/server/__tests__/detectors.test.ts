import { describe, it, expect } from "vitest";
import {
  scoreSurge,
  scoreFirstSeenNovelty,
  scoreNovelEdge,
  scoreCrossCategory,
  scoreSentimentDeterioration,
  isBootstrapCohort,
  runDetectors,
} from "../detectors";
import { DEFAULTS } from "../settings";
import type { Sql, SqlRow } from "../db";

describe("scoreSurge", () => {
  it("flat history (observed == baseline) never fires", () => {
    expect(scoreSurge(10, 10, 14, 3)).toBeNull();
  });

  it("10x spike fires critical with the correct z", () => {
    // observed=50, baseline=5: z = (50-5)/sqrt(6) ≈ 18.371
    const result = scoreSurge(50, 5, 14, 3);
    expect(result).not.toBeNull();
    expect(result!.z).toBeCloseTo(18.371, 3);
    expect(result!.severity).toBe("critical");
    expect(result!.confidence).toBe(1); // min(1, 18.371/6)
  });

  it("skips entities with fewer than 3 days of baseline history (cold start)", () => {
    expect(scoreSurge(50, 5, 2, 3)).toBeNull();
  });

  it("does not fire below the k threshold", () => {
    // observed=8, baseline=5: z = 3/sqrt(6) ≈ 1.2247, k=3
    expect(scoreSurge(8, 5, 14, 3)).toBeNull();
  });

  it("fires advisory just at the k threshold", () => {
    // Choose baseline=5 (sqrt(6)≈2.449); k=3 => need z in [3, 4.5)
    // observed=13: z = 8/2.449 ≈ 3.266
    const result = scoreSurge(13, 5, 14, 3);
    expect(result!.severity).toBe("advisory");
  });

  it("fires warning at 1.5k", () => {
    // baseline=5, need z in [4.5, 6): observed=16 => z=11/2.449≈4.49 (just under) try observed=17 => 12/2.449≈4.899
    const result = scoreSurge(17, 5, 14, 3);
    expect(result!.severity).toBe("warning");
  });
});

describe("scoreFirstSeenNovelty", () => {
  it("does not fire with fewer than 2 distinct sources", () => {
    expect(scoreFirstSeenNovelty(1)).toBeNull();
  });

  it("fires warning at 2-3 sources", () => {
    expect(scoreFirstSeenNovelty(2)!.severity).toBe("warning");
    expect(scoreFirstSeenNovelty(3)!.severity).toBe("warning");
  });

  it("fires critical at >=4 sources, confidence capped at 1", () => {
    expect(scoreFirstSeenNovelty(4)).toEqual({ severity: "critical", confidence: 1 });
    expect(scoreFirstSeenNovelty(8)).toEqual({ severity: "critical", confidence: 1 });
  });
});

describe("scoreNovelEdge", () => {
  it("does not fire below 2 articles", () => {
    expect(scoreNovelEdge(1)).toBeNull();
  });

  it("fires warning at 2-3 articles", () => {
    expect(scoreNovelEdge(2)).toEqual({ severity: "warning", confidence: 0.5 });
    expect(scoreNovelEdge(3)).toEqual({ severity: "warning", confidence: 0.75 });
  });

  it("fires critical at >=4 articles", () => {
    expect(scoreNovelEdge(4)).toEqual({ severity: "critical", confidence: 1 });
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

describe("runDetectors query shape", () => {
  it("only queries tracked entities and cluster-head articles", async () => {
    const queries: string[] = [];
    const sql = makeMockSql((query) => {
      queries.push(query);
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
      expect(q).toContain("dup_group_id IS NULL");
    }
  });

  it("returns no signals when every panel is empty", async () => {
    const sql = makeMockSql(() => []);
    const signals = await runDetectors(sql, DEFAULTS);
    expect(signals).toEqual([]);
  });
});
