import { describe, expect, it } from "vitest";
import type { EmergingItem } from "@/lib/emerging-types";
import type { GraphEdge, GraphNode } from "@/lib/server/graph";
import { buildUniverse, universeNodes, nodeRadius, showLabel , pickLabelled } from "../forcegraph";

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
    const u = buildUniverse([node("a"), node("b")], [edge("a", "b")], [name("a", [], "entity")]);
    expect(u.nodes).toHaveLength(2);
    expect(u.nodes.find((n) => n.id === "a")?.isNew).toBe(true);
  });

  it("leaves out nodes with no links", () => {
    const u = buildUniverse([node("a"), node("b"), node("lonely")], [edge("a", "b")], []);
    expect(u.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(u.neighbours.has("lonely")).toBe(false);
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
    expect(nodeRadius(1e9, false)).toBe(15);
  });
});

describe("showLabel", () => {
  const node = (id: string, labelled: boolean) => ({ id, name: id, isNew: false, radius: 3, labelled });
  const neighbours = new Map([["a", new Set(["c"])], ["c", new Set(["a"])], ["d", new Set<string>()]]);

  it("draws labels picked for the overview", () => {
    expect(showLabel(node("b", true), null, null, neighbours)).toBe(true);
    expect(showLabel(node("d", false), null, null, neighbours)).toBe(false);
  });

  it("labels the hovered node, the selected node and its neighbours", () => {
    expect(showLabel(node("d", false), "d", null, neighbours)).toBe(true);
    expect(showLabel(node("a", false), null, "a", neighbours)).toBe(true);
    expect(showLabel(node("c", false), null, "a", neighbours)).toBe(true);
    expect(showLabel(node("d", false), null, "a", neighbours)).toBe(false);
  });
});

describe("pickLabelled", () => {
  it("labels only the 12 biggest new names and 10 biggest known entities", () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, name: `N${i}`, isNew: i < 15, radius: i, labelled: true }));
    const out = pickLabelled(nodes);
    expect(out.filter((x) => x.isNew && x.labelled)).toHaveLength(12);
    expect(out.filter((x) => !x.isNew && x.labelled)).toHaveLength(10);
    expect(out.find((x) => x.id === "n0")?.labelled).toBe(false);
  });
});

describe("universeNodes", () => {
  it("keeps anchors of new names and the busiest known entities only", () => {
    const g = Array.from({ length: 50 }, (_, i) => ({ ...node(`k${i}`), mentions14d: i }));
    const out = universeNodes(g, [name("cand:x", ["k0"])]).map((n) => n.id);
    expect(out).toContain("k0");
    expect(out).toContain("k49");
    expect(out).not.toContain("k5");
    expect(out).toHaveLength(41);
  });
});
