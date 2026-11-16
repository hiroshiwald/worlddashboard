import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "@/lib/server/graph";
import {
  alsoTouches, buildMapData, countStats, filterGraph, layoutEntity, parseGraph, planUnits, traceConnection,
} from "../model";

function node(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, name: `N${id}`, type: "person", status: "tracked", role: "satellite", clusterIds: [],
    state: "Steady", ratio: 1, mentions14d: 5, mergedInto: null, ...over,
  };
}

function edge(a: string, b: string, weight = 1, over: Partial<GraphEdge> = {}): GraphEdge {
  return { a, b, articleCount: weight, weight, firstSeenAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-02T00:00:00Z", ...over };
}

describe("filterGraph", () => {
  it("keeps growing nodes and direct neighbours only", () => {
    const nodes = [node("1", { state: "Rising", ratio: 3 }), node("2"), node("3")];
    const out = filterGraph(nodes, [edge("1", "2"), edge("2", "3")]);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["1", "2"]);
  });

  it("takes strongest edges first when the cap bites", () => {
    const nodes = [node("1", { state: "Rising" }), node("2"), node("3"), node("4")];
    const out = filterGraph(nodes, [edge("1", "2", 1), edge("1", "3", 9), edge("1", "4", 5)], [], 3);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["1", "3", "4"]);
  });

  it("drops merged nodes and honours forced ids", () => {
    const nodes = [node("1", { mergedInto: "2" }), node("2"), node("3")];
    const out = filterGraph(nodes, [edge("1", "2"), edge("2", "3")], ["2"]);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["2", "3"]);
  });
});

describe("buildMapData", () => {
  const nodes = [
    node("1", { state: "Rising" }), node("2"), node("3", { state: "New" }), node("4"), node("5"),
    node("c", { role: "anchor" }),
  ];
  const edges = [edge("1", "2", 3), edge("3", "4", 1), edge("3", "5", 1), edge("c", "1", 2)];

  it("labels connected groups by size, never by names, and isolates loose entities", () => {
    const data = buildMapData(nodes, edges, []);
    expect(data.usesClusters).toBe(false);
    expect(data.groups.map((g) => g.label)).toEqual(["Group 1", "Group 2"]);
    expect(data.groups[0].ids).toHaveLength(3);
    const alone = buildMapData([...nodes, node("9")], edges, []);
    expect(alone.groups[alone.groups.length - 1].label).toBe("Not connected to anything");
  });

  it("uses clusters when present", () => {
    const withTopics = nodes.map((n) => node(n.id, { ...n, clusterIds: n.id < "3" ? ["t1"] : ["t2"] }));
    const clusters = [
      { id: "t1", label: "Ports", size: 2, risingCount: 1 },
      { id: "t2", label: "Grain", size: 3, risingCount: 1 },
    ];
    const data = buildMapData(withTopics, edges, clusters);
    expect(data.usesClusters).toBe(true);
    expect(data.groups.map((g) => g.label)).toEqual(["Grain", "Ports"]);
  });

  it("counts with and without context", () => {
    const data = buildMapData(nodes, edges, []);
    expect(countStats(data, true)).toMatchObject({ entities: 6, links: 4, islands: 2 });
    expect(countStats(data, false)).toMatchObject({ entities: 5, links: 3, islands: 2 });
  });

  it("collapses groups into units with aggregated links", () => {
    const data = buildMapData(nodes, edges, []);
    const plan = planUnits(data, { open: new Set(), scope: [], showContext: true });
    expect(plan.units.map((u) => u.key).sort()).toEqual(["g:g1", "g:g2", "n:c"]);
    expect(plan.edges).toHaveLength(1);
    const open = planUnits(data, { open: new Set(["g1"]), scope: [], showContext: false });
    expect(open.units.filter((u) => u.kind === "e")).toHaveLength(3);
    expect(open.units.some((u) => u.kind === "n")).toBe(false);
  });

  it("reports neighbouring groups by link count", () => {
    const topical = nodes.map((n) => node(n.id, { ...n, clusterIds: n.id < "3" ? ["t1"] : ["t2"] }));
    const clusters = [{ id: "t1", label: "A", size: 2, risingCount: 0 }, { id: "t2", label: "B", size: 3, risingCount: 0 }];
    const joined = buildMapData(topical, [...edges, edge("2", "4", 1)], clusters);
    expect(alsoTouches(joined, ["t1"]).map((g) => g.id)).toEqual(["t2"]);
  });
});

describe("traceConnection", () => {
  const nodes = [node("1"), node("2"), node("c", { role: "anchor" }), node("3"), node("4")];

  it("flags paths that exist only through context entities", () => {
    const only = buildMapData(nodes, [edge("1", "c"), edge("c", "3")], []);
    expect(traceConnection(only, "1", "3")).toEqual({ kind: "path", path: ["1", "c", "3"], viaContext: true });
    const plain = buildMapData(nodes, [edge("1", "2"), edge("2", "3")], []);
    expect(traceConnection(plain, "1", "3")).toEqual({ kind: "path", path: ["1", "2", "3"], viaContext: false });
  });

  it("says unreachable when no path exists, none for same or empty ends", () => {
    const data = buildMapData(nodes, [edge("1", "2")], []);
    expect(traceConnection(data, "1", "4")).toEqual({ kind: "unreachable" });
    expect(traceConnection(data, "1", "1")).toEqual({ kind: "none" });
    expect(traceConnection(data, "", "1")).toEqual({ kind: "none" });
  });
});

describe("layoutEntity and parseGraph", () => {
  it("places linked entities inside one bubble per group", () => {
    const nodes = [node("1"), node("2"), node("3"), node("c", { role: "anchor" })];
    const data = buildMapData(nodes, [edge("1", "2"), edge("1", "3"), edge("1", "c")], []);
    const lay = layoutEntity(data, "1", 900);
    expect(lay.bubbles.map((b) => b.gid).sort()).toEqual(["ctx", "g1"]);
    expect(lay.bubbles.find((b) => b.gid === "g1")?.members).toHaveLength(2);
  });

  it("rejects a malformed graph payload", () => {
    expect(() => parseGraph({ nodes: [] })).toThrow();
    expect(() => parseGraph(null)).toThrow();
  });
});
