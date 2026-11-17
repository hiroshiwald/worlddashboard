import { describe, expect, it } from "vitest";
import { labelFits, packCircles } from "../pack";

const radii = [30, 55, 22, 40, 22, 22, 35, 28, 60, 25, 25, 31].map((r, i) => ({ key: `k${i}`, r }));

describe("packCircles", () => {
  it("returns nothing for no circles", () => {
    expect(packCircles([], 900)).toEqual({ circles: [], height: 0 });
  });

  it("never overlaps and stays inside the width", () => {
    const { circles, height } = packCircles(radii, 900);
    for (const [i, a] of circles.entries()) {
      expect(a.x - a.r).toBeGreaterThanOrEqual(0);
      expect(a.x + a.r).toBeLessThanOrEqual(900);
      expect(a.y + a.r).toBeLessThanOrEqual(height);
      for (const b of circles.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
    }
  });

  it("puts the largest nearest the middle", () => {
    const { circles } = packCircles(radii, 900);
    const cx = circles.reduce((s, c) => s + c.x, 0) / circles.length;
    const cy = circles.reduce((s, c) => s + c.y, 0) / circles.length;
    const dist = (key: string) => {
      const c = circles.find((k) => k.key === key)!;
      return Math.hypot(c.x - cx, c.y - cy);
    };
    expect(dist("k8")).toBeLessThan(dist("k2"));
  });

  it("is deterministic and places a single circle in view", () => {
    expect(packCircles(radii, 900)).toEqual(packCircles([...radii].reverse(), 900));
    const one = packCircles([{ key: "a", r: 20 }], 900).circles[0];
    expect(one.r).toBe(40);
  });

  it("packs 200 circles", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ key: `m${i}`, r: 20 + (i % 7) * 5 }));
    expect(packCircles(many, 900).circles).toHaveLength(200);
  });

  it("rejects a bad width or radius", () => {
    expect(() => packCircles(radii, 10)).toThrow(/width/);
    expect(() => packCircles([{ key: "a", r: 0 }], 900)).toThrow(/radius/);
  });
});

describe("labelFits", () => {
  it("fits short names in big bubbles only", () => {
    expect(labelFits("Altman", 50)).toBe(true);
    expect(labelFits("Federal Reserve Board", 30)).toBe(false);
  });
});
