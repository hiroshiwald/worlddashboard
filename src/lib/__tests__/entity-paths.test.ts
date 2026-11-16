import { describe, it, expect } from "vitest";
import {
  buildAdjacency,
  shortestPath,
  nearestTracked,
  trackedNeighbors,
  connectedGroups,
  type PathEdge,
  type PathNode,
} from "../entity-paths";

function node(id: string, kind: "plain" | "tracked" | "context"): PathNode {
  return {
    id,
    tracked: kind === "tracked" || kind === "context",
    context: kind === "context",
  };
}

function nodeMap(list: PathNode[]): Map<string, PathNode> {
  return new Map(list.map((n) => [n.id, n]));
}

function edge(a: string, b: string, articleCount: number): PathEdge {
  return { a, b, articleCount };
}

describe("buildAdjacency", () => {
  it("returns an empty map for no edges", () => {
    expect(buildAdjacency([]).size).toBe(0);
  });

  it("links a single edge in both directions", () => {
    const adj = buildAdjacency([edge("a", "b", 1)]);
    expect(adj.get("a")).toEqual(["b"]);
    expect(adj.get("b")).toEqual(["a"]);
  });

  it("sorts neighbors by articleCount descending", () => {
    const adj = buildAdjacency([edge("a", "b", 1), edge("a", "c", 3)]);
    expect(adj.get("a")).toEqual(["c", "b"]);
  });

  it("breaks articleCount ties by id ascending", () => {
    const adj = buildAdjacency([edge("a", "c", 2), edge("a", "b", 2)]);
    expect(adj.get("a")).toEqual(["b", "c"]);
  });

  it("merges duplicate pairs by adding counts, in either direction", () => {
    const adj = buildAdjacency([
      edge("a", "b", 2),
      edge("b", "a", 3),
      edge("a", "c", 4),
    ]);
    expect(adj.get("a")).toEqual(["b", "c"]);
    expect(adj.get("b")).toEqual(["a"]);
  });

  it("drops self-loops", () => {
    const adj = buildAdjacency([edge("a", "a", 9)]);
    expect(adj.size).toBe(0);
  });

  it("rejects an empty endpoint", () => {
    expect(() => buildAdjacency([edge("", "b", 1)])).toThrow(/endpoint a/);
    expect(() => buildAdjacency([edge("a", "", 1)])).toThrow(/endpoint b/);
  });

  it("rejects a negative or non-finite articleCount", () => {
    expect(() => buildAdjacency([edge("a", "b", -1)])).toThrow(/articleCount/);
    expect(() => buildAdjacency([edge("a", "b", NaN)])).toThrow(/articleCount/);
  });
});

describe("shortestPath", () => {
  const adj = buildAdjacency([
    edge("a", "b", 5),
    edge("a", "c", 3),
    edge("b", "c", 1),
    edge("c", "d", 2),
  ]);

  it("returns [from] when from equals to", () => {
    expect(shortestPath(adj, "a", "a")).toEqual(["a"]);
  });

  it("returns the shortest path including both ends", () => {
    expect(shortestPath(adj, "a", "d")).toEqual(["a", "c", "d"]);
  });

  it("returns null for an unknown id", () => {
    expect(shortestPath(adj, "a", "z")).toBeNull();
    expect(shortestPath(adj, "z", "a")).toBeNull();
  });

  it("returns null for an isolated pair with no path", () => {
    const split = buildAdjacency([edge("a", "b", 1), edge("c", "d", 1)]);
    expect(shortestPath(split, "a", "d")).toBeNull();
  });

  it("never enters avoided nodes", () => {
    expect(shortestPath(adj, "a", "d", new Set(["c"]))).toBeNull();
  });

  it("routes around an avoided node when another path exists", () => {
    expect(shortestPath(adj, "a", "c", new Set(["b"]))).toEqual(["a", "c"]);
  });

  it("returns null when from or to is avoided", () => {
    expect(shortestPath(adj, "a", "d", new Set(["a"]))).toBeNull();
    expect(shortestPath(adj, "a", "d", new Set(["d"]))).toBeNull();
  });
});

describe("nearestTracked", () => {
  it("returns [] for an unknown start", () => {
    const adj = buildAdjacency([]);
    expect(nearestTracked(adj, nodeMap([node("s", "plain")]), "s")).toEqual([]);
  });

  it("returns [] when no tracked node is reachable", () => {
    const adj = buildAdjacency([edge("s", "p", 1)]);
    const nodes = nodeMap([node("s", "plain"), node("p", "plain")]);
    expect(nearestTracked(adj, nodes, "s")).toEqual([]);
  });

  it("returns a direct tracked neighbor with its path", () => {
    const adj = buildAdjacency([edge("s", "t1", 1)]);
    const nodes = nodeMap([node("s", "plain"), node("t1", "tracked")]);
    expect(nearestTracked(adj, nodes, "s")).toEqual([
      { id: "t1", hops: 1, path: ["s", "t1"] },
    ]);
  });

  it("traverses context nodes but never returns them", () => {
    const adj = buildAdjacency([edge("s", "c", 1), edge("c", "t1", 1)]);
    const nodes = nodeMap([
      node("s", "plain"),
      node("c", "context"),
      node("t1", "tracked"),
    ]);
    expect(nearestTracked(adj, nodes, "s")).toEqual([
      { id: "t1", hops: 2, path: ["s", "c", "t1"] },
    ]);
  });

  it("does not expand through a target", () => {
    const adj = buildAdjacency([edge("s", "t1", 1), edge("t1", "t2", 1)]);
    const nodes = nodeMap([
      node("s", "plain"),
      node("t1", "tracked"),
      node("t2", "tracked"),
    ]);
    expect(nearestTracked(adj, nodes, "s").map((r) => r.id)).toEqual(["t1"]);
  });

  it("stops at the first target's hop level", () => {
    const adj = buildAdjacency([
      edge("s", "c", 5),
      edge("c", "t1", 1),
      edge("s", "t2", 1),
    ]);
    const nodes = nodeMap([
      node("s", "plain"),
      node("c", "context"),
      node("t1", "tracked"),
      node("t2", "tracked"),
    ]);
    expect(nearestTracked(adj, nodes, "s")).toEqual([
      { id: "t2", hops: 1, path: ["s", "t2"] },
    ]);
  });

  it("returns every target at the same level in BFS order", () => {
    const adj = buildAdjacency([
      edge("s", "t3", 1),
      edge("s", "t1", 3),
      edge("s", "t2", 2),
    ]);
    const nodes = nodeMap([
      node("s", "plain"),
      node("t1", "tracked"),
      node("t2", "tracked"),
      node("t3", "tracked"),
    ]);
    expect(nearestTracked(adj, nodes, "s").map((r) => r.id)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("caps results at limit, defaulting to 3", () => {
    const adj = buildAdjacency([
      edge("s", "t1", 3),
      edge("s", "t2", 2),
      edge("s", "t3", 1),
      edge("s", "t4", 1),
    ]);
    const nodes = nodeMap([
      node("s", "plain"),
      node("t1", "tracked"),
      node("t2", "tracked"),
      node("t3", "tracked"),
      node("t4", "tracked"),
    ]);
    expect(nearestTracked(adj, nodes, "s").map((r) => r.id)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
    expect(nearestTracked(adj, nodes, "s", 1).map((r) => r.id)).toEqual(["t1"]);
  });

  it("never returns the start node as its own target", () => {
    const adj = buildAdjacency([edge("s", "t1", 1)]);
    const nodes = nodeMap([node("s", "tracked"), node("t1", "tracked")]);
    expect(nearestTracked(adj, nodes, "s").map((r) => r.id)).toEqual(["t1"]);
  });

  it("rejects a limit below 1", () => {
    const adj = buildAdjacency([edge("s", "t1", 1)]);
    const nodes = nodeMap([node("s", "plain"), node("t1", "tracked")]);
    expect(() => nearestTracked(adj, nodes, "s", 0)).toThrow(/limit/);
  });

  it("throws when a reachable neighbor has no node entry", () => {
    const adj = buildAdjacency([edge("s", "ghost", 1)]);
    expect(() => nearestTracked(adj, nodeMap([node("s", "plain")]), "s")).toThrow(
      /ghost/,
    );
  });
});

describe("trackedNeighbors", () => {
  it("returns [] for an isolated start", () => {
    const adj = buildAdjacency([]);
    expect(trackedNeighbors(adj, nodeMap([node("s", "plain")]), "s")).toEqual([]);
  });

  it("returns only direct tracked, non-context neighbors", () => {
    const adj = buildAdjacency([
      edge("s", "c", 5),
      edge("s", "t2", 1),
      edge("s", "p", 2),
    ]);
    const nodes = nodeMap([
      node("s", "plain"),
      node("c", "context"),
      node("t2", "tracked"),
      node("p", "plain"),
    ]);
    expect(trackedNeighbors(adj, nodes, "s")).toEqual(["t2"]);
  });

  it("keeps adjacency order", () => {
    const adj = buildAdjacency([edge("s", "t1", 2), edge("s", "t2", 4)]);
    const nodes = nodeMap([
      node("s", "plain"),
      node("t1", "tracked"),
      node("t2", "tracked"),
    ]);
    expect(trackedNeighbors(adj, nodes, "s")).toEqual(["t2", "t1"]);
  });

  it("does not return second-hop targets", () => {
    const adj = buildAdjacency([edge("s", "c", 1), edge("c", "t1", 1)]);
    const nodes = nodeMap([
      node("s", "plain"),
      node("c", "context"),
      node("t1", "tracked"),
    ]);
    expect(trackedNeighbors(adj, nodes, "s")).toEqual([]);
  });
});

describe("connectedGroups", () => {
  it("returns [] for no ids", () => {
    expect(connectedGroups(buildAdjacency([edge("a", "b", 1)]), [])).toEqual([]);
  });

  it("returns a singleton group for an id with no edges", () => {
    expect(connectedGroups(buildAdjacency([]), ["a"])).toEqual([["a"]]);
  });

  it("groups connected ids, sorted by size then first id", () => {
    const adj = buildAdjacency([
      edge("p", "q", 1),
      edge("q", "r", 1),
      edge("s", "t", 1),
    ]);
    expect(connectedGroups(adj, ["r", "q", "p", "s", "t", "z"])).toEqual([
      ["p", "q", "r"],
      ["s", "t"],
      ["z"],
    ]);
  });

  it("orders equal-size groups by first id", () => {
    const adj = buildAdjacency([edge("u", "v", 1), edge("s", "t", 1)]);
    expect(connectedGroups(adj, ["v", "u", "t", "s"])).toEqual([
      ["s", "t"],
      ["u", "v"],
    ]);
  });

  it("only links through ids in the given set", () => {
    const adj = buildAdjacency([edge("p", "q", 1), edge("q", "r", 1)]);
    expect(connectedGroups(adj, ["p", "r"])).toEqual([["p"], ["r"]]);
  });
});
