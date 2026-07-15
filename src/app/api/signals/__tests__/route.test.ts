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

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/signals", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const { GET, POST } = await import("../route");

describe("GET /api/signals", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("returns 503 when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await GET(getRequest("http://localhost/api/signals"));
    expect(res.status).toBe(503);
  });

  it("defaults to new,seen,promoted when no state param is given", async () => {
    const { sql, calls } = makeMockSql(() => []);
    currentSql = sql;
    await GET(getRequest("http://localhost/api/signals"));
    expect(calls[0].values).toContainEqual(["new", "seen", "promoted"]);
  });

  it("parses a csv state param", async () => {
    const { sql, calls } = makeMockSql(() => []);
    currentSql = sql;
    await GET(getRequest("http://localhost/api/signals?state=dismissed,promoted"));
    expect(calls[0].values).toContainEqual(["dismissed", "promoted"]);
  });

  it("400s on an invalid state value", async () => {
    currentSql = makeMockSql(() => []).sql;
    const res = await GET(getRequest("http://localhost/api/signals?state=bogus"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/signals", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("400s on an unknown action", async () => {
    const res = await POST(postRequest({ id: 1, action: "delete" }));
    expect(res.status).toBe(400);
  });

  it("400s on a non-integer id", async () => {
    const res = await POST(postRequest({ id: "1", action: "seen" }));
    expect(res.status).toBe(400);
  });

  it("400s on invalid JSON", async () => {
    currentSql = makeMockSql(() => []).sql;
    const res = await POST(new NextRequest("http://localhost/api/signals", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("404s when the signal doesn't exist", async () => {
    const { sql } = makeMockSql(() => []);
    currentSql = sql;
    const res = await POST(postRequest({ id: 999, action: "seen" }));
    expect(res.status).toBe(404);
  });

  it("409s on an illegal transition", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("SELECT id FROM signals")) return [{ id: 1 }];
      if (call.query.includes("SELECT state")) return [{ state: "dismissed" }];
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ id: 1, action: "seen" }));
    expect(res.status).toBe(409);
  });

  it("200s and transitions a legal action", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT id FROM signals")) return [{ id: 1 }];
      if (call.query.includes("UPDATE signals")) return [{ id: 1 }]; // guarded UPDATE matched a row
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ id: 1, action: "seen" }));
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.query.includes("UPDATE signals"))).toBe(true);
  });
});
