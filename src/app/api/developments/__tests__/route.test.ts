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

const OLD_EPOCH = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();

function settingsAndOldEpoch(call: RecordedCall): SqlRow[] | undefined {
  if (call.query.includes("FROM settings")) return [];
  if (call.query.includes("min_first_seen") && call.query.includes("FROM articles")) {
    return [{ min_first_seen: OLD_EPOCH }];
  }
  return undefined;
}

const { GET } = await import("../route");

describe("GET /api/developments", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("returns 503 when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await GET(getRequest("http://localhost/api/developments"));
    expect(res.status).toBe(503);
  });

  it("during warm-up, returns empty developments/null diagnostics without invoking the engine", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM settings")) return [];
      if (call.query.includes("min_first_seen") && call.query.includes("FROM articles")) {
        return [{ min_first_seen: null }];
      }
      return [];
    });
    currentSql = sql;

    const res = await GET(getRequest("http://localhost/api/developments"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.developments).toEqual([]);
    expect(body.diagnostics).toBeNull();
    expect(body.warmup.active).toBe(true);
    expect(typeof body.generatedAt).toBe("string");

    // The engine's own baseline-panel query never fires during warm-up.
    expect(calls.some((c) => c.query.includes("baseline_mentions"))).toBe(false);
  });

  it("post warm-up, returns developments/diagnostics with the cache header", async () => {
    const { sql } = makeMockSql((call) => settingsAndOldEpoch(call) ?? []);
    currentSql = sql;

    const res = await GET(getRequest("http://localhost/api/developments"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("s-maxage=300, stale-while-revalidate=600");
    const body = await res.json();
    expect(body).toMatchObject({ developments: [], warmup: { active: false } });
    expect(body.diagnostics).toEqual({ draftCount: 0, eligibleCount: 0, rejected: {} });
    expect(typeof body.generatedAt).toBe("string");
  });

  it("defaults limit to 50 (passed through as the engine cap)", async () => {
    const { sql } = makeMockSql((call) => settingsAndOldEpoch(call) ?? []);
    currentSql = sql;
    const res = await GET(getRequest("http://localhost/api/developments"));
    expect(res.status).toBe(200);
  });

  it("accepts a valid custom limit", async () => {
    const { sql } = makeMockSql((call) => settingsAndOldEpoch(call) ?? []);
    currentSql = sql;
    const res = await GET(getRequest("http://localhost/api/developments?limit=10"));
    expect(res.status).toBe(200);
  });

  it.each(["0", "-1", "101", "abc", "1.5", ""])("400s on an invalid limit=%s", async (limit) => {
    const { sql } = makeMockSql((call) => settingsAndOldEpoch(call) ?? []);
    currentSql = sql;
    const res = await GET(getRequest(`http://localhost/api/developments?limit=${limit}`));
    expect(res.status).toBe(400);
  });

  it("accepts the boundary values 1 and 100", async () => {
    const { sql: sqlLow } = makeMockSql((call) => settingsAndOldEpoch(call) ?? []);
    currentSql = sqlLow;
    expect((await GET(getRequest("http://localhost/api/developments?limit=1"))).status).toBe(200);

    const { sql: sqlHigh } = makeMockSql((call) => settingsAndOldEpoch(call) ?? []);
    currentSql = sqlHigh;
    expect((await GET(getRequest("http://localhost/api/developments?limit=100"))).status).toBe(200);
  });
});
