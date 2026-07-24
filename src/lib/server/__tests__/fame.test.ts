import { describe, it, expect } from "vitest";
import {
  isDictionaryFamous,
  isBreadthFamous,
  computeFameVolumeThreshold,
  isVolumeFamous,
  isFamous,
  loadLifetimeSourceBreadth,
  computeWikiFameVerdict,
  FAME_PAGEVIEWS_THRESHOLD,
  FAME_SITELINKS_THRESHOLD,
  FAME_SITELINKS_CORROBORATION_PAGEVIEWS,
} from "../fame";
import type { Sql, SqlRow } from "../db";

describe("isDictionaryFamous", () => {
  it("is famous via a canonical name matching a dictionary entry", () => {
    expect(isDictionaryFamous(["Russia"])).toBe(true);
  });

  it("is famous via an alias matching a dictionary entry", () => {
    expect(isDictionaryFamous(["Obscure Co", "Kremlin"])).toBe(true);
  });

  it("is case-insensitive, matching isDictionaryTerm's own contract", () => {
    expect(isDictionaryFamous(["russia"])).toBe(true);
  });

  it("is not famous when no name form matches any dictionary entry", () => {
    expect(isDictionaryFamous(["Acme Corp", "Acme"])).toBe(false);
  });
});

describe("isBreadthFamous", () => {
  it("is not famous at 11 distinct lifetime sources", () => {
    expect(isBreadthFamous(11)).toBe(false);
  });

  it("is famous at 12 distinct lifetime sources (boundary, inclusive)", () => {
    expect(isBreadthFamous(12)).toBe(true);
  });
});

describe("computeFameVolumeThreshold", () => {
  it("returns Infinity for an empty population, so nobody can be volume-famous", () => {
    expect(computeFameVolumeThreshold([])).toBe(Infinity);
  });

  it("floors at 3 even when the 75th percentile computes below it", () => {
    expect(computeFameVolumeThreshold([1, 1, 1, 1])).toBe(3);
  });

  it("hand-checked: exact-index case, no interpolation (n=5, rank=3.0)", () => {
    const values = [1, 2, 3, 10, 20];
    expect(computeFameVolumeThreshold(values)).toBe(10);
  });

  it("hand-checked: interpolated case (n=4, rank=2.25)", () => {
    const values = [1, 2, 10, 20];
    // sorted[2] + 0.25*(sorted[3]-sorted[2]) = 10 + 0.25*10 = 12.5
    expect(computeFameVolumeThreshold(values)).toBeCloseTo(12.5, 5);
  });
});

describe("isVolumeFamous", () => {
  it("a zero baseline is never volume-famous, even against a zero threshold", () => {
    expect(isVolumeFamous(0, 0)).toBe(false);
  });

  it("a negative baseline is never volume-famous", () => {
    expect(isVolumeFamous(-1, 0)).toBe(false);
  });

  it("is inclusive at the threshold boundary", () => {
    expect(isVolumeFamous(3, 3)).toBe(true);
    expect(isVolumeFamous(2.9, 3)).toBe(false);
  });

  it("nobody clears an Infinity threshold (empty-population guard, end to end)", () => {
    expect(isVolumeFamous(1000, Infinity)).toBe(false);
  });
});

describe("isFamous", () => {
  it("is famous by the dictionary prong alone — the candidate-path reduction (zero baseline/breadth)", () => {
    expect(isFamous({ names: ["Russia"], baselineDaily: 0, sourceBreadth: 0, storedFame: "unknown" }, 3)).toBe(true);
  });

  it("is famous by the breadth prong alone", () => {
    expect(isFamous({ names: ["Acme"], baselineDaily: 0, sourceBreadth: 12, storedFame: "unknown" }, 3)).toBe(true);
  });

  it("is famous by the volume prong alone", () => {
    expect(isFamous({ names: ["Acme"], baselineDaily: 5, sourceBreadth: 0, storedFame: "unknown" }, 3)).toBe(true);
  });

  it("is not famous when every prong fails", () => {
    expect(isFamous({ names: ["Acme"], baselineDaily: 1, sourceBreadth: 2, storedFame: "unknown" }, 3)).toBe(false);
  });

  it("a non-dictionary candidate (zero baseline, zero breadth) is never famous", () => {
    const facts = { names: ["Some New Person", "some new person"], baselineDaily: 0, sourceBreadth: 0, storedFame: "unknown" as const };
    expect(isFamous(facts, 3)).toBe(false);
  });

  it("stored famous overrides every heuristic prong being negative", () => {
    const facts = { names: ["Some New Person"], baselineDaily: 1, sourceBreadth: 2, storedFame: "famous" as const };
    expect(isFamous(facts, 3)).toBe(true);
  });

  it("stored not_famous does NOT veto a heuristic prong that fires — the stored verdict only ever tightens, never loosens", () => {
    const facts = { names: ["Russia"], baselineDaily: 0, sourceBreadth: 0, storedFame: "not_famous" as const };
    expect(isFamous(facts, 3)).toBe(true);
  });

  it("stored unknown changes nothing, exactly as if the layer didn't exist", () => {
    const famousByDictionary = { names: ["Russia"], baselineDaily: 0, sourceBreadth: 0, storedFame: "unknown" as const };
    const notFamous = { names: ["Acme"], baselineDaily: 1, sourceBreadth: 2, storedFame: "unknown" as const };
    expect(isFamous(famousByDictionary, 3)).toBe(true);
    expect(isFamous(notFamous, 3)).toBe(false);
  });
});

describe("computeWikiFameVerdict", () => {
  it("no Wikidata match at all -> not_famous, regardless of sitelinks/pageviews", () => {
    expect(computeWikiFameVerdict({ matched: false, sitelinks: 1000, medianMonthlyPageviews: 1_000_000 })).toBe("not_famous");
  });

  it("pageviews boundary: 19,999 is not famous, 20,000 is famous (sitelinks irrelevant)", () => {
    expect(computeWikiFameVerdict({ matched: true, sitelinks: 0, medianMonthlyPageviews: FAME_PAGEVIEWS_THRESHOLD - 1 })).toBe("not_famous");
    expect(computeWikiFameVerdict({ matched: true, sitelinks: 0, medianMonthlyPageviews: FAME_PAGEVIEWS_THRESHOLD })).toBe("famous");
  });

  it("sitelinks boundary WITH pageview corroboration: 24 sitelinks is not famous, 25 is famous", () => {
    expect(
      computeWikiFameVerdict({ matched: true, sitelinks: FAME_SITELINKS_THRESHOLD - 1, medianMonthlyPageviews: FAME_SITELINKS_CORROBORATION_PAGEVIEWS }),
    ).toBe("not_famous");
    expect(
      computeWikiFameVerdict({ matched: true, sitelinks: FAME_SITELINKS_THRESHOLD, medianMonthlyPageviews: FAME_SITELINKS_CORROBORATION_PAGEVIEWS }),
    ).toBe("famous");
  });

  it("sitelinks boundary WITHOUT pageview corroboration: even 100 sitelinks stays not_famous at zero prior views", () => {
    expect(computeWikiFameVerdict({ matched: true, sitelinks: 100, medianMonthlyPageviews: 0 })).toBe("not_famous");
  });

  it("sitelinks >=25 with corroboration just under 3,000 is not famous", () => {
    expect(
      computeWikiFameVerdict({ matched: true, sitelinks: FAME_SITELINKS_THRESHOLD, medianMonthlyPageviews: FAME_SITELINKS_CORROBORATION_PAGEVIEWS - 1 }),
    ).toBe("not_famous");
  });

  it("neither prong fires -> not_famous even with a real match", () => {
    expect(computeWikiFameVerdict({ matched: true, sitelinks: 1, medianMonthlyPageviews: 1 })).toBe("not_famous");
  });
});

describe("loadLifetimeSourceBreadth", () => {
  it("returns an empty map for an empty id set, without querying", async () => {
    const sql = (async () => {
      throw new Error("must not query with an empty id set");
    }) as Sql;
    expect(await loadLifetimeSourceBreadth(sql, [])).toEqual(new Map());
  });

  it("maps each entity id to its distinct lifetime source count", async () => {
    const sql = (async () =>
      [
        { entity_id: 1, source_breadth: 11 },
        { entity_id: 2, source_breadth: 12 },
      ] as SqlRow[]) as Sql;
    const result = await loadLifetimeSourceBreadth(sql, [1, 2]);
    expect(result.get(1)).toBe(11);
    expect(result.get(2)).toBe(12);
  });

  it("queries with no dup_group_id filter and no time window (lifetime, every outlet)", async () => {
    let capturedQuery = "";
    const sql = (async (strings: TemplateStringsArray) => {
      capturedQuery = strings.join(" ? ");
      return [];
    }) as Sql;
    await loadLifetimeSourceBreadth(sql, [1]);
    expect(capturedQuery).not.toContain("dup_group_id");
    expect(capturedQuery).not.toContain("INTERVAL");
  });
});
