import { describe, it, expect } from "vitest";
import { compareByFacts, computeNearestTracked, isFactSort, toListFacts } from "../entity-list-facts";
import type { EntityFacts } from "../entity-facts";
import { searchEntities, ValidationError } from "../entity-admin";
import type { Sql, SqlRow } from "../db";

function facts(id: string, overrides: Partial<EntityFacts>): EntityFacts {
  return {
    id,
    mentions14d: 0,
    recent72h: 0,
    usualPerDay: 0, baselineDays: 11,
    ratio: 0,
    state: "Steady",
    daily: new Array<number>(14).fill(0),
    sources: { count: 0, label: "No sources", top: [] },
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt: null,
    ...overrides,
  };
}

describe("compareByFacts", () => {
  it("growth: New first, then ratio descending, WarmingUp last", () => {
    const list = [
      facts("1", { state: "WarmingUp", ratio: 9 }),
      facts("2", { state: "Steady", ratio: 1 }),
      facts("3", { state: "New", ratio: 2 }),
      facts("4", { state: "Rising", ratio: 5 }),
    ];
    list.sort((a, b) => compareByFacts(a, b, "growth"));
    expect(list.map((f) => f.id)).toEqual(["3", "4", "2", "1"]);
  });

  it("diversity sorts by source count descending", () => {
    const list = [
      facts("1", { sources: { count: 1, label: "Single source", top: [] } }),
      facts("2", { sources: { count: 5, label: "Multi-source", top: [] } }),
    ];
    list.sort((a, b) => compareByFacts(a, b, "diversity"));
    expect(list.map((f) => f.id)).toEqual(["2", "1"]);
  });

  it("mentions sorts by mentions14d descending", () => {
    const list = [facts("1", { mentions14d: 3 }), facts("2", { mentions14d: 30 })];
    list.sort((a, b) => compareByFacts(a, b, "mentions"));
    expect(list.map((f) => f.id)).toEqual(["2", "1"]);
  });

  it("isFactSort recognises only the three new sorts", () => {
    expect(["growth", "diversity", "mentions", "activity", "name"].map(isFactSort)).toEqual([
      true, true, true, false, false,
    ]);
  });
});

describe("toListFacts", () => {
  it("formats the ratio text and passes through sources and nearest", () => {
    const row = toListFacts(facts("1", { ratio: 12, state: "Rising" }), [{ id: "9", name: "Acme", hops: 1 }]);
    expect(row.growth).toMatchObject({ state: "Rising", ratio: 12, ratioText: "10+" });
    expect(row.nearestTracked).toEqual([{ id: "9", name: "Acme", hops: 1 }]);
  });
});

describe("computeNearestTracked", () => {
  const anchors = { anchorThreshold: 100, baselineDailyById: new Map<number, number>() };
  const edge = (a: number, b: number): SqlRow => ({ entity_a: a, entity_b: b, article_count: 2 });
  const node = (id: number, name: string, status: string, type = "person"): SqlRow => ({
    id, canonical_name: name, type, status,
  });

  it("finds the nearest tracked entity for a candidate, hopping through an anchor context node", () => {
    const edges = [edge(1, 2), edge(2, 3)];
    const nodes = [
      node(1, "Cand", "candidate"),
      node(2, "Somewhere", "tracked", "country"),
      node(3, "Tracked Co", "tracked"),
    ];
    const result = computeNearestTracked(edges, nodes, anchors, ["1"]);
    expect(result.get("1")).toEqual([{ id: "3", name: "Tracked Co", hops: 2 }]);
  });

  it("gives a tracked row its direct tracked neighbors at 1 hop", () => {
    const edges = [edge(1, 2), edge(1, 3)];
    const nodes = [node(1, "A", "tracked"), node(2, "B", "tracked"), node(3, "C", "candidate")];
    const result = computeNearestTracked(edges, nodes, anchors, ["1"]);
    expect(result.get("1")).toEqual([{ id: "2", name: "B", hops: 1 }]);
  });

  it("omits starts with no edges", () => {
    const result = computeNearestTracked([edge(1, 2)], [node(1, "A", "tracked"), node(2, "B", "tracked")], anchors, ["7"]);
    expect(result.has("7")).toBe(false);
  });
});

describe("searchEntities — facts sorts", () => {
  function entity(id: number): SqlRow {
    return {
      id, canonical_name: `E${id}`, type: "person", status: "tracked", aliases: [], fame: "unknown",
      fame_locked: false, wiki_title: null, wiki_sitelinks: null, wiki_pageviews_monthly: null,
      fame_checked_at: null, first_seen_at: "2026-07-01T00:00:00Z", last_seen_at: null,
    };
  }

  function mockSql(entities: SqlRow[], sourceRows: SqlRow[]): Sql {
    return (async (strings: TemplateStringsArray) => {
      const query = strings.join(" ? ");
      if (query.includes("AS article_count")) return sourceRows;
      if (query.includes("FROM entities ORDER BY") || query.includes("FROM entities WHERE status")) return entities;
      if (query.includes("FROM entities WHERE id = ANY")) return entities.map((e) => ({ id: e.id, status: e.status, first_seen_at: e.first_seen_at, last_seen_at: null }));
      return [];
    }) as Sql;
  }

  it("sort=mentions orders the whole population, then pages, and attaches the new fields", async () => {
    const sql = mockSql(
      [entity(1), entity(2), entity(3)],
      [
        { entity_id: "1", source_name: "S1", article_count: "2" },
        { entity_id: "3", source_name: "S1", article_count: "9" },
        { entity_id: "3", source_name: "S2", article_count: "1" },
      ],
    );
    const result = await searchEntities(sql, { sort: "mentions", limit: 2 });
    expect(result.total).toBe(3);
    expect(result.entities.map((e) => e.id)).toEqual([3, 1]);
    expect(result.entities[0].sources.count).toBe(2);
    expect(result.entities[0].growth.ratioText).toBe("0.0");
    expect(result.entities[0].nearestTracked).toEqual([]);
  });

  it("rejects a facts sort over more than 2000 matching entities", async () => {
    const many = Array.from({ length: 2001 }, (_, i) => entity(i + 1));
    await expect(searchEntities(mockSql(many, []), { sort: "growth" })).rejects.toThrow(ValidationError);
  });
});
