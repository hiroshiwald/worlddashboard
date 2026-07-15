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
