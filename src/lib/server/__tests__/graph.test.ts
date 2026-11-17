import { describe, it, expect } from "vitest";
import {
  assembleGraph,
  assignClusters,
  buildStats,
  capPopulation,
  mergedIntoById,
  toGraphEdges,
} from "../graph";
import type { EntityFacts } from "../entity-facts";
import type { SqlRow } from "../db";

const NOW = new Date("2026-11-16T12:00:00Z");

function row(id: number, status: string, name = `Entity ${id}`): SqlRow {
  return { id, canonical_name: name, type: "other", status, followed: false, aliases: [], fame: "unknown", wiki_title: null };
}

function fact(id: number, mentions14d: number): EntityFacts {
  return {
    id: String(id), mentions14d, recent72h: 0, usualPerDay: 0, ratio: 1.5, volumeScale: 1, state: "Rising",
    daily: [], sources: { count: 1, label: "Single source", top: [] },
    firstSeenAt: NOW.toISOString(), lastSeenAt: null,
  };
}

function edge(a: number, b: number, articleCount: number): SqlRow {
  return {
    entity_a: a, entity_b: b, article_count: articleCount,
    first_seen_at: "2026-11-10T00:00:00Z", last_seen_at: "2026-11-15T00:00:00Z",
  };
}

describe("capPopulation", () => {
  const rows = [row(1, "tracked"), row(2, "candidate"), row(3, "candidate"), row(4, "tracked")];
  const mentions = new Map([["1", 1], ["2", 9], ["3", 2], ["4", 0]]);

  it("leaves small populations alone", () => {
    expect(capPopulation(rows, mentions, 4)).toEqual({ kept: rows, capped: false });
  });

  it("drops lowest-mention candidates first, never tracked", () => {
    const { kept, capped } = capPopulation(rows, mentions, 3);
    expect(kept.map((r) => r.id)).toEqual([1, 2, 4]);
    expect(capped).toBe(true);
  });

  it("keeps all tracked even above the cap", () => {
    const { kept } = capPopulation(rows, mentions, 1);
    expect(kept.map((r) => r.id)).toEqual([1, 4]);
  });
});

describe("toGraphEdges", () => {
  it("weights by cosine and skips edges outside the population", () => {
    const mentions = new Map([["1", 4], ["2", 9]]);
    const edges = toGraphEdges([edge(1, 2, 3), edge(1, 99, 5)], mentions);
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBeCloseTo(0.5);
    expect(edges[0].lastSeenAt).toBe("2026-11-15T00:00:00.000Z");
  });
});

describe("mergedIntoById", () => {
  it("maps non-canonical members to the canonical id", () => {
    const entities = [
      { id: "1", name: "Russia", type: "country", aliases: ["Russland"], wikiTitle: null, mentions: 10 },
      { id: "2", name: "Russland", type: "country", aliases: [], wikiTitle: null, mentions: 2 },
      { id: "3", name: "Chile", type: "country", aliases: [], wikiTitle: null, mentions: 2 },
    ];
    expect(mergedIntoById(entities)).toEqual(new Map([["2", "1"]]));
  });
});

describe("assignClusters", () => {
  const nodes = [
    { id: "1", state: "Rising" as const },
    { id: "2", state: "Steady" as const },
    { id: "3", state: "New" as const },
  ];

  it("returns no clusters when membership is empty", () => {
    const result = assignClusters(nodes, new Map());
    expect(result.clusters).toEqual([]);
    expect(result.clusterIdsByNode.get("1")).toEqual([]);
  });

  it("builds clusters with size and rising counts, ignoring unknown entities", () => {
    const membership = new Map([["1", ["War", "Oil"]], ["2", ["War"]], ["3", ["Oil"]], ["99", ["Ghost"]]]);
    const result = assignClusters(nodes, membership);
    expect(result.clusters).toEqual([
      { id: "Oil", label: "Oil", size: 2, risingCount: 2 },
      { id: "War", label: "War", size: 2, risingCount: 1 },
    ]);
    expect(result.clusterIdsByNode.get("1")).toEqual(["War", "Oil"]);
  });
});

describe("buildStats", () => {
  const nodes = [
    { id: "1", role: "satellite" as const },
    { id: "2", role: "anchor" as const },
    { id: "3", role: "satellite" as const },
    { id: "4", role: "satellite" as const },
  ];
  const e = (a: string, b: string) => ({
    a, b, articleCount: 1, weight: 1, firstSeenAt: "", lastSeenAt: "",
  });

  it("counts islands and isolated nodes with and without context", () => {
    const stats = buildStats(nodes, [e("1", "2"), e("2", "3")], true);
    expect(stats).toEqual({
      nodes: 4, edges: 2, islands: 1, isolated: 1,
      islandsWithoutContext: 0, isolatedWithoutContext: 3, capped: true,
    });
  });
});

describe("assembleGraph", () => {
  it("shapes nodes, edges and stats", () => {
    const rows = [row(1, "tracked", "Alpha"), row(2, "candidate", "Beta")];
    const facts = new Map([["1", fact(1, 4)], ["2", fact(2, 9)]]);
    const roles = new Map([["1", "famous" as const]]);
    const graph = assembleGraph(rows, facts, roles, [edge(1, 2, 3)], false, NOW, new Map());
    expect(graph.nodes[0]).toMatchObject({ id: "1", role: "famous", clusterIds: [], mergedInto: null, state: "Rising" });
    expect(graph.nodes[1].role).toBe("satellite");
    expect(graph.edges[0].weight).toBeCloseTo(0.5);
    expect(graph.clusters).toEqual([]);
    expect(graph.stats.islands).toBe(1);
    expect(graph.generatedAt).toBe(NOW.toISOString());
  });

  it("sets clusterIds and clusters from membership", () => {
    const rows = [row(1, "tracked"), row(2, "candidate")];
    const facts = new Map([["1", fact(1, 4)], ["2", fact(2, 9)]]);
    const graph = assembleGraph(rows, facts, new Map(), [], false, NOW, new Map([["1", ["War"]]]));
    expect(graph.nodes[0].clusterIds).toEqual(["War"]);
    expect(graph.nodes[1].clusterIds).toEqual([]);
    expect(graph.clusters).toEqual([{ id: "War", label: "War", size: 1, risingCount: 1 }]);
  });

  it("throws when facts are missing", () => {
    expect(() => assembleGraph([row(1, "tracked")], new Map(), new Map(), [], false, NOW, new Map())).toThrow();
  });
});
