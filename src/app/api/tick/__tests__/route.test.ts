import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const getLastIngestAt = vi.fn();
const tryAcquireLock = vi.fn();
const runIngest = vi.fn();
let currentSql: unknown;

function tickRequest(query?: string): NextRequest {
  const url = query ? `http://localhost/api/tick?${query}` : "http://localhost/api/tick";
  return new NextRequest(url, { method: "POST" });
}

vi.mock("@/lib/server/db", () => ({
  getSql: () => currentSql,
}));
vi.mock("@/lib/server/tick", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/tick")>();
  return {
    ...actual,
    getLastIngestAt: (...args: unknown[]) => getLastIngestAt(...args),
    tryAcquireLock: (...args: unknown[]) => tryAcquireLock(...args),
  };
});
vi.mock("@/lib/server/run-ingest", () => ({
  runIngest: (...args: unknown[]) => runIngest(...args),
}));

const { POST, GET } = await import("../route");

describe("POST/GET /api/tick", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
    currentSql = vi.fn(async () => []);
    getLastIngestAt.mockReset();
    tryAcquireLock.mockReset();
    runIngest.mockReset();
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("returns 503 when DATABASE_URL is unset, without querying anything", async () => {
    delete process.env.DATABASE_URL;
    const res = await POST(tickRequest());
    expect(res.status).toBe(503);
    expect(getLastIngestAt).not.toHaveBeenCalled();
  });

  it("returns triggered:false reason:fresh when the newest article is under 2h old, without touching the lock", async () => {
    getLastIngestAt.mockResolvedValue(new Date());
    const res = await POST(tickRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ triggered: false, reason: "fresh" });
    expect(tryAcquireLock).not.toHaveBeenCalled();
    expect(runIngest).not.toHaveBeenCalled();
  });

  it("returns triggered:false reason:fresh when no articles exist yet is treated as stale, not fresh", async () => {
    // getLastIngestAt returning null means "no data" -> isRecent(null) is
    // false -> NOT fresh -> falls through to the lock stage instead.
    getLastIngestAt.mockResolvedValue(null);
    tryAcquireLock.mockResolvedValue(false);
    const res = await POST(tickRequest());
    const body = await res.json();
    expect(body).toEqual({ triggered: false, reason: "locked" });
  });

  it("returns triggered:false reason:locked when stale but another tick holds the lock", async () => {
    getLastIngestAt.mockResolvedValue(new Date(Date.now() - 3 * 60 * 60 * 1000));
    tryAcquireLock.mockResolvedValue(false);
    const res = await POST(tickRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ triggered: false, reason: "locked" });
    expect(runIngest).not.toHaveBeenCalled();
  });

  it("runs ingest and returns triggered:true with the ingest stats when it wins the lock", async () => {
    getLastIngestAt.mockResolvedValue(new Date(Date.now() - 3 * 60 * 60 * 1000));
    tryAcquireLock.mockResolvedValue(true);
    runIngest.mockResolvedValue({ status: 200, body: { inserted: 5, tookMs: 42 } });

    const res = await POST(tickRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ triggered: true, inserted: 5, tookMs: 42 });
  });

  it("propagates an ingest failure's status while still marking triggered:true", async () => {
    getLastIngestAt.mockResolvedValue(null);
    tryAcquireLock.mockResolvedValue(true);
    runIngest.mockResolvedValue({ status: 500, body: { error: "Ingest failed", stage: "fetch-feeds" } });

    const res = await POST(tickRequest());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ triggered: true, error: "Ingest failed", stage: "fetch-feeds" });
  });

  it("GET behaves identically to POST (winner path)", async () => {
    getLastIngestAt.mockResolvedValue(new Date(Date.now() - 3 * 60 * 60 * 1000));
    tryAcquireLock.mockResolvedValue(true);
    runIngest.mockResolvedValue({ status: 200, body: { inserted: 1 } });

    const res = await GET(tickRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ triggered: true, inserted: 1 });
  });
});

describe("manual mode (?manual=1)", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
    currentSql = vi.fn(async () => []);
    getLastIngestAt.mockReset();
    tryAcquireLock.mockReset();
    runIngest.mockReset();
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("?manual=1 treats a 15-minute-old ingest as stale (10-min threshold) and attempts the lock", async () => {
    getLastIngestAt.mockResolvedValue(new Date(Date.now() - 15 * 60 * 1000));
    tryAcquireLock.mockResolvedValue(true);
    runIngest.mockResolvedValue({ status: 200, body: { inserted: 2 } });

    const res = await POST(tickRequest("manual=1"));
    const body = await res.json();
    expect(body).toEqual({ triggered: true, inserted: 2 });
    expect(tryAcquireLock).toHaveBeenCalledTimes(1);
  });

  it("the same 15-minute-old ingest is fresh under the passive (no query) 2h threshold", async () => {
    getLastIngestAt.mockResolvedValue(new Date(Date.now() - 15 * 60 * 1000));

    const res = await POST(tickRequest());
    const body = await res.json();
    expect(body).toEqual({ triggered: false, reason: "fresh" });
    expect(tryAcquireLock).not.toHaveBeenCalled();
  });

  it("?manual=1 with a 2-minute-old ingest is still fresh (under the 10-min manual threshold)", async () => {
    getLastIngestAt.mockResolvedValue(new Date(Date.now() - 2 * 60 * 1000));

    const res = await POST(tickRequest("manual=1"));
    const body = await res.json();
    expect(body).toEqual({ triggered: false, reason: "fresh" });
    expect(tryAcquireLock).not.toHaveBeenCalled();
  });

  it.each(["true", "0", "2", "yes", ""])("ignores manual=%s and falls back to the passive threshold", async (value) => {
    getLastIngestAt.mockResolvedValue(new Date(Date.now() - 15 * 60 * 1000));

    const res = await POST(tickRequest(`manual=${value}`));
    const body = await res.json();
    expect(body).toEqual({ triggered: false, reason: "fresh" });
    expect(tryAcquireLock).not.toHaveBeenCalled();
  });

  it("ignores unrelated query params alongside manual=1", async () => {
    getLastIngestAt.mockResolvedValue(new Date(Date.now() - 15 * 60 * 1000));
    tryAcquireLock.mockResolvedValue(true);
    runIngest.mockResolvedValue({ status: 200, body: { inserted: 0 } });

    const res = await POST(tickRequest("manual=1&foo=bar&limit=999"));
    const body = await res.json();
    expect(body).toEqual({ triggered: true, inserted: 0 });
  });

  it("GET honors ?manual=1 the same as POST", async () => {
    getLastIngestAt.mockResolvedValue(new Date(Date.now() - 15 * 60 * 1000));
    tryAcquireLock.mockResolvedValue(true);
    runIngest.mockResolvedValue({ status: 200, body: { inserted: 3 } });

    const res = await GET(tickRequest("manual=1"));
    const body = await res.json();
    expect(body).toEqual({ triggered: true, inserted: 3 });
  });
});
