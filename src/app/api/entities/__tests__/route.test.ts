import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Sql, SqlRow } from "@/lib/server/db";

let currentSql: Sql;

vi.mock("@/lib/server/db", () => ({
  getSql: () => currentSql,
}));

function makeMockSql(rows: SqlRow[]) {
  const calls: string[] = [];
  const sql = (async (strings: TemplateStringsArray) => {
    calls.push(strings.join(" ? "));
    return rows;
  }) as Sql;
  return { sql, calls };
}

function getRequest(name: string | null): NextRequest {
  const url = name === null ? "http://localhost/api/entities" : `http://localhost/api/entities?name=${encodeURIComponent(name)}`;
  return new NextRequest(url);
}

function listRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/entities${query}`);
}

function statsRow(overrides: Partial<SqlRow> = {}): SqlRow {
  return {
    total_tracked: "5", famous_count: "2", not_famous_count: "1", unknown_count: "2",
    parked_count: "1", never_checked_count: "1", locked_count: "1",
    oldest_checked_at: "2026-07-01T00:00:00Z", newest_checked_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function entityRow(id: number, canonicalName: string): SqlRow {
  return {
    id, canonical_name: canonicalName, type: "person", status: "tracked", aliases: [],
    fame: "unknown", fame_locked: false, wiki_title: null, wiki_sitelinks: null,
    wiki_pageviews_monthly: null, fame_checked_at: null, first_seen_at: "2026-07-01T00:00:00Z",
  };
}

const { GET } = await import("../route");

describe("GET /api/entities", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });

  it("returns 503 when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await GET(getRequest("Russia"));
    expect(res.status).toBe(503);
  });

  it("400s when name is blank (present but empty)", async () => {
    const res = await GET(getRequest("   "));
    expect(res.status).toBe(400);
  });

  it("404s when no entity matches", async () => {
    currentSql = makeMockSql([]).sql;
    const res = await GET(getRequest("Nonexistent Place"));
    expect(res.status).toBe(404);
  });

  it("resolves by normalized canonical name (case + diacritics)", async () => {
    const mock = makeMockSql([
      { id: "3", canonical_name: "Müller", type: "person", status: "tracked", aliases: [] },
    ]);
    currentSql = mock.sql;
    const res = await GET(getRequest("muller"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ id: 3, canonicalName: "Müller", type: "person", status: "tracked" });
  });

  it("resolves by normalized alias", async () => {
    const mock = makeMockSql([
      { id: "1", canonical_name: "United States", type: "country", status: "tracked", aliases: ["US", "USA"] },
    ]);
    currentSql = mock.sql;
    const res = await GET(getRequest("usa"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
  });

  it("orders by id ascending for deterministic resolution when aliases collide across rows", async () => {
    const mock = makeMockSql([]);
    currentSql = mock.sql;
    await GET(getRequest("Russia"));
    expect(mock.calls[0]).toContain("ORDER BY id ASC");
  });
});

describe("GET /api/entities — list mode (?name= absent)", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });

  it("returns {entities, total} when name is entirely absent from the query string", async () => {
    currentSql = makeMockSql([entityRow(1, "Russia"), entityRow(2, "Ukraine")]).sql;
    const res = await GET(listRequest(""));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.entities).toHaveLength(2);
    expect(body.entities[0]).toMatchObject({ id: 1, canonicalName: "Russia" });
  });

  it("returns the zero-results shape", async () => {
    currentSql = makeMockSql([]).sql;
    const res = await GET(listRequest(""));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ entities: [], total: 0 });
  });

  it("filters by q", async () => {
    currentSql = makeMockSql([entityRow(1, "Russia"), entityRow(2, "Ukraine")]).sql;
    const res = await GET(listRequest("?q=ukr"));
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.entities[0].canonicalName).toBe("Ukraine");
  });

  it("400s on a malformed limit rather than coercing it", async () => {
    currentSql = makeMockSql([]).sql;
    const res = await GET(listRequest("?limit=abc"));
    expect(res.status).toBe(400);
  });

  it("400s on an invalid status filter", async () => {
    currentSql = makeMockSql([]).sql;
    const res = await GET(listRequest("?status=bogus"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/entities?view=stats", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });

  it("returns 503 when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await GET(listRequest("?view=stats"));
    expect(res.status).toBe(503);
  });

  it("returns loadEntityStats's shape", async () => {
    currentSql = makeMockSql([statsRow()]).sql;
    const res = await GET(listRequest("?view=stats"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      totalTracked: 5, famousCount: 2, notFamousCount: 1, unknownCount: 2,
      parkedCount: 1, neverCheckedCount: 1, lockedCount: 1,
      oldestFameCheckedAt: "2026-07-01T00:00:00.000Z",
      newestFameCheckedAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("returns null timestamps and zero counts for an empty table", async () => {
    currentSql = makeMockSql([
      statsRow({
        total_tracked: "0", famous_count: "0", not_famous_count: "0", unknown_count: "0",
        parked_count: "0", never_checked_count: "0", locked_count: "0",
        oldest_checked_at: null, newest_checked_at: null,
      }),
    ]).sql;
    const res = await GET(listRequest("?view=stats"));
    const body = await res.json();
    expect(body.totalTracked).toBe(0);
    expect(body.oldestFameCheckedAt).toBeNull();
    expect(body.newestFameCheckedAt).toBeNull();
  });

  it("takes priority over list mode when both view=stats and other params are present", async () => {
    currentSql = makeMockSql([statsRow()]).sql;
    const res = await GET(listRequest("?view=stats&q=ignored&status=bogus"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalTracked).toBe(5);
  });
});
