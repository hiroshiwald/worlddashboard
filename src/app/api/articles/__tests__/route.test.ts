import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

function getRequest(url: string): NextRequest {
  return new NextRequest(url);
}

const { GET } = await import("../route");

describe("GET /api/articles", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("returns 503 when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await GET(getRequest("http://localhost/api/articles"));
    expect(res.status).toBe(503);
  });

  it("returns 503 when no articles have been ingested yet", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("COUNT(*)")) return [{ count: 0, last_ingest_at: null }];
      return [];
    });
    currentSql = sql;
    const res = await GET(getRequest("http://localhost/api/articles"));
    expect(res.status).toBe(503);
  });

  it("includes updatedAt on each item, sourced from the cluster_updates CTE", async () => {
    const now = new Date();
    const clusterUpdatedAt = new Date(now.getTime() - 60_000);
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("COUNT(*)")) return [{ count: 2, last_ingest_at: now }];
      if (call.query.includes("cluster_updates")) {
        return [
          {
            id: 1,
            title: "Head story",
            link: "https://a.example.com",
            published_at: now,
            first_seen_at: now,
            source_name: "Source A",
            source_category: "world",
            source_tier: "1",
            summary: "",
            image_url: "",
            updated_at: clusterUpdatedAt,
          },
        ];
      }
      return [];
    });
    currentSql = sql;

    const res = await GET(getRequest("http://localhost/api/articles"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items[0].updatedAt).toBe(clusterUpdatedAt.toISOString());
    expect(calls.some((c) => c.query.includes("WITH cluster_updates"))).toBe(true);
  });

  it("sorts by cu.updated_at DESC, not by publish time", async () => {
    const now = new Date();
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("COUNT(*)")) return [{ count: 1, last_ingest_at: now }];
      return [];
    });
    currentSql = sql;

    await GET(getRequest("http://localhost/api/articles"));

    const clusterCall = calls.find((c) => c.query.includes("cluster_updates"));
    expect(clusterCall?.query).toContain("ORDER BY cu.updated_at DESC");
    expect(clusterCall?.query).not.toContain("ORDER BY COALESCE(published_at, first_seen_at) DESC");
  });

  it("routes to the category-filtered branch and binds the category value when ?category= is present", async () => {
    const now = new Date();
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("COUNT(*)")) return [{ count: 1, last_ingest_at: now }];
      return [];
    });
    currentSql = sql;

    await GET(getRequest("http://localhost/api/articles?category=world"));

    const clusterCall = calls.find((c) => c.query.includes("cluster_updates") && c.query.includes("FROM articles h"));
    expect(clusterCall?.query).toContain("h.source_category");
    expect(clusterCall?.values).toContain("world");
  });
});
