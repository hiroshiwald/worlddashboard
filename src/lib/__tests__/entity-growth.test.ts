import { describe, it, expect } from "vitest";
import { computeGrowth, ratioText, diversity } from "../entity-growth";
import type { GrowthInput, HourlyCount } from "../entity-growth";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-16T12:00:00.000Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

// One active hour in each of the 14 days: full collection, no gaps.
const ALL_DAYS_ACTIVE = Array.from({ length: 14 }, (_, day) => hoursAgo(day * 24 + 1));

function input(overrides: Partial<GrowthInput>): GrowthInput {
  return { hourly: [], activeHours: ALL_DAYS_ACTIVE, firstSeenAt: hoursAgo(24 * 30), tracked: true, now: NOW, ...overrides };
}

// A count placed `hours` before NOW, for the common case of a single hourly bucket.
function at(hours: number, count: number): HourlyCount {
  return { hourStart: hoursAgo(hours), count };
}

// Prior-window total of `total` over the 11 usual days, giving usualPerDay = total / 11.
function priorTotal(total: number): HourlyCount {
  return at(100, total);
}

describe("computeGrowth windows", () => {
  it("returns zeros and Steady for empty input", () => {
    const result = computeGrowth(input({ hourly: [] }));
    expect(result.recent72h).toBe(0);
    expect(result.usualPerDay).toBe(0);
    expect(result.ratio).toBe(0);
    expect(result.state).toBe("Steady");
    expect(result.daily).toEqual(new Array(14).fill(0));
  });

  it("counts a single recent hour in recent72h and the last day", () => {
    const result = computeGrowth(input({ hourly: [at(1, 5)] }));
    expect(result.recent72h).toBe(5);
    expect(result.daily[13]).toBe(5);
  });

  it("includes an hour exactly 72h old in recent72h and excludes one just older", () => {
    const included = computeGrowth(input({ hourly: [at(72, 4)] }));
    const excluded = computeGrowth(input({
      hourly: [{ hourStart: new Date(hoursAgo(72).getTime() - 1), count: 4 }],
    }));
    expect(included.recent72h).toBe(4);
    expect(excluded.recent72h).toBe(0);
    expect(excluded.usualPerDay).toBeCloseTo(4 / 11);
  });

  it("excludes an hour at exactly now", () => {
    const result = computeGrowth(input({ hourly: [{ hourStart: NOW, count: 7 }] }));
    expect(result.recent72h).toBe(0);
    expect(result.daily).toEqual(new Array(14).fill(0));
  });

  it("includes an hour exactly 336h old and ignores one older", () => {
    const included = computeGrowth(input({ hourly: [at(336, 2)] }));
    const excluded = computeGrowth(input({
      hourly: [{ hourStart: new Date(hoursAgo(336).getTime() - 1), count: 2 }],
    }));
    expect(included.usualPerDay).toBeCloseTo(2 / 11);
    expect(included.daily[0]).toBe(2);
    expect(excluded.usualPerDay).toBe(0);
    expect(excluded.daily.every((n) => n === 0)).toBe(true);
  });

  it("divides the prior-window sum by 11 without flooring", () => {
    const result = computeGrowth(input({ hourly: [priorTotal(5)] }));
    expect(result.usualPerDay).toBeCloseTo(5 / 11);
  });

  it("computes ratio as (recent/3) / max(usualPerDay, 0.3)", () => {
    const result = computeGrowth(input({ hourly: [at(1, 3), priorTotal(11)] }));
    // recent 3 -> 1 per day; usual 1 per day -> ratio 1
    expect(result.ratio).toBeCloseTo(1);
  });

  it("uses the 0.3 floor when usualPerDay is tiny", () => {
    const result = computeGrowth(input({ hourly: [at(1, 3), priorTotal(1)] }));
    // usual = 1/11 (~0.09) -> floor 0.3 -> ratio = 1 / 0.3
    expect(result.ratio).toBeCloseTo(1 / 0.3);
  });

  it("fills daily buckets with 24h boundaries", () => {
    const result = computeGrowth(input({
      hourly: [
        at(1, 1),
        at(24, 2),
        at(25, 4),
        at(48, 8),
        at(336, 16),
      ],
    }));
    expect(result.daily[13]).toBe(3);
    expect(result.daily[12]).toBe(4 + 8);
    expect(result.daily[0]).toBe(16);
  });
});

describe("computeGrowth states", () => {
  it("New: untracked and first seen within 72h", () => {
    const result = computeGrowth(input({
      tracked: false,
      firstSeenAt: hoursAgo(24),
      hourly: [at(1, 9)],
    }));
    expect(result.state).toBe("New");
  });

  it("New takes precedence over Rising", () => {
    const result = computeGrowth(input({
      tracked: false,
      firstSeenAt: hoursAgo(71),
      hourly: [at(1, 30)],
    }));
    expect(result.state).toBe("New");
  });

  it("untracked with firstSeenAt exactly 72h ago is New", () => {
    const result = computeGrowth(input({ tracked: false, firstSeenAt: hoursAgo(72) }));
    expect(result.state).toBe("New");
  });

  it("untracked with firstSeenAt older than 72h is not New", () => {
    const result = computeGrowth(input({ tracked: false, firstSeenAt: hoursAgo(73) }));
    expect(result.state).toBe("Steady");
  });

  it("tracked entity first seen under 72h ago is WarmingUp", () => {
    const result = computeGrowth(input({ tracked: true, firstSeenAt: hoursAgo(48), hourly: [at(1, 9)] }));
    expect(result.state).toBe("WarmingUp");
  });

  it("firstSeenAt null is WarmingUp", () => {
    const result = computeGrowth(input({ tracked: true, firstSeenAt: null }));
    expect(result.state).toBe("WarmingUp");
  });

  it("firstSeenAt null and untracked is WarmingUp, not New", () => {
    const result = computeGrowth(input({ tracked: false, firstSeenAt: null }));
    expect(result.state).toBe("WarmingUp");
  });

  it("firstSeenAt exactly 72h ago for a tracked entity is not WarmingUp", () => {
    const result = computeGrowth(input({ tracked: true, firstSeenAt: hoursAgo(72), hourly: [at(1, 9)] }));
    expect(result.state).toBe("Rising");
  });

  it("Rising: recent >= 3 and ratio >= 3", () => {
    const result = computeGrowth(input({ hourly: [at(1, 9)] }));
    // usual 0 -> ratio = 3 / 0.3 = 10
    expect(result.ratio).toBeCloseTo(10);
    expect(result.state).toBe("Rising");
  });

  it("not Rising when recent is below 3 even with a high ratio", () => {
    const result = computeGrowth(input({ hourly: [at(1, 2)] }));
    expect(result.ratio).toBeCloseTo((2 / 3) / 0.3);
    expect(result.state).toBe("Steady");
  });

  it("not Rising when ratio is below 3", () => {
    const result = computeGrowth(input({ hourly: [at(1, 3), priorTotal(11)] }));
    expect(result.state).toBe("Steady");
  });

  it("Falling: usualPerDay >= 0.5 and ratio < 0.5", () => {
    const result = computeGrowth(input({ hourly: [priorTotal(11)] }));
    expect(result.usualPerDay).toBeCloseTo(1);
    expect(result.state).toBe("Falling");
  });

  it("not Falling when usualPerDay is below 0.5", () => {
    const result = computeGrowth(input({ hourly: [priorTotal(4)] }));
    expect(result.usualPerDay).toBeCloseTo(4 / 11);
    expect(result.state).toBe("Steady");
  });

  it("Falling boundary: usualPerDay exactly 0.5 with ratio 0 is Falling", () => {
    const result = computeGrowth(input({ hourly: [priorTotal(5.5)] }));
    expect(result.usualPerDay).toBeCloseTo(0.5);
    expect(result.state).toBe("Falling");
  });

  it("not Falling when ratio is exactly 0.5", () => {
    // recent 3 -> 1 per day; usual 22 / 11 = 2 per day; ratio = 1 / 2 = 0.5
    const result = computeGrowth(input({ hourly: [at(1, 3), priorTotal(22)] }));
    expect(result.ratio).toBeCloseTo(0.5);
    expect(result.state).toBe("Steady");
  });
});

describe("computeGrowth input validation", () => {
  it("throws on a negative count", () => {
    expect(() => computeGrowth(input({ hourly: [at(1, -1)] }))).toThrow(/count/);
  });

  it("throws on a NaN count", () => {
    expect(() => computeGrowth(input({ hourly: [at(1, Number.NaN)] }))).toThrow(/count/);
  });

  it("throws on an Infinity count", () => {
    expect(() => computeGrowth(input({ hourly: [at(1, Number.POSITIVE_INFINITY)] }))).toThrow(/count/);
  });

  it("throws on an invalid now", () => {
    expect(() => computeGrowth(input({ now: new Date("not a date") }))).toThrow(/now/);
  });

  it("throws on an invalid firstSeenAt", () => {
    expect(() => computeGrowth(input({ firstSeenAt: new Date("nope") }))).toThrow(/firstSeenAt/);
  });

  it("throws on an invalid hourStart", () => {
    expect(() => computeGrowth(input({ hourly: [{ hourStart: new Date("nope"), count: 1 }] }))).toThrow(/hourStart/);
  });
});

describe("ratioText", () => {
  it("formats ratios below 10 to one decimal", () => {
    expect(ratioText(0)).toBe("0.0");
    expect(ratioText(2.345)).toBe("2.3");
    expect(ratioText(9.9)).toBe("9.9");
  });

  it("caps ratios at 10 and above as 10+", () => {
    expect(ratioText(10)).toBe("10+");
    expect(ratioText(25)).toBe("10+");
  });

  it("throws on negative or non-finite ratios", () => {
    expect(() => ratioText(-1)).toThrow(/ratio/);
    expect(() => ratioText(Number.NaN)).toThrow(/ratio/);
    expect(() => ratioText(Number.POSITIVE_INFINITY)).toThrow(/ratio/);
  });
});

describe("diversity", () => {
  it("empty input is No sources", () => {
    expect(diversity([])).toEqual({ count: 0, label: "No sources" });
  });

  it("ignores empty and whitespace-only names", () => {
    expect(diversity(["", "   "])).toEqual({ count: 0, label: "No sources" });
  });

  it("single name is Single source", () => {
    expect(diversity(["Reuters"])).toEqual({ count: 1, label: "Single source" });
  });

  it("trims names before counting distinct ones", () => {
    expect(diversity(["Reuters", " Reuters  "])).toEqual({ count: 1, label: "Single source" });
  });

  it("two distinct names is 2 sources", () => {
    expect(diversity(["Reuters", "AP", ""])).toEqual({ count: 2, label: "2 sources" });
  });

  it("three or more distinct names is Multi-source", () => {
    expect(diversity(["Reuters", "AP", "BBC"])).toEqual({ count: 3, label: "Multi-source" });
    expect(diversity(["A", "B", "C", "D"])).toEqual({ count: 4, label: "Multi-source" });
  });

  it("throws on a non-string name", () => {
    expect(() => diversity([42 as unknown as string])).toThrow(/string/);
  });
});

describe("computeGrowth collection gaps", () => {
  // Active on the 3 recent days and 4 of the 11 usual days (days 10 to 13 ago).
  const gapped = [1, 25, 49, 241, 265, 289, 313].map(hoursAgo);

  it("divides the usual rate by active usual days only", () => {
    const result = computeGrowth(input({ activeHours: gapped, hourly: [at(250, 8), at(10, 6)] }));
    expect(result.baselineDays).toBe(4);
    expect(result.usualPerDay).toBe(2);
    expect(result.ratio).toBe(1);
    expect(result.state).toBe("Steady");
  });

  it("divides the recent rate by active recent days only", () => {
    const recentGap = [1, 100, 150, 200].map(hoursAgo);
    const result = computeGrowth(input({ activeHours: recentGap, hourly: [at(150, 3), at(10, 3)] }));
    expect(result.baselineDays).toBe(3);
    expect(result.ratio).toBe(3);
  });

  it("is WarmingUp with fewer than 3 active usual days", () => {
    const thin = [1, 25, 49, 100, 150].map(hoursAgo);
    const result = computeGrowth(input({ activeHours: thin, hourly: [at(10, 30)] }));
    expect(result.baselineDays).toBe(2);
    expect(result.state).toBe("WarmingUp");
  });

  it("keeps New ahead of a thin baseline", () => {
    const result = computeGrowth(input({ activeHours: [hoursAgo(1)], tracked: false, firstSeenAt: hoursAgo(10) }));
    expect(result.state).toBe("New");
  });

  it("ignores active hours outside the window and rejects bad ones", () => {
    const result = computeGrowth(input({ activeHours: [hoursAgo(400), hoursAgo(-1)] }));
    expect(result.baselineDays).toBe(0);
    expect(() => computeGrowth(input({ activeHours: [new Date("x")] }))).toThrow();
  });
});
