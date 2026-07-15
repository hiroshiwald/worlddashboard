import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { runDetectors } from "../../detectors";
import { persistSignals, transitionSignal, loadSignals } from "../../signal-store";
import { getSettings } from "../../settings";
import { getBrief } from "../../brief";
import { makePgSql, freshSchema } from "../helpers/pg-sql";
import type { Sql } from "../../db";

const TEST_SCHEMA = "wd_test_signal_engine";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const pool = TEST_DATABASE_URL
  ? new Pool({ connectionString: TEST_DATABASE_URL, options: `-c search_path=${TEST_SCHEMA}` })
  : null;
const sql: Sql | null = pool ? makePgSql(pool) : null;

async function seedEntity(name: string, firstSeenAt: string): Promise<number> {
  const [{ id }] = (await sql!`
    INSERT INTO entities (canonical_name, type, status, first_seen_at, last_seen_at)
    VALUES (${name}, 'country', 'tracked', ${firstSeenAt}, ${firstSeenAt})
    RETURNING id
  `) as [{ id: number }];
  return Number(id);
}

/** 5 low-volume baseline days (>=3 days of history) plus a 24h spike —
 * reliably fires a critical surge for the default k=3 (2k=6; z here is ~14.7). */
async function seedSurgeHistory(entityId: number): Promise<void> {
  const now = Date.now();
  for (let day = 5; day <= 9; day++) {
    const bucket = new Date(now - day * 24 * 3600 * 1000).toISOString();
    await sql!`
      INSERT INTO entity_mentions_hourly (entity_id, bucket, mentions, source_count, sentiment_sum)
      VALUES (${entityId}, ${bucket}, 2, 1, 0)
    `;
  }
  const spikeBucket = new Date(now - 2 * 3600 * 1000).toISOString();
  await sql!`
    INSERT INTO entity_mentions_hourly (entity_id, bucket, mentions, source_count, sentiment_sum)
    VALUES (${entityId}, ${spikeBucket}, 20, 3, 0)
  `;
}

async function surgeSignalRows(entityId: number) {
  return sql!`SELECT id, dedupe_key, state, severity, entity_ids FROM signals WHERE dedupe_key = ${`surge:${entityId}`}`;
}

let nextArticleN = 0;
async function seedClusterHeadArticle(sourceName: string, sourceCategory: string, hoursAgo: number): Promise<number> {
  nextArticleN += 1;
  const publishedAt = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  const [{ id }] = (await sql!`
    INSERT INTO articles (content_hash, title_signature, title, link, published_at, source_name, source_category, source_tier)
    VALUES (${`hash-${nextArticleN}`}, ${`sig-${nextArticleN}`}, ${`Title ${nextArticleN}`}, ${`https://x.example.com/${nextArticleN}`},
      ${publishedAt}, ${sourceName}, ${sourceCategory}, '1')
    RETURNING id
  `) as [{ id: number }];
  return Number(id);
}

async function linkArticleEntity(articleId: number, entityId: number): Promise<void> {
  await sql!`INSERT INTO article_entities (article_id, entity_id) VALUES (${articleId}, ${entityId})`;
}

describe.skipIf(!TEST_DATABASE_URL)("signal engine integration (real Postgres)", () => {
  beforeEach(async () => {
    await freshSchema(pool!, TEST_SCHEMA);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("runDetectors + persistSignals writes a correct surge signal row", async () => {
    const entityId = await seedEntity("Testland", "2026-06-01T00:00:00Z");
    await seedSurgeHistory(entityId);

    const settings = await getSettings(sql!);
    const candidates = await runDetectors(sql!, settings);
    const surge = candidates.find((c) => c.dedupeKey === `surge:${entityId}`);
    expect(surge).toBeDefined();
    expect(surge!.severity).toBe("critical");
    expect(surge!.entityIds).toEqual([entityId]);

    const result = await persistSignals(sql!, candidates, settings);
    expect(result.created).toBe(1);

    const rows = await surgeSignalRows(entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("new");
    expect(rows[0].severity).toBe("critical");
    expect((rows[0].entity_ids as number[]).map(Number)).toEqual([entityId]);
  });

  it("a second run refreshes the existing active row instead of duplicating it (partial unique index respected)", async () => {
    const entityId = await seedEntity("Testland", "2026-06-01T00:00:00Z");
    await seedSurgeHistory(entityId);
    const settings = await getSettings(sql!);

    const first = await persistSignals(sql!, await runDetectors(sql!, settings), settings);
    expect(first.created).toBe(1);

    const second = await persistSignals(sql!, await runDetectors(sql!, settings), settings);
    expect(second.created).toBe(0);
    expect(second.refreshed).toBe(1);

    const rows = await surgeSignalRows(entityId);
    expect(rows).toHaveLength(1);
  });

  it("dismissing a signal suppresses its re-creation within the cooldown window", async () => {
    const entityId = await seedEntity("Testland", "2026-06-01T00:00:00Z");
    await seedSurgeHistory(entityId);
    const settings = await getSettings(sql!);

    await persistSignals(sql!, await runDetectors(sql!, settings), settings);
    const [{ id: signalId }] = await surgeSignalRows(entityId);
    expect(await transitionSignal(sql!, Number(signalId), "dismissed")).toBe(true);

    const result = await persistSignals(sql!, await runDetectors(sql!, settings), settings);
    expect(result.suppressed).toBe(1);
    expect(result.created).toBe(0);
    expect(result.refreshed).toBe(0);

    const rows = await surgeSignalRows(entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("dismissed");
  });

  it("transitions: reopen moves a dismissed signal back to new; illegal transitions return false", async () => {
    const entityId = await seedEntity("Testland", "2026-06-01T00:00:00Z");
    await seedSurgeHistory(entityId);
    const settings = await getSettings(sql!);
    await persistSignals(sql!, await runDetectors(sql!, settings), settings);
    const [{ id: signalId }] = await surgeSignalRows(entityId);

    expect(await transitionSignal(sql!, Number(signalId), "reopen")).toBe(false); // not dismissed yet
    expect(await transitionSignal(sql!, Number(signalId), "dismissed")).toBe(true);
    expect(await transitionSignal(sql!, Number(signalId), "seen")).toBe(false); // dismissed -> only reopen
    expect(await transitionSignal(sql!, Number(signalId), "reopen")).toBe(true);

    const [row] = await sql!`SELECT state FROM signals WHERE id = ${signalId}`;
    expect(row.state).toBe("new");
    expect(await transitionSignal(sql!, 999999, "seen")).toBe(false); // unknown id
  });

  it("loadSignals resolves entity names and orders severity-first", async () => {
    const entityId = await seedEntity("Testland", "2026-06-01T00:00:00Z");
    await seedSurgeHistory(entityId);
    const settings = await getSettings(sql!);
    await persistSignals(sql!, await runDetectors(sql!, settings), settings);

    const signals = await loadSignals(sql!, ["new", "seen", "promoted"]);
    expect(signals).toHaveLength(1);
    expect(signals[0].entityNames).toEqual(["Testland"]);
    expect(signals[0].severity).toBe("critical");
  });

  it("loadSignals resolves evidence.articleIds to real article title/link/source", async () => {
    const entityId = await seedEntity("Testland", "2026-06-01T00:00:00Z");
    await seedSurgeHistory(entityId);
    const publishedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const [{ id: articleId }] = (await sql!`
      INSERT INTO articles (content_hash, title_signature, title, link, published_at, source_name, source_category, source_tier)
      VALUES ('hash-evidence', 'sig-evidence', 'Testland Coverage', 'https://a.example.com/evidence', ${publishedAt}, 'Source A', 'world', '1')
      RETURNING id
    `) as [{ id: number }];
    await sql!`INSERT INTO article_entities (article_id, entity_id) VALUES (${articleId}, ${entityId})`;

    const settings = await getSettings(sql!);
    await persistSignals(sql!, await runDetectors(sql!, settings), settings);

    const [signal] = await loadSignals(sql!, ["new", "seen", "promoted"]);
    expect(signal.evidence.articleIds).toEqual([Number(articleId)]);
    expect(signal.articles).toEqual([
      { id: Number(articleId), title: "Testland Coverage", link: "https://a.example.com/evidence", sourceName: "Source A" },
    ]);
  });

  it("first-seen novelty fires for a recent entity with >=2 distinct sources, and the bootstrap guard suppresses a same-cohort entity", async () => {
    // Bootstrap cohort: first tracked entity ever (300h ago), sets the global MIN(first_seen_at)
    // far enough back that a later entity can clear the 72h guard while still being within the
    // 48h "recent" window the first-seen detector itself requires.
    // Global min set far in the past (300h ago, outside the detector's own 48h recency
    // window) purely to establish a baseline that the "genuinely new" entity below clears.
    const bootstrapId = await seedEntity("Bootstrapland", new Date(Date.now() - 300 * 3600 * 1000).toISOString());
    const bootstrapArticle = await seedClusterHeadArticle("Source A", "world", 2);
    await linkArticleEntity(bootstrapArticle, bootstrapId);

    // Genuinely new: first seen 20h ago — within 48h AND well past 72h after the global min.
    const newId = await seedEntity("Kestrelia", new Date(Date.now() - 20 * 3600 * 1000).toISOString());
    const a1 = await seedClusterHeadArticle("Source A", "world", 2);
    const a2 = await seedClusterHeadArticle("Source B", "politics", 3);
    const a3 = await seedClusterHeadArticle("Source C", "world", 4);
    await linkArticleEntity(a1, newId);
    await linkArticleEntity(a2, newId);
    await linkArticleEntity(a3, newId);

    const settings = await getSettings(sql!);
    const candidates = await runDetectors(sql!, settings);

    const novel = candidates.find((c) => c.dedupeKey === `first_seen:${newId}`);
    expect(novel).toBeDefined();
    expect(novel!.severity).toBe("warning"); // 3 sources: warning (critical requires >=4)
    expect(novel!.evidence.sourceCount).toBe(3);
    expect((novel!.evidence.articleIds as number[]).sort()).toEqual([a1, a2, a3].sort());
  });

  it("bootstrap guard suppresses an entity that IS the global-min first_seen_at even though it's within the 48h recency window", async () => {
    // An entity within 48h can only be suppressed by the 72h-since-global-min guard if it's
    // close to the global min itself (two points both within 48h of "now" can never be >72h
    // apart) — so this seeds the earliest entity ever, itself recent, and expects it suppressed.
    const cohortId = await seedEntity("Cohortland", new Date(Date.now() - 10 * 3600 * 1000).toISOString());
    const a1 = await seedClusterHeadArticle("Source A", "world", 2);
    const a2 = await seedClusterHeadArticle("Source B", "politics", 3);
    await linkArticleEntity(a1, cohortId);
    await linkArticleEntity(a2, cohortId);

    const settings = await getSettings(sql!);
    const candidates = await runDetectors(sql!, settings);
    expect(candidates.find((c) => c.dedupeKey === `first_seen:${cohortId}`)).toBeUndefined();
  });

  it("novel edge fires for two co-mentioned recently-linked tracked entities and resolves shared evidence articles", async () => {
    const bootstrapId = await seedEntity("Bootstrapland", new Date(Date.now() - 500 * 3600 * 1000).toISOString());
    const entityA = await seedEntity("Alpha Nation", new Date(Date.now() - 500 * 3600 * 1000).toISOString());
    const entityB = await seedEntity("Beta Republic", new Date(Date.now() - 500 * 3600 * 1000).toISOString());
    const [a, b] = [entityA, entityB].sort((x, y) => x - y);

    const article1 = await seedClusterHeadArticle("Source A", "world", 2);
    const article2 = await seedClusterHeadArticle("Source B", "world", 3);
    for (const articleId of [article1, article2]) {
      await linkArticleEntity(articleId, entityA);
      await linkArticleEntity(articleId, entityB);
    }
    await sql!`
      INSERT INTO entity_edges (entity_a, entity_b, first_seen_at, last_seen_at, article_count)
      VALUES (${a}, ${b}, now() - interval '10 hours', now() - interval '1 hour', 2)
    `;
    // A much older edge sets the global MIN(first_seen_at) for entity_edges so this new one clears the bootstrap guard.
    await sql!`
      INSERT INTO entity_edges (entity_a, entity_b, first_seen_at, last_seen_at, article_count)
      VALUES (${Math.min(bootstrapId, a)}, ${Math.max(bootstrapId, a)}, now() - interval '500 hours', now() - interval '400 hours', 5)
    `;

    const settings = await getSettings(sql!);
    const candidates = await runDetectors(sql!, settings);
    const edgeSignal = candidates.find((c) => c.dedupeKey === `novel_edge:${a}:${b}`);
    expect(edgeSignal).toBeDefined();
    expect(edgeSignal!.severity).toBe("warning");
    expect(edgeSignal!.entityIds).toEqual([a, b]);
    expect((edgeSignal!.evidence.articleIds as number[]).sort()).toEqual([article1, article2].sort());
  });

  it("cross-category convergence fires once an entity spans >=3 distinct source categories in 24h", async () => {
    const entityId = await seedEntity("Multitopia", new Date(Date.now() - 500 * 3600 * 1000).toISOString());
    const categories = ["world", "politics", "business"];
    for (const category of categories) {
      const articleId = await seedClusterHeadArticle(`Source ${category}`, category, 2);
      await linkArticleEntity(articleId, entityId);
    }

    const settings = await getSettings(sql!);
    const candidates = await runDetectors(sql!, settings);
    const signal = candidates.find((c) => c.dedupeKey === `cross_category:${entityId}`);
    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("advisory");
    expect(signal!.evidence.categoryCount).toBe(3);
  });

  it("getBrief's top-stories source count doesn't double-count a member sharing the head's own source", async () => {
    const publishedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const [{ id: headId }] = (await sql!`
      INSERT INTO articles (content_hash, title_signature, title, link, published_at, source_name, source_category, source_tier)
      VALUES ('hash-same-src-1', 'sig-same-src', 'Same source head', 'https://a.example.com/same1', ${publishedAt}, 'Source A', 'world', '1')
      RETURNING id
    `) as [{ id: number }];
    await sql!`
      INSERT INTO articles (content_hash, title_signature, title, link, published_at, source_name, source_category, source_tier, dup_group_id)
      VALUES ('hash-same-src-2', 'sig-same-src', 'Same source member', 'https://a.example.com/same2', ${publishedAt}, 'Source A', 'world', '1', ${headId})
    `;

    const settings = await getSettings(sql!);
    const brief = await getBrief(sql!, settings);
    const story = brief.topStories.find((s) => s.id === Number(headId));
    expect(story).toBeDefined();
    expect(story!.clusterSize).toBe(2);
    expect(story!.sourceCount).toBe(1); // both rows are "Source A" — must dedupe, not double-count
  });

  it("getBrief returns ranked top stories with correct cluster size and source count", async () => {
    const publishedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const [{ id: headId }] = (await sql!`
      INSERT INTO articles (content_hash, title_signature, title, link, published_at, source_name, source_category, source_tier)
      VALUES ('hash-1', 'sig-1', 'Head story', 'https://a.example.com/1', ${publishedAt}, 'Source A', 'world', '1')
      RETURNING id
    `) as [{ id: number }];
    await sql!`
      INSERT INTO articles (content_hash, title_signature, title, link, published_at, source_name, source_category, source_tier, dup_group_id)
      VALUES ('hash-2', 'sig-1', 'Head story dup', 'https://b.example.com/2', ${publishedAt}, 'Source B', 'world', '1', ${headId})
    `;

    const settings = await getSettings(sql!);
    const brief = await getBrief(sql!, settings);
    expect(brief.topStories).toHaveLength(1);
    expect(brief.topStories[0].id).toBe(Number(headId));
    expect(brief.topStories[0].clusterSize).toBe(2);
    expect(brief.topStories[0].sourceCount).toBe(2);
    expect(typeof brief.generatedAt).toBe("string");
  });
});
