import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "@/lib/server/graph";
import {
  buildMapData, filterGraph, growingFastest, layoutEntity, parseGraph, traceConnection,
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

describe("growingFastest", () => {
  it("skips merged nodes, context entities and steady ones", () => {
    const nodes = [
      node("1", { state: "Rising", ratio: 4 }),
      node("2", { state: "Rising", ratio: 9, mergedInto: "1" }),
      node("3", { state: "New", ratio: 2 }),
      node("4", { state: "Rising", ratio: 8, role: "anchor" }),
      node("5"),
    ];
    expect(growingFastest(buildMapData(nodes, [])).map((n) => n.id)).toEqual(["1", "3"]);
  });
});

describe("traceConnection", () => {
  const nodes = [node("1"), node("2"), node("c", { role: "anchor" }), node("3"), node("4")];

  it("flags paths that exist only through context entities", () => {
    const only = buildMapData(nodes, [edge("1", "c"), edge("c", "3")]);
    expect(traceConnection(only, "1", "3")).toEqual({ kind: "path", path: ["1", "c", "3"], viaContext: true });
    const plain = buildMapData(nodes, [edge("1", "2"), edge("2", "3")]);
    expect(traceConnection(plain, "1", "3")).toEqual({ kind: "path", path: ["1", "2", "3"], viaContext: false });
  });

  it("says unreachable when no path exists, none for same or empty ends", () => {
    const data = buildMapData(nodes, [edge("1", "2")]);
    expect(traceConnection(data, "1", "4")).toEqual({ kind: "unreachable" });
    expect(traceConnection(data, "1", "1")).toEqual({ kind: "none" });
    expect(traceConnection(data, "", "1")).toEqual({ kind: "none" });
  });
});

describe("layoutEntity and parseGraph", () => {
  it("puts context neighbours and other neighbours in separate bubbles", () => {
    const nodes = [node("1"), node("2"), node("3"), node("c", { role: "anchor" })];
    const data = buildMapData(nodes, [edge("1", "2"), edge("1", "3"), edge("1", "c")]);
    const lay = layoutEntity(data, "1", 900);
    expect(lay.bubbles.map((b) => b.gid).sort()).toEqual(["ctx", "linked"]);
    expect(lay.bubbles.find((b) => b.gid === "linked")?.members).toHaveLength(2);
  });

  it("rejects a malformed graph payload", () => {
    expect(() => parseGraph({ nodes: [] })).toThrow();
    expect(() => parseGraph(null)).toThrow();
  });
});
