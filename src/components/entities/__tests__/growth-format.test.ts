import { describe, it, expect } from "vitest";
import { growthChipText, sparklinePoints, nextRowIndex } from "../growth-format";

const base = { ratio: 4.25, ratioText: "4.3", daily: [] as number[] };

describe("growthChipText", () => {
  it("shows warming up with no ratio", () => {
    expect(growthChipText({ ...base, state: "WarmingUp" })).toBe("warming up");
  });

  it("shows the ratio via ratioText", () => {
    expect(growthChipText({ ...base, state: "Rising" })).toBe("▲ ×4.3");
    expect(growthChipText({ ...base, state: "Falling", ratio: 0.2 })).toBe("▼ ×0.2");
    expect(growthChipText({ ...base, state: "Steady", ratio: 1 })).toBe("● ×1.0");
  });

  it("caps at 10+", () => {
    expect(growthChipText({ ...base, state: "Rising", ratio: 55 })).toBe("▲ ×10+");
  });

  it("labels a new entity", () => {
    expect(growthChipText({ ...base, state: "New" })).toBe("New");
  });
});

describe("sparklinePoints", () => {
  it("scales to the max and puts the peak at the top", () => {
    expect(sparklinePoints([0, 5, 10], 20, 10)).toBe("0.0,10.0 10.0,5.0 20.0,0.0");
  });

  it("draws an all-zero series on the baseline", () => {
    expect(sparklinePoints([0, 0], 10, 10)).toBe("0.0,10.0 10.0,10.0");
  });

  it("returns empty for fewer than two points", () => {
    expect(sparklinePoints([3], 10, 10)).toBe("");
  });
});

describe("nextRowIndex", () => {
  it("moves and clamps at both ends", () => {
    expect(nextRowIndex(0, "ArrowDown", 3)).toBe(1);
    expect(nextRowIndex(2, "ArrowDown", 3)).toBe(2);
    expect(nextRowIndex(1, "ArrowUp", 3)).toBe(0);
    expect(nextRowIndex(0, "ArrowUp", 3)).toBe(0);
  });

  it("ignores other keys and empty lists", () => {
    expect(nextRowIndex(0, "a", 3)).toBeNull();
    expect(nextRowIndex(0, "ArrowDown", 0)).toBeNull();
  });
});
