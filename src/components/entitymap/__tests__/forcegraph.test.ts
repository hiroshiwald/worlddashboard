import { describe, expect, it } from "vitest";
import type { EmergingItem } from "@/lib/emerging-types";
import type { GraphEdge, GraphNode } from "@/lib/server/graph";
import { buildUniverse, nodeRadius, showLabel } from "../forcegraph";

function node(id: string, mentions14d = 5): GraphNode {
  return { id, name: `N${id}`, type: "person", status: "tracked", role: "satellite", clusterIds: [], state: "Steady", ratio: 1, mentions14d, mergedInto: null };
}
const edge = (a: string, b: string): GraphEdge => ({ a, b, articleCount: 1, weight: 1, firstSeenAt: "", lastSeenAt: "" });
function name(key: string, anchors: string[], kind: EmergingItem["kind"] = "candidate"): EmergingItem {
  return {
    key, kind, name: key, type: "person", firstSeenAt: "", mentions: 4, sampleTitles: [], links: [], context: null,
    anchors: anchors.map((id) => ({ id, name: id, type: "person", articleCount: 1 })),
  };
}

describe("buildUniverse", () => {
  it("adds candidates as new nodes linked to their anchors", () => {
    const u = buildUniverse([node("a"), node("b")], [edge("a", "b")], [name("cand:x", ["a"])]);
    expect(u.nodes.map((n) => [n.id, n.isNew])).toEqual([["a", false], ["b", false], ["cand:x", true]]);
    expect(u.links).toHaveLength(2);
    expect([...u.neighbours.get("a")!].sort()).toEqual(["b", "cand:x"]);
  });

  it("marks a graph entity new instead of duplicating it", () => {
    const u = buildUniverse([node("a")], [], [name("a", [], "entity")]);
    expect(u.nodes).toHaveLength(1);
    expect(u.nodes[0].isNew).toBe(true);
  });

  it("drops self-links, duplicates and links to unknown nodes", () => {
    const u = buildUniverse([node("a"), node("b")], [edge("a", "b"), edge("b", "a"), edge("a", "a"), edge("a", "zz")], [name("cand:x", ["zz"])]);
    expect(u.links).toEqual([{ source: "a", target: "b" }]);
  });

  it("handles an empty universe", () => {
    expect(buildUniverse([], [], [])).toEqual({ nodes: [], links: [], neighbours: new Map() });
  });
});

describe("nodeRadius", () => {
  it("is bigger for new names and capped", () => {
    expect(nodeRadius(0, true)).toBeGreaterThan(nodeRadius(0, false));
    expect(nodeRadius(1e9, false)).toBe(12);
  });
});

describe("showLabel", () => {
  const u = buildUniverse([node("a", 5), node("b", 99), node("c", 5), node("d", 5)], [edge("a", "c")], [name("cand:x", [])]);
  const by = (id: string) => u.nodes.find((n) => n.id === id)!;
  it("labels new names and large nodes always", () => {
    expect(showLabel(by("cand:x"), null, null, u.neighbours)).toBe(true);
    expect(showLabel(by("b"), null, null, u.neighbours)).toBe(true);
    expect(showLabel(by("d"), null, null, u.neighbours)).toBe(false);
  });
  it("labels the hovered node, the selected node and its neighbours", () => {
    expect(showLabel(by("d"), "d", null, u.neighbours)).toBe(true);
    expect(showLabel(by("a"), null, "a", u.neighbours)).toBe(true);
    expect(showLabel(by("c"), null, "a", u.neighbours)).toBe(true);
    expect(showLabel(by("d"), null, "a", u.neighbours)).toBe(false);
  });
});
