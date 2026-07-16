import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Sql, SqlRow } from "@/lib/server/db";

interface RecordedCall {
  query: string;
  values: unknown[];
}

let currentSql: Sql;

vi.mock("@/lib/server/db", () => ({
  getSql: () => currentSql,
}));

function makeMockSql(handler: (call: RecordedCall) => SqlRow[]) {
  const calls: RecordedCall[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call: RecordedCall = { query: strings.join(" ? "), values };
    calls.push(call);
    return handler(call);
  }) as Sql;
  return { sql, calls };
}

const req = new NextRequest("http://localhost/api/entities/1");

const { GET } = await import("../route");

describe("GET /api/entities/[id]", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });

  it("returns 503 when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await GET(req, { params: { id: "1" } });
    expect(res.status).toBe(503);
  });

  it("400s on a non-numeric id", async () => {
    const res = await GET(req, { params: { id: "not-a-number" } });
    expect(res.status).toBe(400);
  });

  it("400s on a non-positive id", async () => {
    const res = await GET(req, { params: { id: "0" } });
    expect(res.status).toBe(400);
  });

  it("404s when the entity doesn't exist", async () => {
    const { sql } = makeMockSql(() => []);
    currentSql = sql;
    const res = await GET(req, { params: { id: "1" } });
    expect(res.status).toBe(404);
  });

  it("scopes the hourly series to a 7-day window and orders ascending", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) {
        return [{ id: "1", canonical_name: "Russia", type: "country", status: "tracked", first_seen_at: "2026-07-01T00:00:00Z", last_seen_at: "2026-07-15T00:00:00Z" }];
      }
      return [];
    });
    currentSql = sql;
    await GET(req, { params: { id: "1" } });

    const seriesCall = calls.find((c) => c.query.includes("FROM entity_mentions_hourly"));
    expect(seriesCall!.query).toContain("make_interval(days =>");
    expect(seriesCall!.values).toContain(7);
    expect(seriesCall!.query).toContain("ORDER BY bucket ASC");
  });

  it("scopes recent articles to cluster heads, newest first, limited to 20", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) {
        return [{ id: "1", canonical_name: "Russia", type: "country", status: "tracked", first_seen_at: "2026-07-01T00:00:00Z", last_seen_at: null }];
      }
      return [];
    });
    currentSql = sql;
    await GET(req, { params: { id: "1" } });

    const articlesCall = calls.find((c) => c.query.includes("FROM article_entities"));
    expect(articlesCall!.query).toContain("a.dup_group_id IS NULL");
    expect(articlesCall!.query).toContain("ORDER BY COALESCE(a.published_at, a.first_seen_at) DESC");
    expect(articlesCall!.values).toContain(20);
  });

  it("resolves the 'other' entity id/name for edges regardless of a/b position", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) {
        return [{ id: "5", canonical_name: "Russia", type: "country", status: "tracked", first_seen_at: "2026-07-01T00:00:00Z", last_seen_at: null }];
      }
      if (call.query.includes("FROM entity_edges")) {
        return [{ other_id: "9", other_name: "Ukraine", article_count: "12" }];
      }
      return [];
    });
    currentSql = sql;
    const res = await GET(req, { params: { id: "5" } });
    const body = await res.json();

    expect(body.edges).toEqual([{ id: 9, name: "Ukraine", articleCount: 12 }]);
    const edgesCall = calls.find((c) => c.query.includes("FROM entity_edges"));
    expect(edgesCall!.query).toContain("ORDER BY ee.article_count DESC");
    expect(edgesCall!.values).toContain(10);
  });

  it("returns the full shape: entity + series + articles + edges + relations", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) {
        return [{ id: "1", canonical_name: "Russia", type: "country", status: "tracked", first_seen_at: "2026-07-01T00:00:00Z", last_seen_at: "2026-07-15T00:00:00Z" }];
      }
      return [];
    });
    currentSql = sql;
    const res = await GET(req, { params: { id: "1" } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entity).toEqual({
      id: 1,
      canonicalName: "Russia",
      type: "country",
      status: "tracked",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastSeenAt: "2026-07-15T00:00:00.000Z",
    });
    expect(body.series).toEqual([]);
    expect(body.articles).toEqual([]);
    expect(body.edges).toEqual([]);
    expect(body.relations).toEqual({ incoming: [], outgoing: [] });
  });

  it("loads outgoing (source=id) and incoming (target=id) relations as one query each, correctly shaped", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) {
        return [{ id: "5", canonical_name: "Hyundai", type: "company", status: "tracked", first_seen_at: "2026-07-01T00:00:00Z", last_seen_at: null }];
      }
      if (call.query.includes("er.source_id = ")) {
        return [{ relation: "acquisition", other_id: "9", other_name: "Boston Dynamics", article_count: "3", last_seen_at: "2026-07-10T00:00:00Z" }];
      }
      if (call.query.includes("er.target_id = ")) {
        return [{ relation: "investment", other_id: "12", other_name: "SoftBank", article_count: "2", last_seen_at: "2026-07-11T00:00:00Z" }];
      }
      return [];
    });
    currentSql = sql;
    const res = await GET(req, { params: { id: "5" } });
    const body = await res.json();

    expect(body.relations.outgoing).toEqual([
      { relation: "acquisition", id: 9, name: "Boston Dynamics", articleCount: 3, lastSeenAt: "2026-07-10T00:00:00.000Z" },
    ]);
    expect(body.relations.incoming).toEqual([
      { relation: "investment", id: 12, name: "SoftBank", articleCount: 2, lastSeenAt: "2026-07-11T00:00:00.000Z" },
    ]);

    const relationsCalls = calls.filter((c) => c.query.includes("FROM entity_relations"));
    expect(relationsCalls).toHaveLength(2);
  });
});
