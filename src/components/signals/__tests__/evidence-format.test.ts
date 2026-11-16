import { describe, it, expect } from "vitest";
import { formatEvidenceNumbers } from "../evidence-format";

describe("formatEvidenceNumbers", () => {
  it("formats surge evidence", () => {
    expect(formatEvidenceNumbers("surge", { observed24h: 42, baselineDaily: 12.345, z: 3.5, k: 2 })).toEqual([
      "observed 24h 42",
      "baseline/day 12.35",
      "z-score 3.50",
      "k 2",
    ]);
  });

  it("formats sentiment evidence", () => {
    expect(formatEvidenceNumbers("sentiment", { avg24h: -0.4, baselineAvg: 0.1, delta: -0.5, mentions24h: 10 })).toEqual([
      "avg sentiment 24h -0.40",
      "baseline sentiment 0.10",
      "delta -0.50",
      "mentions 24h 10",
    ]);
  });

  it("formats cross_category evidence", () => {
    expect(formatEvidenceNumbers("cross_category", { categoryCount24h: 6, baselineAvgCategories: 2.5, excess: 3.5 })).toEqual([
      "categories 24h 6",
      "baseline categories 2.50",
      "excess 3.50",
    ]);
  });

  it("formats first_seen evidence", () => {
    expect(formatEvidenceNumbers("first_seen", { sourceCount: 4, articleIds: [1, 2] })).toEqual(["sources 4"]);
  });

  it("formats novel_edge evidence", () => {
    expect(formatEvidenceNumbers("novel_edge", { articleCount: 3, articleIds: [1, 2, 3] })).toEqual(["articles 3"]);
  });

  it("skips a missing key instead of rendering undefined", () => {
    expect(formatEvidenceNumbers("surge", { observed24h: 42 })).toEqual(["observed 24h 42"]);
  });

  it("skips a non-numeric key instead of rendering NaN", () => {
    expect(formatEvidenceNumbers("surge", { observed24h: "bad", baselineDaily: 10 })).toEqual(["baseline/day 10"]);
  });

  it("returns no lines for an unrecognized type", () => {
    expect(formatEvidenceNumbers("mystery", { foo: 1 })).toEqual([]);
  });

  it("returns no lines for empty evidence", () => {
    expect(formatEvidenceNumbers("surge", {})).toEqual([]);
  });
});
