import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Sql, SqlRow } from "@/lib/server/db";

let currentSql: Sql;

vi.mock("@/lib/server/db", () => ({
  getSql: () => currentSql,
}));

function makeMockSql(rows: SqlRow[]): Sql {
  return (async () => rows) as Sql;
}

const { GET } = await import("../route");

describe("GET /api/brief", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("returns 503 when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await GET();
    expect(res.status).toBe(503);
  });

  it("returns generatedAt, signals, newEntities, topStories with the cache header", async () => {
    currentSql = makeMockSql([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("s-maxage=300, stale-while-revalidate=600");
    const body = await res.json();
    expect(body).toMatchObject({ signals: [], newEntities: [], topStories: [] });
    expect(typeof body.generatedAt).toBe("string");
  });
});
