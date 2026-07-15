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
        return [
          { id: "10", title_signature: "sig-a", first_seen_at: "2026-07-10T00:00:00.000Z" },
          { id: "11", title_signature: "sig-b", first_seen_at: "2026-07-10T01:00:00.000Z" },
        ];
      }
      if (call.query.includes("SELECT id FROM articles")) return [];
      return [];
    });

    const result = await persistArticles(sql, items);
    expect(result.inserted).toBe(2);
    expect(result.duplicates).toBe(1);
  });

  it("assigns dup_group_id when an earlier head exists within the 48h window", async () => {
    const items = [makeItem({}), makeItem({})];
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("INSERT INTO articles")) {
        return [
          { id: "10", title_signature: "sig-a", first_seen_at: "2026-07-10T00:00:00.000Z" },
          { id: "11", title_signature: "sig-b", first_seen_at: "2026-07-10T01:00:00.000Z" },
        ];
      }
      if (call.query.includes("SELECT id FROM articles")) {
        const signature = call.values[0];
        // sig-a already has an earlier head (id 5); sig-b's earliest match is itself.
        if (signature === "sig-a") return [{ id: "5" }];
        return [{ id: "11" }];
      }
      return [];
    });

    await persistArticles(sql, items);

    const updates = calls.filter((c) => c.query.includes("UPDATE articles SET dup_group_id"));
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual(["5", "10"]);
  });

  it("does not assign dup_group_id when no earlier head is found", async () => {
    const items = [makeItem({})];
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("INSERT INTO articles")) {
        return [{ id: "20", title_signature: "sig-c", first_seen_at: "2026-07-10T00:00:00.000Z" }];
      }
      if (call.query.includes("SELECT id FROM articles")) return [];
      return [];
    });

    await persistArticles(sql, items);

    const updates = calls.filter((c) => c.query.includes("UPDATE articles SET dup_group_id"));
    expect(updates).toHaveLength(0);
  });

  it("stores published_at exactly as given on the item, real or stamped", async () => {
    const items = [
      makeItem({ published: "2020-01-01T00:00:00.000Z" }),
      makeItem({ published: "2026-07-15T12:34:56.000Z" }),
    ];
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("INSERT INTO articles")) return [];
      return [];
    });

    await persistArticles(sql, items);

    const insertCall = calls.find((c) => c.query.includes("INSERT INTO articles"));
    expect(insertCall).toBeDefined();
    // 5th interpolation is the published_at array, per column order in the query.
    const publishedAtArray = insertCall!.values[4];
    expect(publishedAtArray).toEqual(items.map((i) => i.published));
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
