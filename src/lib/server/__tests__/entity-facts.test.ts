import { describe, it, expect } from "vitest";
import { assembleEntityFacts, loadEntityFacts } from "../entity-facts";
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

// One active hour per day for 14 days: full collection.
const ACTIVE = Array.from({ length: 14 }, (_, day) => ({ bucket: new Date(NOW.getTime() - (day * 24 + 1) * HOUR) }));
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
    const facts = assembleEntityFacts([entity], hourly, sources, ACTIVE, NOW).get("1")!;
    expect(facts.mentions14d).toBe(10);
    expect(facts.recent72h).toBe(4);
    expect(facts.usualPerDay).toBe(1);
    expect(facts.baselineDays).toBe(11);
    expect(facts.daily).toHaveLength(14);
    expect(facts.daily[13]).toBe(4);
    expect(facts.sources).toEqual({ count: 4, label: "Multi-source", top: ["Beta Post", "Alpha News", "Zeta Wire"] });
    expect(facts.firstSeenAt).toBe("2026-01-01T00:00:00.000Z");
    expect(facts.lastSeenAt).toBe("2026-03-15T10:00:00.000Z");
  });

  it("handles an entity with no rows and a null last_seen_at", () => {
    const facts = assembleEntityFacts([{ ...entity, last_seen_at: null }], [], [], ACTIVE, NOW).get("1")!;
    expect(facts.mentions14d).toBe(0);
    expect(facts.sources).toEqual({ count: 0, label: "No sources", top: [] });
    expect(facts.lastSeenAt).toBeNull();
    expect(facts.state).toBe("Steady");
  });

  it("is WarmingUp when collection gaps leave under 3 usual days", () => {
    const facts = assembleEntityFacts([entity], [], [], ACTIVE.slice(0, 5), NOW).get("1")!;
    expect(facts.baselineDays).toBe(2);
    expect(facts.state).toBe("WarmingUp");
  });

  it("marks a recent untracked entity as New and ignores other entities' rows", () => {
    const fresh = { id: 2, status: "candidate", first_seen_at: new Date(NOW.getTime() - HOUR), last_seen_at: null };
    const other = [{ entity_id: 1, bucket: NOW, mentions: 9 }];
    const facts = assembleEntityFacts([fresh], other, [], ACTIVE, NOW).get("2")!;
    expect(facts.state).toBe("New");
    expect(facts.recent72h).toBe(0);
  });

  it("throws on an invalid date", () => {
    expect(() => assembleEntityFacts([{ ...entity, first_seen_at: "nope" }], [], [], ACTIVE, NOW)).toThrow();
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

  it("uses three ANY queries plus one active-hours query, no INTERVAL literal", async () => {
    const { sql, calls } = makeSql([[entity], [], [], ACTIVE]);
    const result = await loadEntityFacts(sql, ["1"], NOW);
    expect(result.get("1")?.baselineDays).toBe(11);
    expect(calls).toHaveLength(4);
    expect(calls[3].query).toContain("DISTINCT bucket");
    for (const call of calls.slice(0, 3)) {
      expect(call.query).toContain("= ANY(");
      expect(call.query).not.toContain("INTERVAL");
    }
  });
});
