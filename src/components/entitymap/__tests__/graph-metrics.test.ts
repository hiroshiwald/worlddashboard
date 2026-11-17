import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "@/lib/server/graph";
import {
  brokers,
  buildGraph,
  communities,
  hubIds,
  liftWeight,
  newEdges,
} from "../graph-metrics";

const NOW = new Date("2026-11-17T00:00:00Z");

function node(id: string, mentions14d: number, type = "person", name = id): GraphNode {
  return {
    id,
    name,
    type,
    status: "tracked",
    followed: false,
    role: "none",
    clusterIds: [],
    state: "steady",
    ratio: 1,
    mentions14d,
    mergedInto: null,
  } as unknown as GraphNode;
}

function edge(a: string, b: string, daysAgo: number, articleCount = 2): GraphEdge {
  const t = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
  return { a, b, articleCount, weight: 1, firstSeenAt: t, lastSeenAt: t };
}

describe("liftWeight", () => {
  it("is observed over expected", () => {
    expect(liftWeight(4, 10, 20, 100)).toBe(2);
  });
  it("floors mentions at 1", () => {
    expect(liftWeight(1, 0, 0, 1)).toBe(1);
  });
});

describe("hubIds", () => {
  it("includes geographic types and top-degree nodes", () => {
    const nodes = [node("a", 1), node("b", 1), node("c", 1, "country"), node("d", 1)];
    const ids = hubIds(nodes, [edge("a", "b", 1)]);
    expect(ids.has("c")).toBe(true);
    expect(ids.has("a")).toBe(true);
  });
  it("takes top 1% when there are many nodes", () => {
    const nodes = Array.from({ length: 1000 }, (_, i) => node(`n${i}`, 1));
    const edges = [edge("n0", "n1", 1), edge("n0", "n2", 1)];
    const ids = hubIds(nodes, edges);
    expect(ids.size).toBe(10);
    expect(ids.has("n0")).toBe(true);
  });
});

describe("buildGraph", () => {
  const nodes = [node("a", 100), node("b", 25), node("c", 0, "city")];
  const edges = [edge("a", "b", 1), edge("a", "b", 1), edge("b", "c", 30), edge("a", "z", 1), edge("a", "a", 1)];

  it("sets node and edge attributes", () => {
    const g = buildGraph(nodes, edges, { hideHubs: false }, NOW);
    expect(g.getNodeAttribute("a", "size")).toBe(20);
    expect(g.getNodeAttribute("b", "size")).toBe(3 + 0.5 * 17);
    expect(g.getNodeAttribute("c", "size")).toBe(3);
    expect(g.getNodeAttribute("a", "label")).toBe("a");
    expect(g.getEdgeAttribute("a", "b", "isNew")).toBe(true);
    expect(g.getEdgeAttribute("b", "c", "isNew")).toBe(false);
    expect(g.getEdgeAttribute("a", "b", "weight")).toBeCloseTo(liftWeight(2, 100, 25, 125));
    expect(g.size).toBe(2);
  });
  it("drops hubs when hideHubs is set", () => {
    const big = Array.from({ length: 10 }, (_, i) => node(`n${i}`, 1));
    big.push(node("geo", 1, "country"));
    const g = buildGraph(big, [edge("n0", "geo", 1)], { hideHubs: true }, NOW);
    expect(g.hasNode("geo")).toBe(false);
  });
  it("handles all-zero mentions", () => {
    const g = buildGraph([node("a", 0)], [], { hideHubs: false }, NOW);
    expect(g.getNodeAttribute("a", "size")).toBe(3);
  });
});

describe("communities", () => {
  it("returns empty for an empty graph", () => {
    const r = communities(buildGraph([], [], { hideHubs: false }, NOW));
    expect(r.byNode.size).toBe(0);
  });
  it("splits two cliques and labels by top mentions", () => {
    const nodes = ["a", "b", "c", "d", "x", "y", "z", "w"].map((id, i) => node(id, 10 + i));
    const pairs = [["a","b"],["a","c"],["b","c"],["a","d"],["b","d"],["c","d"],
      ["x","y"],["x","z"],["y","z"],["x","w"],["y","w"],["z","w"]];
    const edges = [...pairs.map(([p, q]) => edge(p, q, 30, 5)), edge("d", "x", 30, 1)];
    const r = communities(buildGraph(nodes, edges, { hideHubs: false }, NOW));
    expect(r.byNode.get("a")).toBe(r.byNode.get("d"));
    expect(r.byNode.get("a")).not.toBe(r.byNode.get("x"));
    expect(r.labels.get(r.byNode.get("x") as number)).toBe("w, z, y");
  });
});

describe("brokers", () => {
  it("ranks the node a new edge bridges", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => node(id, 5));
    const edges = [edge("a", "b", 30), edge("c", "d", 30), edge("b", "c", 1)];
    const g = buildGraph(nodes, edges, { hideHubs: false }, NOW);
    const top = brokers(g, NOW, 2);
    expect(top).toHaveLength(2);
    expect(top[0].now).toBeGreaterThan(top[0].before);
    expect(["b", "c"]).toContain(top[0].id);
    expect(top[0].name).toBe(top[0].id);
  });
  it("defaults the limit to 10", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => node(`n${i}`, 1));
    const g = buildGraph(nodes, [], { hideHubs: false }, NOW);
    expect(brokers(g, NOW)).toHaveLength(10);
  });
});

describe("newEdges", () => {
  it("keeps edges within 7 days, newest first", () => {
    const edges = [edge("a", "b", 5), edge("a", "c", 1), edge("a", "d", 8)];
    const r = newEdges(edges, NOW);
    expect(r.map((e) => e.b)).toEqual(["c", "b"]);
  });
});
