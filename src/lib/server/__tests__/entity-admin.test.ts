import { describe, it, expect } from "vitest";
import {
  searchEntities,
  loadEntityStats,
  findSimilarNames,
  loadMentionsInWindow,
  loadSourcesInWindow,
  ValidationError,
  type SimilarNameEntity,
} from "../entity-admin";
import type { Sql, SqlRow } from "../db";

function makeMockSql(rows: SqlRow[]) {
  const calls: { query: string; values: unknown[] }[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join(" ? "), values });
    return rows;
  }) as Sql;
  return { sql, calls };
}

/** Unlike makeMockSql (same rows for every call), branches on query text —
 * needed once a test cares about the mentions7d/sources7d aggregate queries
 * returning a different row shape than the main entities query. */
function makeHandlerMockSql(handler: (query: string) => SqlRow[]) {
  const calls: { query: string; values: unknown[] }[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(" ? ");
    calls.push({ query, values });
    return handler(query);
  }) as Sql;
  return { sql, calls };
}

function entityRow(overrides: Partial<SqlRow> & { id: number; canonical_name: string }): SqlRow {
  return {
    type: "person",
    status: "tracked",
    aliases: [],
    fame: "unknown",
    fame_locked: false,
    wiki_title: null,
    wiki_sitelinks: null,
    wiki_pageviews_monthly: null,
    fame_checked_at: null,
    first_seen_at: "2026-07-01T00:00:00Z",
    last_seen_at: null,
    ...overrides,
  };
}

describe("findSimilarNames", () => {
  function named(id: number, canonicalName: string): SimilarNameEntity {
    return { id, canonicalName };
  }

  it("groups Air Force / Air Force One (whole-word prefix)", () => {
    const groups = findSimilarNames([named(1, "Air Force"), named(2, "Air Force One")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entities.map((e) => e.id)).toEqual([1, 2]);
  });

  it("groups Modi / Narendra Modi (whole-word suffix)", () => {
    const groups = findSimilarNames([named(1, "Narendra Modi"), named(2, "Modi")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entities.map((e) => e.id).sort()).toEqual([1, 2]);
  });

  it("groups U.S. military / US military (punctuation-stripped exact match)", () => {
    const groups = findSimilarNames([named(1, "U.S. military"), named(2, "US military")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entities.map((e) => e.id).sort()).toEqual([1, 2]);
  });

  it("does not group unrelated names", () => {
    const groups = findSimilarNames([named(1, "France"), named(2, "Germany"), named(3, "Iran")]);
    expect(groups).toEqual([]);
  });

  it("does not match a substring inside a different word (Iran vs Iranian Officials)", () => {
    const groups = findSimilarNames([named(1, "Iran"), named(2, "Iranian Officials")]);
    expect(groups).toEqual([]);
  });

  it("does not group two different same-length names", () => {
    const groups = findSimilarNames([named(1, "New York"), named(2, "New Jersey")]);
    expect(groups).toEqual([]);
  });

  it("is order-independent", () => {
    const a = findSimilarNames([named(1, "Air Force"), named(2, "Air Force One"), named(3, "Unrelated")]);
    const b = findSimilarNames([named(3, "Unrelated"), named(2, "Air Force One"), named(1, "Air Force")]);
    expect(a).toEqual(b);
  });

  it("transitively groups a three-way chain via connected components", () => {
    const groups = findSimilarNames([named(1, "Modi"), named(2, "Narendra Modi"), named(3, "narendra modi")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entities.map((e) => e.id).sort()).toEqual([1, 2, 3]);
  });
});

describe("searchEntities", () => {
  it("matches by canonical_name (case/diacritic-insensitive)", async () => {
    const { sql } = makeMockSql([entityRow({ id: 1, canonical_name: "Müller" })]);
    const result = await searchEntities(sql, { q: "muller" });
    expect(result.total).toBe(1);
    expect(result.entities[0].id).toBe(1);
  });

  it("matches by alias", async () => {
    const { sql } = makeMockSql([entityRow({ id: 1, canonical_name: "United States", aliases: ["US", "USA"] })]);
    const result = await searchEntities(sql, { q: "usa" });
    expect(result.total).toBe(1);
  });

  it("excludes non-matching rows", async () => {
    const { sql } = makeMockSql([entityRow({ id: 1, canonical_name: "Russia" })]);
    const result = await searchEntities(sql, { q: "ukraine" });
    expect(result.total).toBe(0);
    expect(result.entities).toEqual([]);
  });

  it("pushes the status filter down to SQL", async () => {
    const { sql, calls } = makeMockSql([]);
    await searchEntities(sql, { status: "dismissed" });
    expect(calls[0].query).toContain("status = ");
    expect(calls[0].values).toContain("dismissed");
  });

  it("pushes the fame filter down to SQL", async () => {
    const { sql, calls } = makeMockSql([]);
    await searchEntities(sql, { fame: "famous" });
    expect(calls[0].query).toContain("fame = ");
    expect(calls[0].values).toContain("famous");
  });

  it("rejects an invalid status rather than ignoring it", async () => {
    const { sql } = makeMockSql([]);
    await expect(searchEntities(sql, { status: "bogus" })).rejects.toThrow(ValidationError);
  });

  it("rejects an invalid fame value", async () => {
    const { sql } = makeMockSql([]);
    await expect(searchEntities(sql, { fame: "bogus" })).rejects.toThrow(ValidationError);
  });

  it("defaults limit to 50 and offset to 0", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => entityRow({ id: i + 1, canonical_name: `Entity ${i + 1}` }));
    const { sql } = makeMockSql(rows);
    const result = await searchEntities(sql, {});
    expect(result.entities).toHaveLength(50);
    expect(result.total).toBe(60);
    expect(result.entities[0].id).toBe(1);
  });

  it("caps limit at 200 (rejects anything higher)", async () => {
    const { sql } = makeMockSql([]);
    await expect(searchEntities(sql, { limit: 201 })).rejects.toThrow(ValidationError);
  });

  it("rejects a malformed limit rather than coercing it", async () => {
    const { sql } = makeMockSql([]);
    await expect(searchEntities(sql, { limit: NaN })).rejects.toThrow(ValidationError);
    await expect(searchEntities(sql, { limit: 1.5 })).rejects.toThrow(ValidationError);
    await expect(searchEntities(sql, { limit: 0 })).rejects.toThrow(ValidationError);
    await expect(searchEntities(sql, { limit: -5 })).rejects.toThrow(ValidationError);
  });

  it("rejects a malformed offset rather than coercing it", async () => {
    const { sql } = makeMockSql([]);
    await expect(searchEntities(sql, { offset: NaN })).rejects.toThrow(ValidationError);
    await expect(searchEntities(sql, { offset: -1 })).rejects.toThrow(ValidationError);
  });

  it("pages via offset", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => entityRow({ id: i + 1, canonical_name: `Entity ${i + 1}` }));
    const { sql } = makeMockSql(rows);
    const result = await searchEntities(sql, { limit: 2, offset: 2 });
    expect(result.entities.map((e) => e.id)).toEqual([3, 4]);
    expect(result.total).toBe(5);
  });

  it("returns the zero-results shape", async () => {
    const { sql } = makeMockSql([]);
    const result = await searchEntities(sql, { q: "nonexistent" });
    expect(result).toEqual({ entities: [], total: 0 });
  });

  it("evidence contract: every row carries its fame evidence fields, and a never-checked entity is distinguishable from a checked one", async () => {
    const { sql } = makeMockSql([
      entityRow({ id: 1, canonical_name: "Never Checked", fame: "unknown", fame_checked_at: null }),
      entityRow({
        id: 2,
        canonical_name: "Checked Not Famous",
        fame: "unknown",
        fame_checked_at: "2026-07-20T00:00:00Z",
      }),
    ]);
    const result = await searchEntities(sql, {});
    const [neverChecked, checked] = result.entities;
    expect(neverChecked.fameCheckedAt).toBeNull();
    expect(checked.fameCheckedAt).toBe("2026-07-20T00:00:00.000Z");
    for (const row of result.entities) {
      expect(row).toHaveProperty("wikiTitle");
      expect(row).toHaveProperty("wikiSitelinks");
      expect(row).toHaveProperty("wikiPageviewsMonthly");
      expect(row).toHaveProperty("fameCheckedAt");
    }
  });
});

describe("searchEntities — sort", () => {
  it("defaults to last_seen desc when sort is omitted", async () => {
    const { sql } = makeMockSql([
      entityRow({ id: 1, canonical_name: "Bravo", last_seen_at: "2026-07-01T00:00:00Z" }),
      entityRow({ id: 2, canonical_name: "Alpha", last_seen_at: "2026-08-01T00:00:00Z" }),
    ]);
    const result = await searchEntities(sql, {});
    expect(result.entities.map((e) => e.id)).toEqual([2, 1]);
  });

  it("sort=name orders ascending by canonical name", async () => {
    const { sql } = makeMockSql([
      entityRow({ id: 1, canonical_name: "Bravo" }),
      entityRow({ id: 2, canonical_name: "Alpha" }),
    ]);
    const result = await searchEntities(sql, { sort: "name" });
    expect(result.entities.map((e) => e.canonicalName)).toEqual(["Alpha", "Bravo"]);
  });

  it("sort=first_seen orders descending", async () => {
    const { sql } = makeMockSql([
      entityRow({ id: 1, canonical_name: "Bravo", first_seen_at: "2026-06-01T00:00:00Z" }),
      entityRow({ id: 2, canonical_name: "Alpha", first_seen_at: "2026-07-01T00:00:00Z" }),
    ]);
    const result = await searchEntities(sql, { sort: "first_seen" });
    expect(result.entities.map((e) => e.id)).toEqual([2, 1]);
  });

  it("sort=last_seen orders descending, nulls sorted least-recent", async () => {
    const { sql } = makeMockSql([
      entityRow({ id: 1, canonical_name: "NoLastSeen", last_seen_at: null }),
      entityRow({ id: 2, canonical_name: "HasLastSeen", last_seen_at: "2026-08-01T00:00:00Z" }),
    ]);
    const result = await searchEntities(sql, { sort: "last_seen" });
    expect(result.entities.map((e) => e.id)).toEqual([2, 1]);
  });

  it("rejects an invalid sort value", async () => {
    const { sql } = makeMockSql([]);
    await expect(searchEntities(sql, { sort: "bogus" })).rejects.toThrow(ValidationError);
  });
});

describe("searchEntities — activity aggregates", () => {
  it("sort=activity orders by mentions7d descending", async () => {
    const { sql } = makeHandlerMockSql((query) => {
      if (query.includes("FROM entities")) {
        return [
          entityRow({ id: 1, canonical_name: "Low" }),
          entityRow({ id: 2, canonical_name: "High" }),
        ];
      }
      if (query.includes("FROM entity_mentions_hourly")) {
        return [
          { entity_id: "1", mentions_in_window: "2" },
          { entity_id: "2", mentions_in_window: "40" },
        ];
      }
      return [];
    });
    const result = await searchEntities(sql, { sort: "activity" });
    expect(result.entities.map((e) => e.id)).toEqual([2, 1]);
    expect(result.entities[0].mentions7d).toBe(40);
  });

  it("zero-fills mentions7d/sources7d when no aggregate row matches", async () => {
    const { sql } = makeHandlerMockSql((query) =>
      query.includes("FROM entities") ? [entityRow({ id: 1, canonical_name: "Solo" })] : [],
    );
    const result = await searchEntities(sql, {});
    expect(result.entities[0].mentions7d).toBe(0);
    expect(result.entities[0].sources7d).toBe(0);
  });

  it("counts distinct sources via article_entities/articles, not summed source_count", async () => {
    const { sql } = makeHandlerMockSql((query) => {
      if (query.includes("FROM entities")) return [entityRow({ id: 1, canonical_name: "Solo" })];
      if (query.includes("FROM article_entities")) return [{ entity_id: "1", sources_in_window: "3" }];
      return [];
    });
    const result = await searchEntities(sql, {});
    expect(result.entities[0].sources7d).toBe(3);
  });
});

describe("searchEntities — stat-tile filters", () => {
  it("fameChecked=never keeps only fame_checked_at IS NULL", async () => {
    const { sql } = makeMockSql([
      entityRow({ id: 1, canonical_name: "Never", fame_checked_at: null }),
      entityRow({ id: 2, canonical_name: "Checked", fame_checked_at: "2026-07-20T00:00:00Z" }),
    ]);
    const result = await searchEntities(sql, { fameChecked: "never" });
    expect(result.entities.map((e) => e.id)).toEqual([1]);
  });

  it("fameChecked=checked keeps only fame_checked_at IS NOT NULL", async () => {
    const { sql } = makeMockSql([
      entityRow({ id: 1, canonical_name: "Never", fame_checked_at: null }),
      entityRow({ id: 2, canonical_name: "Checked", fame_checked_at: "2026-07-20T00:00:00Z" }),
    ]);
    const result = await searchEntities(sql, { fameChecked: "checked" });
    expect(result.entities.map((e) => e.id)).toEqual([2]);
  });

  it("rejects an invalid fameChecked value", async () => {
    const { sql } = makeMockSql([]);
    await expect(searchEntities(sql, { fameChecked: "bogus" })).rejects.toThrow(ValidationError);
  });

  it("fameLocked=true keeps only locked entities", async () => {
    const { sql } = makeMockSql([
      entityRow({ id: 1, canonical_name: "Locked", fame_locked: true }),
      entityRow({ id: 2, canonical_name: "Unlocked", fame_locked: false }),
    ]);
    const result = await searchEntities(sql, { fameLocked: "true" });
    expect(result.entities.map((e) => e.id)).toEqual([1]);
  });

  it("rejects a fameLocked value other than 'true'", async () => {
    const { sql } = makeMockSql([]);
    await expect(searchEntities(sql, { fameLocked: "false" })).rejects.toThrow(ValidationError);
  });
});

describe("loadMentionsInWindow", () => {
  it("returns an empty map without querying when ids is empty", async () => {
    const { sql, calls } = makeMockSql([]);
    const result = await loadMentionsInWindow(sql, [], 7);
    expect(result.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("parses SUM(mentions) rows keyed by entity id", async () => {
    const { sql } = makeMockSql([{ entity_id: "3", mentions_in_window: "17" }]);
    const result = await loadMentionsInWindow(sql, [3], 7);
    expect(result.get(3)).toBe(17);
  });
});

describe("loadSourcesInWindow", () => {
  it("returns an empty map without querying when ids is empty", async () => {
    const { sql, calls } = makeMockSql([]);
    const result = await loadSourcesInWindow(sql, [], 7);
    expect(result.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("parses COUNT(DISTINCT source_name) rows keyed by entity id", async () => {
    const { sql } = makeMockSql([{ entity_id: "3", sources_in_window: "5" }]);
    const result = await loadSourcesInWindow(sql, [3], 7);
    expect(result.get(3)).toBe(5);
  });
});

describe("loadEntityStats", () => {
  it("counts parked (checked, unknown) separately from never-checked", async () => {
    const { sql } = makeMockSql([
      {
        total_tracked: "3",
        famous_count: "0",
        not_famous_count: "0",
        unknown_count: "3",
        parked_count: "1",
        never_checked_count: "2",
        locked_count: "0",
        oldest_checked_at: "2026-07-01T00:00:00Z",
        newest_checked_at: "2026-07-01T00:00:00Z",
      },
    ]);
    const stats = await loadEntityStats(sql);
    expect(stats.parkedCount).toBe(1);
    expect(stats.neverCheckedCount).toBe(2);
    expect(stats.unknownCount).toBe(3);
  });

  it("returns the empty-database shape: all zero counts, null timestamps", async () => {
    const { sql } = makeMockSql([
      {
        total_tracked: "0",
        famous_count: "0",
        not_famous_count: "0",
        unknown_count: "0",
        parked_count: "0",
        never_checked_count: "0",
        locked_count: "0",
        oldest_checked_at: null,
        newest_checked_at: null,
      },
    ]);
    const stats = await loadEntityStats(sql);
    expect(stats).toEqual({
      totalTracked: 0,
      famousCount: 0,
      notFamousCount: 0,
      unknownCount: 0,
      parkedCount: 0,
      neverCheckedCount: 0,
      lockedCount: 0,
      oldestFameCheckedAt: null,
      newestFameCheckedAt: null,
    });
  });

  it("is a single query", async () => {
    const { sql, calls } = makeMockSql([
      {
        total_tracked: "0", famous_count: "0", not_famous_count: "0", unknown_count: "0",
        parked_count: "0", never_checked_count: "0", locked_count: "0",
        oldest_checked_at: null, newest_checked_at: null,
      },
    ]);
    await loadEntityStats(sql);
    expect(calls).toHaveLength(1);
  });
});
