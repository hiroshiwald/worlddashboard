import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { persistArticles, sweepRetention } from "../../ingest-writer";
import { makePgSql, freshSchema } from "../helpers/pg-sql";
import type { Sql } from "../../db";
import type { FeedItem } from "../../../types";

const TEST_SCHEMA = "wd_test_ingest_writer";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const pool = TEST_DATABASE_URL
  ? new Pool({ connectionString: TEST_DATABASE_URL, options: `-c search_path=${TEST_SCHEMA}` })
  : null;
const sql: Sql | null = pool ? makePgSql(pool) : null;

let nextId = 0;
function makeItem(overrides: Partial<FeedItem>): FeedItem {
  nextId += 1;
  return {
    id: `item-${nextId}`,
    title: `Title ${nextId}`,
    link: `https://source-${nextId}.example.com/${nextId}`,
    published: "2026-07-10T09:00:00.000Z",
    summary: "",
    sourceName: "Source A",
    sourceCategory: "world",
    sourceTier: "1",
    imageUrl: "",
    ...overrides,
  };
}

describe.skipIf(!TEST_DATABASE_URL)("ingest-writer integration (real Postgres)", () => {
  beforeEach(async () => {
    await freshSchema(pool!, TEST_SCHEMA);
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("persistArticles", () => {
    it("inserts an exact-duplicate pair once; a re-run inserts zero and reports it as a duplicate", async () => {
      const item = makeItem({ title: "Border clash reported near frontier", link: "https://a.example.com/story" });

      const first = await persistArticles(sql!, [item, { ...item }]);
      expect(first.inserted).toBe(1);
      expect(first.duplicates).toBe(1);
      expect(await sql!`SELECT id FROM articles`).toHaveLength(1);

      const second = await persistArticles(sql!, [item]);
      expect(second.inserted).toBe(0);
      expect(second.duplicates).toBe(1);
      expect(await sql!`SELECT id FROM articles`).toHaveLength(1);
    });

    it("stores published_at NULL for a dateless item flagged publishedEstimated", async () => {
      const item = makeItem({ publishedEstimated: true });
      await persistArticles(sql!, [item]);

      const rows = await sql!`SELECT published_at FROM articles`;
      expect(rows).toHaveLength(1);
      expect(rows[0].published_at).toBeNull();
    });

    it("links a cross-source paraphrase sharing a title_signature to the earliest article as head", async () => {
      const head = makeItem({
        title: "Zebravik forces mobilize near eastern border",
        sourceName: "Source A",
        link: "https://a.example.com/1",
      });
      const member = makeItem({
        title: "Near eastern border, Zebravik forces mobilize",
        sourceName: "Source B",
        link: "https://b.example.com/2",
      });

      await persistArticles(sql!, [head, member]);

      const rows = await sql!`SELECT id, dup_group_id FROM articles ORDER BY id ASC`;
      expect(rows).toHaveLength(2);
      const heads = rows.filter((r) => r.dup_group_id === null);
      const members = rows.filter((r) => r.dup_group_id !== null);
      expect(heads).toHaveLength(1);
      expect(members).toHaveLength(1);
      expect(members[0].dup_group_id).toEqual(heads[0].id);
    });
  });

  describe("recurring-headline semantics across three consecutive days", () => {
    it("attaches day 2 to day 1's head, then starts a new head on day 3 once day 1 ages out of the 48h window", async () => {
      const title = "Kestrel Basin unrest continues near the frontier";
      const day1 = makeItem({ title, sourceName: "Source A", link: "https://source-a.example.com/day1" });
      const day2 = makeItem({ title, sourceName: "Source B", link: "https://source-b.example.com/day2" });
      const day3 = makeItem({ title, sourceName: "Source C", link: "https://source-c.example.com/day3" });

      await persistArticles(sql!, [day1]);
      const [{ id: day1Id }] = await sql!`SELECT id FROM articles WHERE source_name = 'Source A'`;
      expect((await sql!`SELECT dup_group_id FROM articles WHERE id = ${day1Id}`)[0].dup_group_id).toBeNull();

      // Backdate day 1 to 40h ago — still inside day 2's 48h lookback window.
      await sql!`UPDATE articles SET first_seen_at = now() - INTERVAL '40 hours' WHERE id = ${day1Id}`;
      await persistArticles(sql!, [day2]);
      const [{ id: day2Id }] = await sql!`SELECT id FROM articles WHERE source_name = 'Source B'`;
      expect((await sql!`SELECT dup_group_id FROM articles WHERE id = ${day2Id}`)[0].dup_group_id).toEqual(day1Id);

      // Push day 1 further back so it's now outside any future 48h window;
      // day 2 is disqualified as a head by construction (dup_group_id is set).
      await sql!`UPDATE articles SET first_seen_at = now() - INTERVAL '50 hours' WHERE id = ${day1Id}`;
      await persistArticles(sql!, [day3]);
      const [{ id: day3Id }] = await sql!`SELECT id FROM articles WHERE source_name = 'Source C'`;
      const day3Row = (await sql!`SELECT dup_group_id FROM articles WHERE id = ${day3Id}`)[0];
      expect(day3Row.dup_group_id).toBeNull();
    });
  });

  describe("sweepRetention", () => {
    it("deletes an article backdated past 30 days without error", async () => {
      const item = makeItem({ title: "Old story nobody reads anymore" });
      await persistArticles(sql!, [item]);
      const [{ id }] = await sql!`SELECT id FROM articles`;
      await sql!`UPDATE articles SET first_seen_at = now() - INTERVAL '31 days' WHERE id = ${id}`;

      await sweepRetention(sql!);

      expect(await sql!`SELECT id FROM articles WHERE id = ${id}`).toHaveLength(0);
    });

    it("nulls dup_group_id on a younger member (ON DELETE SET NULL) when its head ages out at 30 days", async () => {
      const head = makeItem({
        title: "Skyline treaty talks resume this week",
        sourceName: "Source A",
        link: "https://a.example.com/head",
      });
      const member = makeItem({
        title: "Skyline treaty talks resume this week",
        sourceName: "Source B",
        link: "https://b.example.com/member",
      });

      await persistArticles(sql!, [head]);
      await persistArticles(sql!, [member]);

      const [{ id: headId }] = await sql!`SELECT id FROM articles WHERE source_name = 'Source A'`;
      const [{ id: memberId }] = await sql!`SELECT id FROM articles WHERE source_name = 'Source B'`;
      expect((await sql!`SELECT dup_group_id FROM articles WHERE id = ${memberId}`)[0].dup_group_id).toEqual(headId);

      // Head crosses the 30-day retention cutoff; the member stays under it
      // (a dup-group head can be up to 48h older than a member it linked).
      await sql!`UPDATE articles SET first_seen_at = now() - INTERVAL '31 days' WHERE id = ${headId}`;
      await sql!`UPDATE articles SET first_seen_at = now() - INTERVAL '29 days' WHERE id = ${memberId}`;

      await expect(sweepRetention(sql!)).resolves.not.toThrow();

      expect(await sql!`SELECT id FROM articles WHERE id = ${headId}`).toHaveLength(0);
      const memberRows = await sql!`SELECT dup_group_id FROM articles WHERE id = ${memberId}`;
      expect(memberRows).toHaveLength(1);
      expect(memberRows[0].dup_group_id).toBeNull();
    });
  });
});
