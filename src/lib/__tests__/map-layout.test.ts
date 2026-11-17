import { describe, it, expect } from "vitest";
import { layoutMap, placeLabels, sideLabel } from "../map-layout";
import type { LayoutUnit, LayoutEdge, LabelItem } from "../map-layout";

const ent = (key: string, group: string): LayoutUnit => ({ key, kind: "e", r: 8, group });
const topic = (key: string, r = 40): LayoutUnit => ({ key, kind: "t", r });

const units: LayoutUnit[] = [
  ent("e:a", "x"), ent("e:b", "x"), ent("e:c", "y"), ent("e:d", "y"),
  topic("t:z"), topic("t:solo", 30), { key: "n:ctx", kind: "n", r: 10 },
];
const edges: LayoutEdge[] = [
  { a: "e:a", b: "e:b", weight: 3 },
  { a: "e:b", b: "e:c", weight: 1 },
  { a: "e:c", b: "e:d", weight: 6 },
  { a: "e:d", b: "t:z", weight: 2 },
];

describe("layoutMap", () => {
  it("returns empty layout for no units", () => {
    expect(layoutMap([], [], 1000)).toEqual({ positions: {}, width: 1000, height: 0 });
  });

  it("places a single unit in the band", () => {
    const out = layoutMap([topic("t:one")], [], 1000);
    expect(Object.keys(out.positions)).toEqual(["t:one"]);
    expect(out.height).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(layoutMap(units, edges, 1000)).toEqual(layoutMap(units, edges, 1000));
  });

  it("keeps every position inside the bounds", () => {
    const out = layoutMap(units, edges, 1000);
    expect(Object.keys(out.positions)).toHaveLength(units.length);
    for (const p of Object.values(out.positions)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(out.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(out.height);
    }
  });

  it("puts unconnected units below connected ones", () => {
    const out = layoutMap(units, edges, 1000);
    expect(out.positions["n:ctx"].y).toBeGreaterThan(out.positions["e:a"].y);
  });

  it("wraps many singles onto several rows", () => {
    const many = Array.from({ length: 12 }, (_, i) => topic(`t:${i}`));
    const out = layoutMap(many, [], 1000);
    const ys = new Set(Object.values(out.positions).map((p) => p.y));
    expect(ys.size).toBeGreaterThan(1);
  });

  it("packs several connected groups into rows", () => {
    const names = ["a", "b", "c", "d"];
    const us = names.flatMap((g) => [ent(`${g}1`, g), ent(`${g}2`, g)]);
    const es = names.map((g) => ({ a: `${g}1`, b: `${g}2`, weight: 1 }));
    const out = layoutMap(us, es, 1000);
    expect(Object.keys(out.positions)).toHaveLength(8);
  });

  it("ignores self edges", () => {
    const out = layoutMap([ent("e:a", "x")], [{ a: "e:a", b: "e:a", weight: 1 }], 1000);
    expect(out.positions["e:a"]).toBeDefined();
  });

  it("throws on bad input", () => {
    expect(() => layoutMap(units, edges, 10)).toThrow(/width/);
    expect(() => layoutMap([ent("a", "x"), ent("a", "x")], [], 1000)).toThrow(/duplicate/);
    expect(() => layoutMap([{ key: "a", kind: "e", r: 0 }], [], 1000)).toThrow(/radius/);
    expect(() => layoutMap(units, [{ a: "e:a", b: "nope", weight: 1 }], 1000)).toThrow(/unknown/);
  });
});

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
