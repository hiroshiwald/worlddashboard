import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { persistArticles } from "../../ingest-writer";
import { processNewArticles } from "../../entity-ingest";
import { runDetectors } from "../../detectors";
import { getSettings } from "../../settings";
import { makePgSql, freshSchema } from "../helpers/pg-sql";
import type { Sql } from "../../db";
import type { FeedItem } from "../../../types";

const TEST_SCHEMA = "wd_test_warmup_gate";
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

const NATO_WORDS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
const RECENT_WORDS = ["Golf", "Hotel", "India", "Juliett", "Kilo", "Lima", "Mike", "November"];
const CATEGORIES = ["world", "politics", "business"];

describe.skipIf(!TEST_DATABASE_URL)("warm-up gate integration (real Postgres)", () => {
  beforeEach(async () => {
    await freshSchema(pool!, TEST_SCHEMA);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("stays silent on surge/first_seen/novel_edge for a day-1 launch fed a week of backdated publish dates, while cross_category still fires", async () => {
    // A feed pre-load: 6 articles co-mentioning Germany+NATO, published_at
    // spread 2-7 days in the past, but all ARRIVING now (persistArticles
    // stamps first_seen_at = now()). This fabricates exactly the baseline
    // spread (>=3 distinct bucket days) and edge/source volume that would
    // have fired the old, miscalibrated engine.
    const historical = NATO_WORDS.map((word, i) =>
      makeItem({
        title: `Germany and NATO discuss defense pact ${word}`,
        sourceName: `Hist Source ${i}`,
        link: `https://x.example.com/hist-${i}`,
        published: new Date(Date.now() - (7 - i) * 24 * 3600 * 1000).toISOString(),
      }),
    );
    // Today's spike: 8 more Germany-only articles across 3 distinct source
    // categories, also exercising cross_category (which must NOT be gated).
    const recent = RECENT_WORDS.map((word, i) =>
      makeItem({
        title: `Germany announces policy shift ${word}`,
        sourceName: `Today Source ${i}`,
        sourceCategory: CATEGORIES[i % CATEGORIES.length],
        link: `https://x.example.com/recent-${i}`,
        published: new Date(Date.now() - i * 3600 * 1000).toISOString(),
      }),
    );

    await persistArticles(sql!, [...historical, ...recent]);
    await processNewArticles(sql!);

    const [germany] = await sql!`SELECT id, first_seen_at FROM entities WHERE canonical_name = 'Germany'`;
    const [nato] = await sql!`SELECT id FROM entities WHERE canonical_name = 'NATO'`;
    expect(germany).toBeDefined();
    expect(nato).toBeDefined();
    // Confirms FIX 2 is in effect too: first_seen_at is arrival (now), not
    // the 7-day-old backdated publish date — otherwise the bootstrap guard
    // alone (not the warm-up gate) could explain the silence below.
    expect(Date.now() - new Date(germany.first_seen_at as string).getTime()).toBeLessThan(60_000);

    const germanyId = Number(germany.id);
    const settings = await getSettings(sql!);
    const candidates = await runDetectors(sql!, settings);

    expect(candidates.filter((c) => c.type === "surge")).toHaveLength(0);
    expect(candidates.filter((c) => c.type === "first_seen")).toHaveLength(0);
    expect(candidates.filter((c) => c.type === "novel_edge")).toHaveLength(0);
    expect(candidates.some((c) => c.type === "cross_category" && c.entityIds.includes(germanyId))).toBe(true);
  });

  it("post-warm-up: an old system epoch lets first_seen fire at warning (not critical) for 3 sources, and surge uses the correct effective-days denominator", async () => {
    // Establishes an old system epoch (9 days ago) so the warm-up gate has
    // cleared, and doubles as an old tracked entity clearing the separate
    // 72h entities-table bootstrap-cohort guard for Russia below.
    await sql!`
      INSERT INTO articles (content_hash, title_signature, title, link, published_at, first_seen_at, source_name, source_category, source_tier)
      VALUES ('epoch-seed', 'epoch-seed-sig', 'Epoch seed article', 'https://x.example.com/epoch-seed',
        now() - interval '9 days', now() - interval '9 days', 'Seed Source', 'world', '1')
    `;
    const [{ id: testlandId }] = (await sql!`
      INSERT INTO entities (canonical_name, type, status, first_seen_at, last_seen_at)
      VALUES ('Testland', 'country', 'tracked', now() - interval '9 days', now() - interval '9 days')
      RETURNING id
    `) as [{ id: number }];

    // A genuinely new entity, arriving today, mentioned by 3 distinct sources.
    const russiaArticles = [0, 1, 2].map((i) =>
      makeItem({
        title: `Russia announces new trade policy ${["One", "Two", "Three"][i]}`,
        sourceName: `Source R${i}`,
        link: `https://x.example.com/russia-${i}`,
        published: new Date(Date.now() - i * 3600 * 1000).toISOString(),
      }),
    );
    await persistArticles(sql!, russiaArticles);
    await processNewArticles(sql!);

    // A separate entity with a real (if modest) baseline plus a 10x spike.
    for (let day = 5; day <= 8; day++) {
      await sql!`
        INSERT INTO entity_mentions_hourly (entity_id, bucket, mentions, source_count, sentiment_sum)
        VALUES (${Number(testlandId)}, ${new Date(Date.now() - day * 24 * 3600 * 1000).toISOString()}, 2, 1, 0)
      `;
    }
    await sql!`
      INSERT INTO entity_mentions_hourly (entity_id, bucket, mentions, source_count, sentiment_sum)
      VALUES (${Number(testlandId)}, ${new Date(Date.now() - 2 * 3600 * 1000).toISOString()}, 20, 3, 0)
    `;

    const settings = await getSettings(sql!);
    const candidates = await runDetectors(sql!, settings);

    const [russia] = await sql!`SELECT id FROM entities WHERE canonical_name = 'Russia'`;
    const firstSeen = candidates.find((c) => c.dedupeKey === `first_seen:${russia.id}`);
    expect(firstSeen).toBeDefined();
    expect(firstSeen!.severity).toBe("warning"); // 3 sources: below the recalibrated critical threshold of 8
    expect(firstSeen!.evidence.sourceCount).toBe(3);

    const surge = candidates.find((c) => c.dedupeKey === `surge:${testlandId}`);
    expect(surge).toBeDefined();
    // Corrected denominator (effective days, not the old fixed 14) keeps z
    // in a sane range instead of the ~56σ the miscalibrated engine produced.
    expect(Math.abs(surge!.evidence.z as number)).toBeLessThan(15);
  });
});
