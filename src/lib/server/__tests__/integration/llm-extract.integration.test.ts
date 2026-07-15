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
});
