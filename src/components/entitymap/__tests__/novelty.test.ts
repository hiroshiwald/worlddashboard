import Graph from "graphology";
import { describe, expect, it } from "vitest";
import type { EmergingItem } from "@/lib/emerging-types";
import type { GraphEdge, GraphNode } from "@/lib/server/graph";
import { buildGraph } from "../graph-metrics";
import { buildMapData } from "../model";
import {
  dropLoneNewNames,
  firstSeen,
  hopsFromFollowed,
  linkSurprise,
  mergeNewNames,
  nodeScores,
  noveltyView,
  reasons,
  selectNovel,
  windowEdges,
  type NoveltyOptions,
} from "../novelty";

const NOW = new Date("2026-11-17T00:00:00Z");
const DAY = 86_400_000;

function iso(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * DAY).toISOString();
}

function node(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    name: id,
    type: "organization",
    status: "tracked",
    followed: false,
    role: "satellite",
    clusterIds: [],
    state: "Steady",
    ratio: 1,
    mentions14d: 10,
    mergedInto: null,
    ...extra,
  };
}

function edge(a: string, b: string, first: number, last = first, articleCount = 3): GraphEdge {
  return { a, b, articleCount, weight: 1, firstSeenAt: iso(first), lastSeenAt: iso(last) };
}

function item(key: string, anchorIds: string[], daysAgo = 1, kind: EmergingItem["kind"] = "candidate"): EmergingItem {
  return {
    key,
    kind,
    name: key,
    type: "weapon",
    firstSeenAt: iso(daysAgo),
    mentions: 4,
    anchors: anchorIds.map((id) => ({ id, name: id, type: "organization", articleCount: 5 })),
    sampleTitles: [],
    links: [],
    context: null,
  };
}

const OPTS: NoveltyOptions = { days: 14, topN: null, hideFamous: false, hops: 0, hideHubs: false };

describe("mergeNewNames", () => {
  it("adds a candidate node and one link per anchor in the graph", () => {
    const out = mergeNewNames([node("navy")], [], [item("cand:lionfish", ["navy", "missing"])]);
    expect(out.nodes.map((n) => n.id)).toEqual(["navy", "cand:lionfish"]);
    expect(out.nodes[1]).toMatchObject({ status: "candidate", role: "satellite", state: "New", mentions14d: 4 });
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ a: "cand:lionfish", b: "navy", articleCount: 5, weight: 0 });
    expect(out.edges[0].firstSeenAt).toBe(iso(1));
  });
  it("skips entity items and ids already present", () => {
    const nodes = [node("navy"), node("cand:x")];
    const out = mergeNewNames(nodes, [], [item("e1", ["navy"], 1, "entity"), item("cand:x", ["navy"])]);
    expect(out.nodes).toHaveLength(2);
    expect(out.edges).toHaveLength(0);
  });
});

describe("windowEdges", () => {
  it("keeps links seen inside the window and drops future and stale ones", () => {
    const inside = edge("a", "b", 3, 1);
    const stale = edge("a", "c", 40, 20);
    const future = edge("a", "d", -2, -2);
    expect(windowEdges([inside, stale, future], 14, NOW)).toEqual([inside]);
  });
});

describe("linkSurprise", () => {
  const base = { weight: 3, firstSeenAt: iso(1), articleCount: 2 };
  it("is newness x log2(1+lift) x evidence x bridge", () => {
    expect(linkSurprise(base, true, 14, NOW)).toBeCloseTo(2);
    expect(linkSurprise(base, false, 14, NOW)).toBeCloseTo(3);
  });
  it("discounts old links and thin evidence", () => {
    expect(linkSurprise({ ...base, firstSeenAt: iso(20) }, true, 14, NOW)).toBeCloseTo(0.4);
    expect(linkSurprise({ ...base, articleCount: 1 }, true, 14, NOW)).toBeCloseTo(1);
  });
});

function smallGraph(): Graph {
  const nodes = [
    node("a", { followed: true }),
    node("b"),
    node("c", { role: "famous" }),
    node("d"),
    node("e"),
  ];
  const edges = [edge("a", "b", 1), edge("b", "c", 30, 1), edge("c", "d", 1), edge("d", "e", 1)];
  return buildGraph(nodes, edges, { hideHubs: false }, NOW);
}

describe("nodeScores", () => {
  it("adds bonuses for new names and non-famous roles", () => {
    const g = buildGraph(
      [node("navy", { role: "famous" }), node("n", { status: "candidate" })],
      [edge("n", "navy", 1)],
      { hideHubs: false },
      NOW,
    );
    const byNode = new Map([["navy", 0], ["n", 0]]);
    const s = nodeScores(g, byNode, 14, NOW);
    const link = linkSurprise(g.getEdgeAttributes("n", "navy") as never, true, 14, NOW);
    expect(s.get("navy")).toBeCloseTo(link);
    expect(s.get("n")).toBeCloseTo(link + 1.5);
  });
  it("sums only the top 3 links", () => {
    const nodes = ["h", "1", "2", "3", "4"].map((id) => node(id));
    const edges = ["1", "2", "3", "4"].map((id) => edge("h", id, 1));
    const g = buildGraph(nodes, edges, { hideHubs: false }, NOW);
    const byNode = new Map(nodes.map((n) => [n.id, 0]));
    const one = linkSurprise(g.getEdgeAttributes("h", "1") as never, true, 14, NOW);
    expect(nodeScores(g, byNode, 14, NOW).get("h")).toBeCloseTo(3 * one + 0.5);
  });
});

describe("hopsFromFollowed", () => {
  it("expands from followed nodes by hop count", () => {
    const g = smallGraph();
    expect([...hopsFromFollowed(g, 0)]).toEqual(["a"]);
    expect([...hopsFromFollowed(g, 1)].sort()).toEqual(["a", "b"]);
    expect([...hopsFromFollowed(g, 2)].sort()).toEqual(["a", "b", "c"]);
  });
  it("is empty when nothing is followed", () => {
    const g = buildGraph([node("a")], [], { hideHubs: false }, NOW);
    expect(hopsFromFollowed(g, 2).size).toBe(0);
  });
});

describe("selectNovel", () => {
  const g = smallGraph();
  const scores = new Map([["a", 5], ["b", 4], ["c", 3], ["d", 2], ["e", 1]]);
  it("keeps the top N by score", () => {
    const kept = selectNovel(g, scores, { topN: 2, hideFamous: false, hops: 0 });
    expect([...kept].sort()).toEqual(["a", "b"]);
  });
  it("keeps everything when topN is null", () => {
    expect(selectNovel(g, scores, { topN: null, hideFamous: false, hops: 0 }).size).toBe(5);
  });
  it("hides famous nodes", () => {
    const kept = selectNovel(g, scores, { topN: null, hideFamous: true, hops: 0 });
    expect(kept.has("c")).toBe(false);
  });
  it("limits to nodes near followed ones", () => {
    const kept = selectNovel(g, scores, { topN: null, hideFamous: false, hops: 1 });
    expect([...kept].sort()).toEqual(["a", "b"]);
  });
});

describe("Lionfish UUV", () => {
  const nodes = [
    node("243", { name: "U.S. Navy", role: "famous" }),
    node("x"),
    node("y"),
    node("z"),
  ];
  const edges = [edge("243", "x", 2), edge("x", "y", 2), edge("y", "z", 2)];
  const items = [item("cand:lionfish", ["243"])];
  const data = buildMapData(nodes, edges);

  it("keeps the candidate and its famous anchor when hideFamous is on", () => {
    const view = noveltyView(data, items, { ...OPTS, hideFamous: true, topN: 1 }, NOW);
    expect(view.graph.hasNode("cand:lionfish")).toBe(true);
    expect(view.graph.hasNode("243")).toBe(true);
    expect(view.graph.hasEdge("cand:lionfish", "243")).toBe(true);
    expect(view.reasons.get("cand:lionfish")).toBe("New name, first seen 16 Nov, linked to U.S. Navy");
  });
  it("returns firstSeen and followedCount", () => {
    const view = noveltyView(data, items, OPTS, NOW);
    expect(view.firstSeen.get("cand:lionfish")).toBe(NOW.getTime() - DAY);
    expect(view.followedCount).toBe(0);
  });
  it("sets role and status attributes on graph nodes", () => {
    const view = noveltyView(data, items, OPTS, NOW);
    expect(view.graph.getNodeAttribute("243", "role")).toBe("famous");
    expect(view.graph.getNodeAttribute("cand:lionfish", "status")).toBe("candidate");
  });
});

describe("reasons", () => {
  const nodes = [node("a", { name: "Nvidia" }), node("b"), node("c"), node("d")];
  const edges = [edge("a", "b", 1, 1, 3), edge("c", "d", 30, 1)];
  const g = buildGraph(nodes, edges, { hideHubs: false }, NOW);
  const labels = new Map([[0, "Alpha, B"], [1, "Gamma, D"]]);

  it("describes a new link with its article count", () => {
    const byNode = new Map([["a", 0], ["b", 0], ["c", 1], ["d", 1]]);
    expect(reasons(g, byNode, labels, 14, NOW).get("b")).toBe("New link to Nvidia (3 articles)");
  });
  it("describes a bridge between groups for an old link", () => {
    const byNode = new Map([["a", 0], ["b", 0], ["c", 0], ["d", 1]]);
    expect(reasons(g, byNode, labels, 14, NOW).get("c")).toBe("Links the 'Alpha, B' and 'Gamma, D' groups");
  });
  it("falls back for old same-group links and unlinked new names", () => {
    const byNode = new Map([["a", 0], ["b", 0], ["c", 0], ["d", 0]]);
    expect(reasons(g, byNode, labels, 14, NOW).get("c")).toBe("Known entity, no new links");
    const lone = buildGraph([node("n", { status: "candidate" })], [], { hideHubs: false }, NOW);
    expect(reasons(lone, new Map(), labels, 14, NOW).get("n")).toBe("New name, no known links");
  });
});

describe("firstSeen", () => {
  it("is the earliest link time, or -Infinity with no links", () => {
    const g = buildGraph(
      [node("a"), node("b"), node("c")],
      [edge("a", "b", 5), edge("a", "c", 2)],
      { hideHubs: false },
      NOW,
    );
    g.addNode("lone");
    const fs = firstSeen(g);
    expect(fs.get("a")).toBe(NOW.getTime() - 5 * DAY);
    expect(fs.get("c")).toBe(NOW.getTime() - 2 * DAY);
    expect(fs.get("lone")).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("dropLoneNewNames", () => {
  it("drops new names with no link and keeps linked ones and known entities", () => {
    const g = new Graph({ type: "undirected" });
    g.addNode("cand:a", { status: "candidate" });
    g.addNode("cand:b", { status: "candidate" });
    g.addNode("1", { status: "tracked" });
    g.addNode("2", { status: "tracked" });
    g.addEdge("cand:b", "1");
    dropLoneNewNames(g);
    expect(g.nodes().sort()).toEqual(["1", "2", "cand:b"]);
  });
});
