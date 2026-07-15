import { describe, it, expect } from "vitest";
import { persistArticles, sweepRetention } from "../ingest-writer";
import type { Sql, SqlRow } from "../db";
import type { FeedItem } from "../../types";

interface RecordedCall {
  query: string;
  values: unknown[];
}

function makeMockSql(handler: (call: RecordedCall) => SqlRow[]) {
  const calls: RecordedCall[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call: RecordedCall = { query: strings.join(" ? "), values };
    calls.push(call);
    return handler(call);
  }) as Sql;
  return { sql, calls };
}

let nextId = 0;
function makeItem(overrides: Partial<FeedItem>): FeedItem {
  nextId += 1;
  return {
    id: `item-${nextId}`,
    title: `Title ${nextId}`,
    link: `https://example.com/${nextId}`,
    published: "2026-07-10T00:00:00.000Z",
    summary: "",
    sourceName: "Test Source",
    sourceCategory: "world",
    sourceTier: "1",
    imageUrl: "",
    ...overrides,
  };
}

describe("persistArticles", () => {
  it("counts duplicates as items minus rows returned from the INSERT", async () => {
    const items = [makeItem({}), makeItem({}), makeItem({})];
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("INSERT INTO articles")) {
        return [{ id: "10" }, { id: "11" }];
      }
      return [];
    });

    const result = await persistArticles(sql, items);
    expect(result.inserted).toBe(2);
    expect(result.duplicates).toBe(1);
  });

  it("issues exactly one set-based UPDATE for dup-group assignment, not per-row queries", async () => {
    const items = [makeItem({}), makeItem({}), makeItem({})];
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("INSERT INTO articles")) {
        return [{ id: "10" }, { id: "11" }];
      }
      return [];
    });

    await persistArticles(sql, items);

    // One INSERT batch + one dup-group UPDATE — no per-article round trips.
    expect(calls).toHaveLength(2);
    const updateCalls = calls.filter((c) => c.query.includes("UPDATE articles"));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values).toEqual([]);
  });

  it("dup-group UPDATE selects the earliest same-signature head within 48h, tie-broken by id, and excludes heads", async () => {
    const { sql, calls } = makeMockSql(() => []);
    await persistArticles(sql, [makeItem({})]);

    const updateCall = calls.find((c) => c.query.includes("UPDATE articles"));
    expect(updateCall).toBeDefined();
    const query = updateCall!.query;
    expect(query).toContain("h.title_signature = a.title_signature");
    expect(query).toContain("h.first_seen_at <= a.first_seen_at");
    expect(query).toContain("INTERVAL '48 hours'");
    expect(query).toContain("h.dup_group_id IS NULL");
    expect(query).toContain("a.dup_group_id IS NULL");
    expect(query).toContain("DISTINCT ON (a.id)");
    expect(query).toContain("ORDER BY a.id, h.first_seen_at ASC, h.id ASC");
    expect(query).toContain("heads.head_id <> heads.article_id");
  });

  it("stores published_at as NULL for a dateless item flagged publishedEstimated", async () => {
    const items = [makeItem({ published: "2026-07-15T00:00:00.000Z", publishedEstimated: true })];
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("INSERT INTO articles")) return [];
      return [];
    });

    await persistArticles(sql, items);

    const insertCall = calls.find((c) => c.query.includes("INSERT INTO articles"));
    expect(insertCall).toBeDefined();
    // 5th interpolation is the published_at array, per column order in the query.
    const publishedAtArray = insertCall!.values[4];
    expect(publishedAtArray).toEqual([null]);
  });

  it("stores published_at as given for a dated item without the flag", async () => {
    const items = [makeItem({ published: "2026-07-15T12:34:56.000Z" })];
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("INSERT INTO articles")) return [];
      return [];
    });

    await persistArticles(sql, items);

    const insertCall = calls.find((c) => c.query.includes("INSERT INTO articles"));
    expect(insertCall).toBeDefined();
    const publishedAtArray = insertCall!.values[4];
    expect(publishedAtArray).toEqual(["2026-07-15T12:34:56.000Z"]);
  });

  it("returns zero inserted/duplicates for an empty item list without querying", async () => {
    const { sql, calls } = makeMockSql(() => []);
    const result = await persistArticles(sql, []);
    expect(result).toEqual({ inserted: 0, duplicates: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe("sweepRetention", () => {
  it("issues the four expected deletes with correct intervals", async () => {
    const { sql, calls } = makeMockSql(() => []);
    await sweepRetention(sql);

    expect(calls).toHaveLength(4);
    expect(calls[0].query).toContain("DELETE FROM articles");
    expect(calls[0].query).toContain("30 days");
    expect(calls[1].query).toContain("DELETE FROM entity_mentions_hourly");
    expect(calls[1].query).toContain("180 days");
    expect(calls[2].query).toContain("DELETE FROM signals");
    expect(calls[2].query).toContain("state = 'dismissed'");
    expect(calls[2].query).toContain("90 days");
    expect(calls[3].query).toContain("DELETE FROM entity_candidates");
    expect(calls[3].query).toContain("14 days");
  });
});
