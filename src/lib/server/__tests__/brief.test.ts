import { describe, it, expect } from "vitest";
import { computeStoryScore } from "../brief";

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
