import { describe, it, expect } from "vitest";
import { assembleEntityFacts, groupMembersById, loadEntityFacts } from "../entity-facts";
import type { Sql, SqlRow } from "../db";

const NOW = new Date("2026-03-15T12:00:00Z");
const HOUR = 3600_000;

function makeSql(rows: SqlRow[][]) {
  const calls: { query: string; values: unknown[] }[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join(" ? "), values });
    return rows[calls.length - 1] ?? [];
  }) as Sql;
  return { sql, calls };
}

const entity = { id: 1, status: "tracked", first_seen_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-03-15T10:00:00Z" };

describe("assembleEntityFacts", () => {
  it("shapes growth, daily and sources", () => {
    const hourly = [
      { entity_id: 1, bucket: new Date(NOW.getTime() - HOUR), mentions: 4 },
      { entity_id: 1, bucket: new Date(NOW.getTime() - 100 * HOUR), mentions: 11 },
    ];
    const sources = [
      { entity_id: 1, source_name: "Zeta Wire", article_count: 2 },
      { entity_id: 1, source_name: "Alpha News", article_count: 2 },
      { entity_id: 1, source_name: "Beta Post", article_count: 5 },
      { entity_id: 1, source_name: "Gamma Daily", article_count: 1 },
    ];
    const facts = assembleEntityFacts([entity], hourly, sources, NOW).get("1")!;
    expect(facts.mentions14d).toBe(10);
    expect(facts.recent72h).toBe(4);
    expect(facts.usualPerDay).toBe(1);
    expect(facts.daily).toHaveLength(14);
    expect(facts.daily[13]).toBe(4);
    expect(facts.sources).toEqual({ count: 4, label: "Multi-source", top: ["Beta Post", "Alpha News", "Zeta Wire"] });
    expect(facts.firstSeenAt).toBe("2026-01-01T00:00:00.000Z");
    expect(facts.lastSeenAt).toBe("2026-03-15T10:00:00.000Z");
  });

  it("handles an entity with no rows and a null last_seen_at", () => {
    const facts = assembleEntityFacts([{ ...entity, last_seen_at: null }], [], [], NOW).get("1")!;
    expect(facts.mentions14d).toBe(0);
    expect(facts.sources).toEqual({ count: 0, label: "No sources", top: [] });
    expect(facts.lastSeenAt).toBeNull();
    expect(facts.state).toBe("Steady");
  });

  it("marks a recent untracked entity as New and ignores other entities' rows", () => {
    const fresh = { id: 2, status: "candidate", first_seen_at: new Date(NOW.getTime() - HOUR), last_seen_at: null };
    const other = [{ entity_id: 1, bucket: NOW, mentions: 9 }];
    const facts = assembleEntityFacts([fresh], other, [], NOW).get("2")!;
    expect(facts.state).toBe("New");
    expect(facts.recent72h).toBe(0);
  });

  it("throws on an invalid date", () => {
    expect(() => assembleEntityFacts([{ ...entity, first_seen_at: "nope" }], [], [], NOW)).toThrow();
  });
});

describe("loadEntityFacts", () => {
  it("returns an empty map without querying for empty ids", async () => {
    const { sql, calls } = makeSql([]);
    expect((await loadEntityFacts(sql, [], NOW)).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("rejects non-digit ids and more than 2000 ids", async () => {
    const { sql } = makeSql([]);
    await expect(loadEntityFacts(sql, ["1; DROP"], NOW)).rejects.toThrow();
    await expect(loadEntityFacts(sql, Array.from({ length: 2001 }, (_, i) => String(i)), NOW)).rejects.toThrow();
  });

  it("loads merge groups, three ANY queries and one volume query, with no INTERVAL literal", async () => {
    const { sql, calls } = makeSql([[], [entity], [], [], []]);
    const result = await loadEntityFacts(sql, ["1"], NOW);
    expect(result.get("1")?.id).toBe("1");
    expect(calls).toHaveLength(5);
    expect(calls[0].query).toContain("status <> 'dismissed'");
    expect(calls[4].query).toContain("volume_mentions");
    for (const call of calls.slice(1, 4)) {
      expect(call.query).toContain("= ANY(");
      expect(call.query).not.toContain("INTERVAL");
    }
  });
});

describe("merged growth", () => {
  const usRow = { id: 1, status: "tracked", first_seen_at: "2026-03-01T00:00:00Z", last_seen_at: "2026-03-15T10:00:00Z" };
  const unitedRow = { id: 2, status: "tracked", first_seen_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-03-14T00:00:00Z" };
  const members = new Map([["1", ["1", "2"]], ["2", ["1", "2"]]]);
  const hourly = [
    { entity_id: 1, bucket: new Date(NOW.getTime() - HOUR), mentions: 3 },
    { entity_id: 2, bucket: new Date(NOW.getTime() - HOUR), mentions: 30 },
    { entity_id: 2, bucket: new Date(NOW.getTime() - 100 * HOUR), mentions: 110 },
  ];
  const sources = [
    { entity_id: 1, source_name: "Alpha News", article_count: 1 },
    { entity_id: 2, source_name: "Alpha News", article_count: 4 },
    { entity_id: 2, source_name: "Beta Post", article_count: 2 },
  ];

  it("computes a duplicate's growth on its whole group", () => {
    const facts = assembleEntityFacts([usRow, unitedRow], hourly, sources, NOW, members, ["1"]);
    const us = facts.get("1")!;
    expect(facts.has("2")).toBe(false);
    expect(us.recent72h).toBe(33);
    expect(us.usualPerDay).toBe(10);
    expect(us.ratio).toBeCloseTo(1.1);
    expect(us.state).toBe("Steady");
    expect(us.sources).toEqual({ count: 2, label: "2 sources", top: ["Alpha News", "Beta Post"] });
    expect(us.firstSeenAt).toBe("2026-01-01T00:00:00.000Z");
    expect(us.lastSeenAt).toBe("2026-03-15T10:00:00.000Z");
  });

  it("leaves an ungrouped entity on its own counts", () => {
    const facts = assembleEntityFacts([usRow, unitedRow], hourly, sources, NOW, new Map(), ["1"]);
    expect(facts.get("1")!.recent72h).toBe(3);
  });

  it("groups names that share an alias and type", () => {
    const base = { type: "country", wikiTitle: null, mentions: 0 };
    const map = groupMembersById([
      { ...base, id: "1", name: "US", aliases: ["United States"] },
      { ...base, id: "2", name: "United States", aliases: [] },
      { ...base, id: "3", name: "France", aliases: [] },
    ]);
    expect(map.get("1")?.sort()).toEqual(["1", "2"]);
    expect(map.has("3")).toBe(false);
  });
});
