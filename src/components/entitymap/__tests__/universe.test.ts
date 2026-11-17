import { describe, expect, it } from "vitest";
import type { EmergingItem } from "@/lib/emerging-types";
import { bubbleRadius, groupByAnchor, nameRequest, nearKnown, NO_ANCHOR_ID, NO_ANCHOR_LABEL, parseEmerging } from "../universe";

function item(name: string, anchors: string[], mentions = 1, anchorType = "organization"): EmergingItem {
  return {
    key: `cand:${name}`, kind: "candidate", name, type: "person", firstSeenAt: "2026-11-10T00:00:00Z", mentions,
    anchors: anchors.map((a) => ({ id: a, name: a.toUpperCase(), type: anchorType, articleCount: 1 })), sampleTitles: [], links: [], context: null,
  };
}

describe("groupByAnchor", () => {
  it("groups by first anchor, biggest first, with unanchored items in one bubble last", () => {
    const out = groupByAnchor([item("a", ["x", "y"]), item("b", ["y"]), item("c", ["y", "x"]), item("f", ["y"]), item("d", []), item("e", [])]);
    expect(out.map((b) => [b.id, b.items.length])).toEqual([["y", 3], ["x", 1], [NO_ANCHOR_ID, 2]]);
    expect(out.find((b) => b.id === NO_ANCHOR_ID)?.label).toBe(NO_ANCHOR_LABEL);
  });

  it("puts people and companies first and places last, whatever their size", () => {
    const out = groupByAnchor([
      item("a", ["china"], 1, "country"), item("b", ["china"], 1, "country"), item("c", ["china"], 1, "country"),
      item("d", ["altman"], 1, "person"), item("e", ["fed"], 1, "government_body"), item("f", ["fed"], 1, "government_body"),
    ]);
    expect(out.map((b) => b.id)).toEqual(["altman", "fed", "china"]);
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

  it("rejects items without links", () => {
    const old = { ...item("a", []), links: undefined };
    expect(() => parseEmerging({ items: [old], days: 7, generatedAt: "2026-11-17T00:00:00Z" })).toThrow();
  });

  it("grows with count up to a cap", () => {
    expect(bubbleRadius(1)).toBeLessThan(bubbleRadius(25));
    expect(bubbleRadius(100000)).toBe(60);
  });
});

describe("nameRequest", () => {
  it("accepts and dismisses a candidate through /api/candidates", () => {
    const cand = item("Lionfish", ["x"]);
    expect(nameRequest(cand, "track")).toEqual({ method: "POST", url: "/api/candidates", body: { nameNorm: "Lionfish", action: "accept", type: "person" } });
    expect(nameRequest(cand, "ignore").body).toEqual({ nameNorm: "Lionfish", action: "dismiss" });
  });

  it("patches an entity's status", () => {
    const ent = { ...item("a", []), kind: "entity" as const, key: "42" };
    expect(nameRequest(ent, "track")).toEqual({ method: "PATCH", url: "/api/entities/42", body: { status: "tracked" } });
    expect(nameRequest(ent, "ignore").body).toEqual({ status: "dismissed" });
  });
});
