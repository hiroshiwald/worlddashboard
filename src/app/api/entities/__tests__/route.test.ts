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

  it("400s when name is missing", async () => {
    const res = await GET(getRequest(null));
    expect(res.status).toBe(400);
  });

  it("400s when name is blank", async () => {
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
