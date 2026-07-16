import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { persistArticles } from "../../ingest-writer";
import { processNewArticles } from "../../entity-ingest";
import { scoreSentiment } from "../../../entity-extractor";
import { makePgSql, freshSchema } from "../helpers/pg-sql";
import type { Sql, SqlRow } from "../../db";
import type { FeedItem } from "../../../types";

const TEST_SCHEMA = "wd_test_entity_ingest";
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

const HEAD_TITLE = "Germany and NATO meet with Jonas Kestrel today";
const MEMBER_TITLE = "Jonas Kestrel to meet NATO and Germany today";
const ARTICLE2_TITLE = "Jonas Kestrel opens new investigation into fraud";
const ARTICLE3_TITLE = "Officials meet Jonas Kestrel over trade dispute";

/** Seeds a cluster head mentioning two dictionary entities (Germany,
 * NATO) and an unresolved recurring name ("Jonas Kestrel"), a cross-source
 * duplicate member of that head, and two further standalone articles that
 * also mention "Jonas Kestrel" on two later days from distinct sources.
 * The head is inserted (and committed) in its own call before the member
 * exists, so there is never a first_seen_at tie for assignDupGroups to
 * break — the head is deterministically the survivor. */
async function seedArticles(): Promise<{ headId: string; memberId: string }> {
  const head = makeItem({
    title: HEAD_TITLE, sourceName: "Source A", link: "https://a.example.com/head",
    published: "2026-07-10T09:00:00.000Z",
  });
  await persistArticles(sql!, [head]);
  const [{ id: headId }] = (await sql!`SELECT id FROM articles WHERE source_name = 'Source A'`) as [{ id: string }];

  const member = makeItem({
    title: MEMBER_TITLE, sourceName: "Source B", link: "https://b.example.com/member",
    published: "2026-07-10T10:00:00.000Z",
  });
  const article2 = makeItem({
    title: ARTICLE2_TITLE, sourceName: "Source C", link: "https://c.example.com/article2",
    published: "2026-07-11T09:00:00.000Z",
  });
  const article3 = makeItem({
    title: ARTICLE3_TITLE, sourceName: "Source D", link: "https://d.example.com/article3",
    published: "2026-07-12T09:00:00.000Z",
  });
  await persistArticles(sql!, [member, article2, article3]);
  const [{ id: memberId }] = (await sql!`SELECT id FROM articles WHERE source_name = 'Source B'`) as [{ id: string }];

  return { headId, memberId };
}

async function snapshotAggregates(): Promise<Record<string, SqlRow[]>> {
  return {
    articleEntities: await sql!`SELECT article_id, entity_id FROM article_entities ORDER BY article_id, entity_id`,
    hourly: await sql!`SELECT entity_id, bucket, mentions, source_count, sentiment_sum FROM entity_mentions_hourly ORDER BY entity_id`,
    edges: await sql!`SELECT entity_a, entity_b, article_count FROM entity_edges`,
    candidates: await sql!`SELECT name_norm, mention_count, day_count, source_names FROM entity_candidates`,
    entities: await sql!`SELECT id, canonical_name, first_seen_at, last_seen_at FROM entities ORDER BY id`,
  };
}

describe.skipIf(!TEST_DATABASE_URL)("entity-ingest integration (real Postgres)", () => {
  beforeEach(async () => {
    await freshSchema(pool!, TEST_SCHEMA);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("processNewArticles happy path: dictionary entities, cluster-head-only mentions, hourly/edge/candidate rollups", async () => {
    const { headId, memberId } = await seedArticles();

    const stats = await processNewArticles(sql!);
    expect(stats.articlesProcessed).toBe(3); // head, article2, article3 — the duplicate member is never selected
    expect(stats.newEntities).toBe(2); // Germany, NATO
    expect(stats.mentionsWritten).toBe(2);
    expect(stats.candidatesTouched).toBe(1);

    const entities = await sql!`SELECT id, canonical_name, type, first_seen_at, last_seen_at FROM entities ORDER BY canonical_name`;
    expect(entities).toHaveLength(2);
    const germany = entities.find((e) => e.canonical_name === "Germany")!;
    const nato = entities.find((e) => e.canonical_name === "NATO")!;
    expect(germany.type).toBe("country");
    expect(nato.type).toBe("organization");
    // Watch-time (arrival), not news-time: the head article's published_at is
    // 2026-07-10, but persistArticles stamps first_seen_at at insert time (now).
    expect(Date.now() - new Date(germany.first_seen_at as string).getTime()).toBeLessThan(60_000);
    expect(new Date(germany.first_seen_at as string).getTime()).toBe(new Date(germany.last_seen_at as string).getTime());

    // article_entities: cluster heads only — the duplicate member never gets a row.
    const articleEntities = await sql!`SELECT article_id, entity_id FROM article_entities ORDER BY article_id, entity_id`;
    expect(articleEntities).toHaveLength(2);
    expect(articleEntities.every((r) => r.article_id === headId)).toBe(true);
    expect(articleEntities.some((r) => r.article_id === memberId)).toBe(false);

    // entity_mentions_hourly: bucketed on COALESCE(published_at, first_seen_at).
    const expectedSentiment = scoreSentiment(`${HEAD_TITLE} `);
    const hourly = await sql!`SELECT entity_id, bucket, mentions, source_count, sentiment_sum FROM entity_mentions_hourly ORDER BY entity_id`;
    expect(hourly).toHaveLength(2);
    for (const row of hourly) {
      expect(new Date(row.bucket as string).toISOString()).toBe("2026-07-10T09:00:00.000Z");
      expect(row.mentions).toBe(1);
      expect(row.source_count).toBe(1);
      expect(row.sentiment_sum as number).toBeCloseTo(expectedSentiment, 5);
    }

    // entity_edges: a<b pair ordering, one article co-mentioning both.
    const germanyId = Number(germany.id);
    const natoId = Number(nato.id);
    const [a, b] = [germanyId, natoId].sort((x, y) => x - y);
    const edges = await sql!`SELECT entity_a, entity_b, article_count FROM entity_edges`;
    expect(edges).toHaveLength(1);
    expect(Number(edges[0].entity_a)).toBe(a);
    expect(Number(edges[0].entity_b)).toBe(b);
    expect(edges[0].article_count).toBe(1);

    // entity_candidates: the recurring unresolved name, rolled up across 3 heads/sources/days.
    const candidates = await sql!`SELECT name_norm, display_name, type_hint, mention_count, source_names, day_count FROM entity_candidates`;
    expect(candidates).toHaveLength(1);
    const jonas = candidates[0];
    expect(jonas.name_norm).toBe("jonas kestrel");
    expect(jonas.display_name).toBe("Jonas Kestrel");
    expect(jonas.type_hint).toBe("person");
    expect(jonas.mention_count).toBe(3);
    expect(jonas.day_count).toBe(3);
    expect(new Set(jonas.source_names as string[])).toEqual(new Set(["Source A", "Source C", "Source D"]));
  });

  it("is idempotent: a second run processes zero articles and changes no counts anywhere", async () => {
    await seedArticles();
    const first = await processNewArticles(sql!);
    expect(first.articlesProcessed).toBe(3);

    const before = await snapshotAggregates();
    const second = await processNewArticles(sql!);
    const after = await snapshotAggregates();

    expect(second).toEqual({
      articlesProcessed: 0,
      mentionsWritten: 0,
      newEntities: 0,
      candidatesTouched: 0,
      llm: { used: false, articles: 0, monthCostUsd: 0 },
      entities: { autoAccepted: 0 },
      relations: { written: 0 },
    });
    expect(after).toEqual(before);
  });

  it("advances entities.last_seen_at on a later ARRIVAL even with a backdated published_at, leaving first_seen_at untouched", async () => {
    await seedArticles();
    await processNewArticles(sql!);
    const [before] = await sql!`SELECT first_seen_at, last_seen_at FROM entities WHERE canonical_name = 'Germany'`;

    // published_at is deliberately backdated (2020) to prove last_seen_at
    // tracks ARRIVAL, not publish date: under the old effectiveAt-based bump,
    // GREATEST(last_seen_at, 2020) would leave last_seen_at unchanged.
    const laterArticle = makeItem({
      title: "Germany announces new export controls",
      sourceName: "Source E",
      link: "https://e.example.com/later",
      published: "2020-01-01T00:00:00.000Z",
    });
    await persistArticles(sql!, [laterArticle]);
    await processNewArticles(sql!);

    const [after] = await sql!`SELECT first_seen_at, last_seen_at FROM entities WHERE canonical_name = 'Germany'`;
    expect(new Date(after.first_seen_at as string).getTime()).toBe(new Date(before.first_seen_at as string).getTime());
    expect(new Date(after.last_seen_at as string).getTime()).toBeGreaterThan(new Date(before.last_seen_at as string).getTime());
    expect(Date.now() - new Date(after.last_seen_at as string).getTime()).toBeLessThan(60_000);
  });

  it("candidate accept flow at the SQL level: an accepted name resolves on the next article, and no candidate row reappears", async () => {
    await seedArticles();
    await processNewArticles(sql!);

    const [candidate] = await sql!`SELECT display_name, type_hint, first_seen_at, last_seen_at FROM entity_candidates WHERE name_norm = 'jonas kestrel'`;
    expect(candidate).toBeDefined();

    const [{ id: acceptedId }] = (await sql!`
      INSERT INTO entities (canonical_name, type, status, first_seen_at, last_seen_at)
      VALUES (${candidate.display_name}, ${candidate.type_hint}, 'tracked', ${candidate.first_seen_at}, ${candidate.last_seen_at})
      RETURNING id
    `) as [{ id: string }];
    await sql!`DELETE FROM entity_candidates WHERE name_norm = 'jonas kestrel'`;

    const followUp = makeItem({
      title: "Jonas Kestrel unveils new fraud task force",
      sourceName: "Source F",
      link: "https://f.example.com/followup",
      published: "2026-07-13T09:00:00.000Z",
    });
    await persistArticles(sql!, [followUp]);
    await processNewArticles(sql!);

    const [{ id: followUpId }] = (await sql!`SELECT id FROM articles WHERE source_name = 'Source F'`) as [{ id: string }];
    const linked = await sql!`SELECT entity_id FROM article_entities WHERE article_id = ${followUpId}`;
    expect(linked).toHaveLength(1);
    expect(linked[0].entity_id).toEqual(acceptedId);

    expect(await sql!`SELECT 1 AS present FROM entity_candidates WHERE name_norm = 'jonas kestrel'`).toHaveLength(0);

    // last_seen_at bumps to the follow-up's ARRIVAL (now), not its 2026-07-13 published_at.
    const [entityRow] = await sql!`SELECT last_seen_at FROM entities WHERE id = ${acceptedId}`;
    expect(Date.now() - new Date(entityRow.last_seen_at as string).getTime()).toBeLessThan(60_000);
  });
});
