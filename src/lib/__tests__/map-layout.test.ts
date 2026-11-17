import { describe, it, expect } from "vitest";
import { placeLabels, sideLabel } from "../map-layout";
import type { LabelItem } from "../map-layout";

describe("placeLabels", () => {
  const item = (key: string, x: number, y: number, busy = 0): LabelItem => ({ key, x, y, r: 8, text: "Label", busy });

  it("returns empty for no items", () => {
    expect(placeLabels([], [], 1000)).toEqual({});
  });

  it("puts a lone label on the right", () => {
    expect(placeLabels([item("a", 500, 100)], [], 1000).a.anchor).toBe("start");
  });

  it("moves left when the right side is blocked", () => {
    const blocker = { x: 510, y: 90, w: 60, h: 20 };
    expect(placeLabels([item("a", 500, 100)], [blocker], 1000).a.anchor).toBe("end");
  });

  it("avoids the page edge", () => {
    expect(placeLabels([item("a", 990, 100)], [], 1000).a.anchor).not.toBe("start");
  });

  it("gives crowded neighbors different sides", () => {
    const out = placeLabels([item("a", 500, 100, 5), item("b", 530, 100, 1)], [], 1000);
    expect(out.a).not.toEqual(out.b);
  });

  it("keeps the label off a large neighbouring bubble", () => {
    const big: LabelItem = { key: "big", x: 580, y: 100, r: 60, text: "Big", busy: 0 };
    const out = placeLabels([item("a", 500, 100, 5), big], [], 1000);
    expect(out.a.anchor).not.toBe("start");
  });

  it("picks the one free side when three are blocked", () => {
    const wall = [
      { x: 505, y: 90, w: 60, h: 20 },
      { x: 430, y: 90, w: 65, h: 20 },
      { x: 470, y: 70, w: 60, h: 20 },
    ];
    const out = placeLabels([item("a", 500, 100)], wall, 1000);
    expect(out.a.anchor).toBe("middle");
    expect(out.a.dy).toBeGreaterThan(0);
  });
});

describe("sideLabel", () => {
  it("covers each direction", () => {
    expect(sideLabel(0, 8, false).anchor).toBe("start");
    expect(sideLabel(Math.PI, 8, false).anchor).toBe("end");
    expect(sideLabel(-Math.PI / 2, 8, false).dy).toBeLessThan(0);
    expect(sideLabel(Math.PI / 2, 8, false).dy).toBeGreaterThan(0);
    expect(sideLabel(0, 8, true)).toEqual({ dx: 0, dy: 22, anchor: "middle" });
  });
});
