import { describe, expect, it } from "vitest";
import type { EmergingItem } from "@/lib/emerging-types";
import { bubbleRadius, groupByAnchor, nearKnown, NO_ANCHOR_ID, NO_ANCHOR_LABEL, parseEmerging } from "../universe";

function item(name: string, anchors: string[], mentions = 1): EmergingItem {
  return {
    key: `cand:${name}`, kind: "candidate", name, type: "person", firstSeenAt: "2026-11-10T00:00:00Z", mentions,
    anchors: anchors.map((a) => ({ id: a, name: a.toUpperCase(), articleCount: 1 })), sampleTitles: [],
  };
}

describe("groupByAnchor", () => {
  it("groups by first anchor, biggest first, with unanchored items in one bubble", () => {
    const out = groupByAnchor([item("a", ["x", "y"]), item("b", ["y"]), item("c", ["y", "x"]), item("f", ["y"]), item("d", []), item("e", [])]);
    expect(out.map((b) => [b.id, b.items.length])).toEqual([["y", 3], [NO_ANCHOR_ID, 2], ["x", 1]]);
    expect(out.find((b) => b.id === NO_ANCHOR_ID)?.label).toBe(NO_ANCHOR_LABEL);
  });

  it("returns nothing for no items", () => {
    expect(groupByAnchor([])).toEqual([]);
  });
});

describe("nearKnown", () => {
  it("keeps anchored items only, most mentioned first, capped", () => {
    const items = [item("a", ["x"], 2), item("b", [], 99), item("c", ["x"], 5), item("d", ["x"], 3)];
    expect(nearKnown(items, 2).map((i) => i.name)).toEqual(["c", "d"]);
  });
});

describe("parseEmerging and bubbleRadius", () => {
  it("rejects a malformed payload", () => {
    expect(() => parseEmerging({ items: [] })).toThrow();
    expect(() => parseEmerging(null)).toThrow();
    expect(parseEmerging({ items: [], days: 7, generatedAt: "2026-11-17T00:00:00Z" }).items).toEqual([]);
  });

  it("grows with count up to a cap", () => {
    expect(bubbleRadius(1)).toBeLessThan(bubbleRadius(25));
    expect(bubbleRadius(100000)).toBe(60);
  });
});
