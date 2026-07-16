import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { persistArticles } from "../../ingest-writer";
import { processNewArticles } from "../../entity-ingest";
import { makePgSql, freshSchema } from "../helpers/pg-sql";
import type { Sql } from "../../db";
import type { FeedItem } from "../../../types";

const TEST_SCHEMA = "wd_test_llm_extract";
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

function anthropicResponse(text: string, usage = { input_tokens: 1000, output_tokens: 500 }) {
  return { content: [{ type: "text", text }], usage };
}

function mockFetchResolved(body: unknown, opts: { ok?: boolean; status?: number } = {}) {
  const fn = vi.fn().mockResolvedValue({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const originalKey = process.env.ANTHROPIC_API_KEY;

describe.skipIf(!TEST_DATABASE_URL)("LLM extraction integration (real Postgres, mocked fetch)", () => {
  beforeEach(async () => {
    await freshSchema(pool!, TEST_SCHEMA);
    process.env.ANTHROPIC_API_KEY = "test-key";
    // No test in this file may reach the real network — a call to an
    // un-mocked fetch throws instead of silently escaping to api.anthropic.com.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("fetch must be mocked per test");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("upserts llm_usage cumulatively across two ingest runs", async () => {
    mockFetchResolved(anthropicResponse("[]", { input_tokens: 1000, output_tokens: 500 }));
    await persistArticles(sql!, [makeItem({ title: "First run headline about a topic", sourceName: "Source A" })]);
    await processNewArticles(sql!);

    let rows = await sql!`SELECT input_tokens, output_tokens, calls FROM llm_usage`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].input_tokens)).toBe(1000);
    expect(Number(rows[0].output_tokens)).toBe(500);
    expect(Number(rows[0].calls)).toBe(1);

    mockFetchResolved(anthropicResponse("[]", { input_tokens: 2000, output_tokens: 800 }));
    await persistArticles(sql!, [makeItem({ title: "Second run headline about a topic", sourceName: "Source B" })]);
    await processNewArticles(sql!);

    rows = await sql!`SELECT input_tokens, output_tokens, calls FROM llm_usage`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].input_tokens)).toBe(3000);
    expect(Number(rows[0].output_tokens)).toBe(1300);
    expect(Number(rows[0].calls)).toBe(2);
  });

  it("carries contexts and co_entities through the full pipeline into entity_candidates", async () => {
    mockFetchResolved(
      anthropicResponse(
        JSON.stringify([{ index: 0, entities: [{ name: "Jonas Kestrel", type: "person", role: "former IRGC commander" }] }]),
      ),
    );
    await persistArticles(sql!, [makeItem({ title: "Jonas Kestrel met officials in Germany today", sourceName: "Source A" })]);

    const stats = await processNewArticles(sql!);
    expect(stats.llm).toEqual({ used: true, articles: 1, monthCostUsd: expect.any(Number) });
    expect(stats.newEntities).toBe(1); // Germany, via the dictionary layer union

    const candidates = await sql!`SELECT name_norm, contexts, co_entities FROM entity_candidates WHERE name_norm = 'jonas kestrel'`;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].contexts).toEqual(["former IRGC commander"]);
    expect(candidates[0].co_entities).toEqual(["Germany"]);
  });

  it("an LLM-failure run still processes articles heuristically and marks them processed", async () => {
    mockFetchResolved({}, { ok: false, status: 529 });
    await persistArticles(sql!, [makeItem({ title: "Russia announces new policy", sourceName: "Source A" })]);

    const stats = await processNewArticles(sql!);

    expect(stats.llm).toEqual({ used: false, articles: 0, monthCostUsd: 0 });
    expect(stats.articlesProcessed).toBe(1);
    expect(stats.newEntities).toBe(1);

    const [entity] = await sql!`SELECT canonical_name FROM entities WHERE canonical_name = 'Russia'`;
    expect(entity).toBeDefined();

    const [article] = await sql!`SELECT entities_processed_at FROM articles WHERE source_name = 'Source A'`;
    expect(article.entities_processed_at).not.toBeNull();
  });

  it("calls the real Anthropic endpoint URL (proves the mock, not a live network call, produced the result)", async () => {
    const fetchMock = mockFetchResolved(anthropicResponse("[]"));
    await persistArticles(sql!, [makeItem({ title: "Some headline about a topic", sourceName: "Source A" })]);
    await processNewArticles(sql!);

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
  });

  // ---- Hyundai scenario: v2 ontology, famous auto-accept, typed relations ----

  const HYUNDAI_TITLE = "Hyundai acquires stake in Boston Dynamics";

  function hyundaiResponse(boston: { prominence: string }) {
    return anthropicResponse(
      JSON.stringify([
        {
          index: 0,
          entities: [
            { name: "Hyundai", type: "company", prominence: "famous" },
            { name: "Boston Dynamics", type: "company", prominence: boston.prominence },
            { name: "Jane Doe", type: "person", role: "CEO", prominence: "known" },
          ],
          relations: [{ source: "Hyundai", target: "Boston Dynamics", relation: "acquisition" }],
        },
      ]),
    );
  }

  it("Hyundai scenario: the famous company auto-tracks, the obscure company and the person land in candidates with role context, and the relation is dropped while an endpoint stays unresolved", async () => {
    mockFetchResolved(hyundaiResponse({ prominence: "obscure" }));
    await persistArticles(sql!, [makeItem({ title: HYUNDAI_TITLE, sourceName: "Source A" })]);

    const stats = await processNewArticles(sql!);

    expect(stats.entities.autoAccepted).toBe(1);
    expect(stats.relations.written).toBe(0); // Boston Dynamics hasn't resolved yet this run

    const hyundai = await sql!`SELECT type, status FROM entities WHERE canonical_name = 'Hyundai'`;
    expect(hyundai).toEqual([{ type: "company", status: "tracked" }]);

    const candidates = await sql!`SELECT name_norm, type_hint, contexts FROM entity_candidates ORDER BY name_norm`;
    expect(candidates.map((c) => c.name_norm)).toEqual(["boston dynamics", "jane doe"]);
    expect(candidates.find((c) => c.name_norm === "boston dynamics")!.type_hint).toBe("company");
    expect(candidates.find((c) => c.name_norm === "jane doe")!.contexts).toEqual(["CEO"]);

    expect(await sql!`SELECT 1 FROM entity_relations`).toHaveLength(0);
  });

  it("Hyundai scenario: once the unresolved endpoint is accepted, a recurrence of the story writes the relation with correct endpoints/direction", async () => {
    mockFetchResolved(hyundaiResponse({ prominence: "obscure" }));
    await persistArticles(sql!, [makeItem({ title: HYUNDAI_TITLE, sourceName: "Source A" })]);
    await processNewArticles(sql!);
    expect(await sql!`SELECT 1 FROM entity_relations`).toHaveLength(0);

    // A human accepts Boston Dynamics from the review queue (SQL-level, mirrors
    // entity-ingest.integration.test.ts's candidate-accept-flow test).
    const [candidate] = await sql!`
      SELECT display_name, type_hint, first_seen_at, last_seen_at FROM entity_candidates WHERE name_norm = 'boston dynamics'
    `;
    await sql!`
      INSERT INTO entities (canonical_name, type, status, first_seen_at, last_seen_at)
      VALUES (${candidate.display_name}, ${candidate.type_hint}, 'tracked', ${candidate.first_seen_at}, ${candidate.last_seen_at})
    `;
    await sql!`DELETE FROM entity_candidates WHERE name_norm = 'boston dynamics'`;

    // The story recurs in a follow-up article — this time both endpoints resolve.
    mockFetchResolved(hyundaiResponse({ prominence: "known" }));
    await persistArticles(sql!, [makeItem({ title: "Hyundai finalizes Boston Dynamics deal", sourceName: "Source B" })]);
    const stats = await processNewArticles(sql!);

    expect(stats.relations.written).toBe(1);
    const [hyundai] = await sql!`SELECT id FROM entities WHERE canonical_name = 'Hyundai'`;
    const [boston] = await sql!`SELECT id FROM entities WHERE canonical_name = 'Boston Dynamics'`;
    const relations = await sql!`SELECT source_id, target_id, relation, article_count, evidence_article_id FROM entity_relations`;
    expect(relations).toEqual([{
      source_id: hyundai.id, target_id: boston.id, relation: "acquisition",
      article_count: 1, evidence_article_id: expect.any(String),
    }]);
  });

  it("Hyundai scenario: re-run idempotency — a second run with no new articles doesn't double the relation's article_count", async () => {
    mockFetchResolved(hyundaiResponse({ prominence: "famous" }));
    await persistArticles(sql!, [makeItem({ title: HYUNDAI_TITLE, sourceName: "Source A" })]);

    const first = await processNewArticles(sql!);
    expect(first.relations.written).toBe(1);

    const second = await processNewArticles(sql!);
    expect(second).toMatchObject({ articlesProcessed: 0, relations: { written: 0 } });

    const relations = await sql!`SELECT article_count FROM entity_relations`;
    expect(relations).toEqual([{ article_count: 1 }]);
  });

  it("migration 005 applies cleanly: the expanded type enum and entity_relations are usable on a fresh schema", async () => {
    const [{ id: sourceId }] = (await sql!`
      INSERT INTO entities (canonical_name, type, status, first_seen_at, last_seen_at)
      VALUES ('Test Co', 'company', 'tracked', now(), now()) RETURNING id
    `) as [{ id: string }];
    const [{ id: targetId }] = (await sql!`
      INSERT INTO entities (canonical_name, type, status, first_seen_at, last_seen_at)
      VALUES ('Test Ministry', 'government_body', 'tracked', now(), now()) RETURNING id
    `) as [{ id: string }];

    await sql!`
      INSERT INTO entity_relations (source_id, target_id, relation, first_seen_at, last_seen_at, article_count)
      VALUES (${sourceId}, ${targetId}, 'regulation', now(), now(), 1)
    `;
    const rows = await sql!`SELECT relation FROM entity_relations WHERE source_id = ${sourceId}`;
    expect(rows).toEqual([{ relation: "regulation" }]);
  });
});
