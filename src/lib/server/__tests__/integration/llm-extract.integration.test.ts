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

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function textResponse(status: number, text: string) {
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

function resultLine(customId: string, result: unknown): string {
  return JSON.stringify({ custom_id: customId, result });
}

function succeededResult(articleResults: unknown[], usage = { input_tokens: 1000, output_tokens: 500 }) {
  return { type: "succeeded", message: { content: [{ type: "text", text: JSON.stringify(articleResults) }], usage } };
}

// Every scenario is two ingest ticks: tick 1 submits a batch (POST .../batches),
// tick 2 polls it (GET .../batches/{id}) and fetches its results_url — queued
// in that call order via mockResolvedValueOnce.
function queueFetch(...responses: unknown[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const originalKey = process.env.ANTHROPIC_API_KEY;

describe.skipIf(!TEST_DATABASE_URL)("LLM Batches API integration (real Postgres, mocked fetch)", () => {
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

  it("tick 1 submits a batch and processes nothing; tick 2 polls, applies results, and marks the article processed", async () => {
    queueFetch(
      jsonResponse(200, { id: "batch_1", processing_status: "in_progress" }),
      jsonResponse(200, { id: "batch_1", processing_status: "ended", results_url: "https://api.anthropic.com/results/batch_1" }),
      textResponse(200, resultLine("0", succeededResult([{ index: 0, entities: [] }]))),
    );
    await persistArticles(sql!, [makeItem({ title: "First run headline about a topic", sourceName: "Source A" })]);

    const first = await processNewArticles(sql!);
    expect(first.articlesProcessed).toBe(0);
    expect(first.llm.batch).toEqual({ submittedArticles: 1, retrievedArticles: 0, pendingAgeMinutes: null });

    const [pendingRow] = await sql!`SELECT batch_id, article_ids FROM llm_batches`;
    expect(pendingRow.batch_id).toBe("batch_1");

    const second = await processNewArticles(sql!);
    expect(second.articlesProcessed).toBe(1);
    expect(second.llm.batch.retrievedArticles).toBe(1);

    expect(await sql!`SELECT 1 FROM llm_batches`).toHaveLength(0);
    const [article] = await sql!`SELECT entities_processed_at FROM articles WHERE source_name = 'Source A'`;
    expect(article.entities_processed_at).not.toBeNull();
  });

  it("upserts llm_usage's batch columns cumulatively across two resolved batches", async () => {
    queueFetch(
      jsonResponse(200, { id: "batch_1", processing_status: "in_progress" }),
      jsonResponse(200, { id: "batch_1", processing_status: "ended", results_url: "https://x/results-1" }),
      textResponse(200, resultLine("0", succeededResult([{ index: 0, entities: [] }], { input_tokens: 1000, output_tokens: 500 }))),
    );
    await persistArticles(sql!, [makeItem({ title: "First run headline about a topic", sourceName: "Source A" })]);
    await processNewArticles(sql!); // submit
    await processNewArticles(sql!); // apply

    let rows = await sql!`SELECT batch_input_tokens, batch_output_tokens, calls FROM llm_usage`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].batch_input_tokens)).toBe(1000);
    expect(Number(rows[0].batch_output_tokens)).toBe(500);
    expect(Number(rows[0].calls)).toBe(1);

    queueFetch(
      jsonResponse(200, { id: "batch_2", processing_status: "in_progress" }),
      jsonResponse(200, { id: "batch_2", processing_status: "ended", results_url: "https://x/results-2" }),
      textResponse(200, resultLine("0", succeededResult([{ index: 0, entities: [] }], { input_tokens: 2000, output_tokens: 800 }))),
    );
    await persistArticles(sql!, [makeItem({ title: "Second run headline about a topic", sourceName: "Source B" })]);
    await processNewArticles(sql!); // submit
    await processNewArticles(sql!); // apply

    rows = await sql!`SELECT batch_input_tokens, batch_output_tokens, calls FROM llm_usage`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].batch_input_tokens)).toBe(3000);
    expect(Number(rows[0].batch_output_tokens)).toBe(1300);
    expect(Number(rows[0].calls)).toBe(2);
  });

  it("carries contexts and co_entities through the full pipeline into entity_candidates once results are applied", async () => {
    queueFetch(
      jsonResponse(200, { id: "batch_1", processing_status: "in_progress" }),
      jsonResponse(200, { id: "batch_1", processing_status: "ended", results_url: "https://x/results" }),
      textResponse(200, resultLine("0", succeededResult([{ index: 0, entities: [{ name: "Jonas Kestrel", type: "person", role: "former IRGC commander" }] }]))),
    );
    await persistArticles(sql!, [makeItem({ title: "Jonas Kestrel met officials in Germany today", sourceName: "Source A" })]);
    await processNewArticles(sql!); // submit
    const stats = await processNewArticles(sql!); // apply

    expect(stats.llm.used).toBe(true);
    expect(stats.llm.articles).toBe(1);
    expect(stats.newEntities).toBe(1); // Germany, via the dictionary layer union

    const candidates = await sql!`SELECT name_norm, contexts, co_entities FROM entity_candidates WHERE name_norm = 'jonas kestrel'`;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].contexts).toEqual(["former IRGC commander"]);
    expect(candidates[0].co_entities).toEqual(["Germany"]);
  });

  it("a submit failure processes the article heuristically the same tick and tallies the reason", async () => {
    queueFetch(jsonResponse(529, {}));
    await persistArticles(sql!, [makeItem({ title: "Russia announces new policy", sourceName: "Source A" })]);

    const stats = await processNewArticles(sql!);

    expect(stats.llm.used).toBe(false);
    expect(stats.llm.failureReasons).toEqual({ submit_http_529: 1 });
    expect(stats.articlesProcessed).toBe(1);
    expect(stats.newEntities).toBe(1);

    const [entity] = await sql!`SELECT canonical_name FROM entities WHERE canonical_name = 'Russia'`;
    expect(entity).toBeDefined();
    const [article] = await sql!`SELECT entities_processed_at FROM articles WHERE source_name = 'Source A'`;
    expect(article.entities_processed_at).not.toBeNull();
  });

  it("an errored chunk falls back to heuristic extraction for its articles once results are applied", async () => {
    queueFetch(
      jsonResponse(200, { id: "batch_1", processing_status: "in_progress" }),
      jsonResponse(200, { id: "batch_1", processing_status: "ended", results_url: "https://x/results" }),
      textResponse(200, resultLine("0", { type: "errored" })),
    );
    await persistArticles(sql!, [makeItem({ title: "Russia announces new policy", sourceName: "Source A" })]);
    await processNewArticles(sql!); // submit
    const stats = await processNewArticles(sql!); // apply

    expect(stats.llm.used).toBe(false);
    expect(stats.llm.failureReasons).toEqual({ chunk_errored: 1 });
    expect(stats.articlesProcessed).toBe(1);
    const [entity] = await sql!`SELECT canonical_name FROM entities WHERE canonical_name = 'Russia'`;
    expect(entity).toBeDefined();
  });

  it("an abandoned (6h+) pending batch is heuristic-processed without polling", async () => {
    queueFetch(jsonResponse(200, { id: "batch_1", processing_status: "in_progress" }));
    await persistArticles(sql!, [makeItem({ title: "Russia announces new policy", sourceName: "Source A" })]);
    await processNewArticles(sql!); // submit

    await sql!`UPDATE llm_batches SET submitted_at = now() - make_interval(hours => 7)`;
    const pollMock = vi.fn(() => {
      throw new Error("poll must not be called for an abandoned batch");
    });
    vi.stubGlobal("fetch", pollMock);

    const stats = await processNewArticles(sql!);
    expect(stats.llm.failureReasons).toEqual({ abandoned_timeout: 1 });
    expect(stats.articlesProcessed).toBe(1);
    expect(await sql!`SELECT 1 FROM llm_batches`).toHaveLength(0);
  });

  it("calls the real Batches API endpoint URL (proves the mock, not a live network call, produced the result)", async () => {
    const fetchMock = queueFetch(jsonResponse(200, { id: "batch_1", processing_status: "in_progress" }));
    await persistArticles(sql!, [makeItem({ title: "Some headline about a topic", sourceName: "Source A" })]);
    await processNewArticles(sql!);

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages/batches");
  });

  // ---- Hyundai scenario: v2 ontology, famous auto-accept, typed relations ----

  const HYUNDAI_TITLE = "Hyundai acquires stake in Boston Dynamics";

  function hyundaiResult(boston: { prominence: string }) {
    return succeededResult([
      {
        index: 0,
        entities: [
          { name: "Hyundai", type: "company", prominence: "famous" },
          { name: "Boston Dynamics", type: "company", prominence: boston.prominence },
          { name: "Jane Doe", type: "person", role: "CEO", prominence: "known" },
        ],
        relations: [{ source: "Hyundai", target: "Boston Dynamics", relation: "acquisition" }],
      },
    ]);
  }

  async function submitAndApply(title: string, sourceName: string, result: unknown) {
    queueFetch(
      jsonResponse(200, { id: `batch_${nextId}`, processing_status: "in_progress" }),
      jsonResponse(200, { id: `batch_${nextId}`, processing_status: "ended", results_url: "https://x/results" }),
      textResponse(200, resultLine("0", result)),
    );
    await persistArticles(sql!, [makeItem({ title, sourceName })]);
    await processNewArticles(sql!); // submit
    return processNewArticles(sql!); // apply
  }

  it("Hyundai scenario: the famous company auto-tracks, the obscure company and the person land in candidates with role context, and the relation is dropped while an endpoint stays unresolved", async () => {
    const stats = await submitAndApply(HYUNDAI_TITLE, "Source A", hyundaiResult({ prominence: "obscure" }));

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
    await submitAndApply(HYUNDAI_TITLE, "Source A", hyundaiResult({ prominence: "obscure" }));
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
    const stats = await submitAndApply("Hyundai finalizes Boston Dynamics deal", "Source B", hyundaiResult({ prominence: "known" }));

    expect(stats.relations.written).toBe(1);
    const [hyundai] = await sql!`SELECT id FROM entities WHERE canonical_name = 'Hyundai'`;
    const [boston] = await sql!`SELECT id FROM entities WHERE canonical_name = 'Boston Dynamics'`;
    const relations = await sql!`SELECT source_id, target_id, relation, article_count, evidence_article_id FROM entity_relations`;
    expect(relations).toEqual([{
      source_id: hyundai.id, target_id: boston.id, relation: "acquisition",
      article_count: 1, evidence_article_id: expect.any(String),
    }]);
  });

  it("Hyundai scenario: re-run idempotency — a tick with no new articles doesn't double the relation's article_count", async () => {
    const first = await submitAndApply(HYUNDAI_TITLE, "Source A", hyundaiResult({ prominence: "famous" }));
    expect(first.relations.written).toBe(1);

    const second = await processNewArticles(sql!);
    expect(second).toMatchObject({ articlesProcessed: 0, relations: { written: 0 } });

    const relations = await sql!`SELECT article_count FROM entity_relations`;
    expect(relations).toEqual([{ article_count: 1 }]);
  });

  it("migration 008 applies cleanly: llm_batches and llm_usage's batch columns are usable on a fresh schema", async () => {
    await sql!`INSERT INTO llm_batches (batch_id, submitted_at, article_ids) VALUES ('batch_x', now(), ARRAY[1,2,3]::bigint[])`;
    const [row] = await sql!`SELECT batch_id, article_ids FROM llm_batches`;
    expect(row.batch_id).toBe("batch_x");
    expect((row.article_ids as unknown[]).map(Number)).toEqual([1, 2, 3]);

    await sql!`INSERT INTO llm_usage (month, batch_input_tokens, batch_output_tokens, calls) VALUES ('2026-08', 100, 50, 1)`;
    const [usage] = await sql!`SELECT batch_input_tokens, batch_output_tokens FROM llm_usage WHERE month = '2026-08'`;
    expect(Number(usage.batch_input_tokens)).toBe(100);
    expect(Number(usage.batch_output_tokens)).toBe(50);
  });
});
