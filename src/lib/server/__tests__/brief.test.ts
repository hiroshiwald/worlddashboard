import { describe, it, expect } from "vitest";
import { computeStoryScore, computeLift, getBrief } from "../brief";
import { DEFAULTS } from "../settings";
import type { Sql, SqlRow } from "../db";

function makeMockSql(handler: (query: string) => SqlRow[]): Sql {
  return (async (strings: TemplateStringsArray) => handler(strings.join(" ? "))) as Sql;
}

describe("computeStoryScore", () => {
  it("hand-checked: clusterSize=3, age=0h", () => {
    // ln(1+3) * e^0 = ln(4) ≈ 1.386294
    expect(computeStoryScore(3, 0)).toBeCloseTo(1.386294, 5);
  });

  it("hand-checked: clusterSize=1, age=24h", () => {
    // ln(2) * e^-1 ≈ 0.6931 * 0.3679 ≈ 0.2550
    expect(computeStoryScore(1, 24)).toBeCloseTo(0.2550, 4);
  });

  it("hand-checked: clusterSize=10, age=48h", () => {
    // ln(11) * e^-2 ≈ 2.3979 * 0.1353 ≈ 0.3245
    expect(computeStoryScore(10, 48)).toBeCloseTo(0.3245, 4);
  });

  it("a bigger cluster at the same age always scores higher", () => {
    expect(computeStoryScore(5, 10)).toBeGreaterThan(computeStoryScore(2, 10));
  });

  it("an older story of the same size always scores lower", () => {
    expect(computeStoryScore(5, 40)).toBeLessThan(computeStoryScore(5, 5));
  });

  it("age 0 applies no decay", () => {
    expect(computeStoryScore(4, 0)).toBeCloseTo(Math.log(5), 10);
  });
});

describe("computeLift", () => {
  it("divides observed by baseline when baseline is above the floor", () => {
    expect(computeLift(20, 5)).toBe(4);
  });

  it("applies the 0.5 floor when baseline is below it", () => {
    // baselineDaily=0.1 would give lift=40; the 0.5 floor caps it at 6.
    expect(computeLift(3, 0.1)).toBe(6);
  });

  it("applies the 0.5 floor when baseline is exactly zero", () => {
    expect(computeLift(4, 0)).toBe(8);
  });

  it("a bigger spike over the same baseline always scores a higher lift", () => {
    expect(computeLift(10, 2)).toBeGreaterThan(computeLift(6, 2));
  });
});

describe("getBrief: movers + warmup", () => {
  it("during warm-up (no epoch yet), movers is empty and warmup reflects the full window", async () => {
    const sql = makeMockSql(() => []);
    const brief = await getBrief(sql, DEFAULTS);
    expect(brief.warmup).toEqual({ active: true, daysRemaining: DEFAULTS.warmup_days });
    expect(brief.movers).toEqual([]);
  });

  it("post-warm-up, ranks movers by lift desc, filters sub-threshold entities, and caps at 5", async () => {
    const oldEpoch = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
    const sql = makeMockSql((query) => {
      if (query.includes("min_first_seen")) return [{ min_first_seen: oldEpoch }];
      if (query.includes("baseline_sum")) {
        return [
          { entity_id: "1", canonical_name: "Alpha", observed_24h: 10, baseline_sum: 20 },
          { entity_id: "2", canonical_name: "Bravo", observed_24h: 30, baseline_sum: 14 },
          { entity_id: "3", canonical_name: "Charlie", observed_24h: 2, baseline_sum: 0 },
        ];
      }
      return [];
    });

    const brief = await getBrief(sql, DEFAULTS);
    expect(brief.warmup.active).toBe(false);
    expect(brief.movers.map((m) => m.name)).toEqual(["Bravo", "Alpha"]);
    expect(brief.movers.find((m) => m.name === "Charlie")).toBeUndefined();
  });

  it("caps movers at 5 even when more entities clear the threshold", async () => {
    const oldEpoch = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
    const sql = makeMockSql((query) => {
      if (query.includes("min_first_seen")) return [{ min_first_seen: oldEpoch }];
      if (query.includes("baseline_sum")) {
        return Array.from({ length: 8 }, (_, i) => ({
          entity_id: String(i), canonical_name: `Entity${i}`, observed_24h: 10 + i, baseline_sum: 14,
        }));
      }
      return [];
    });
    const brief = await getBrief(sql, DEFAULTS);
    expect(brief.movers).toHaveLength(5);
  });
});

describe("getBrief: developments", () => {
  it("response includes developments: [] during warm-up (getDevelopments is not called)", async () => {
    const sql = makeMockSql(() => []);
    const brief = await getBrief(sql, DEFAULTS);
    expect(brief.warmup.active).toBe(true);
    expect(brief.developments).toEqual([]);
  });

  it("response shape is additive: every pre-existing field is unchanged, plus developments", async () => {
    const oldEpoch = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
    const sql = makeMockSql((query) => {
      if (query.includes("min_first_seen")) return [{ min_first_seen: oldEpoch }];
      if (query.includes("baseline_sum")) {
        return [
          { entity_id: "1", canonical_name: "Alpha", observed_24h: 10, baseline_sum: 20 },
          { entity_id: "2", canonical_name: "Bravo", observed_24h: 30, baseline_sum: 14 },
        ];
      }
      return [];
    });

    const brief = await getBrief(sql, DEFAULTS);
    expect(Object.keys(brief).sort()).toEqual([
      "developments", "generatedAt", "movers", "newEntities", "signals", "topStories", "warmup",
    ]);
    // Pre-existing behavior is byte-identical, not just present alongside the new field.
    expect(brief.movers.map((m) => m.name)).toEqual(["Bravo", "Alpha"]);
    expect(brief.developments).toEqual([]);
  });
});
