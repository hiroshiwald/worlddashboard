import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getLastIngestAt = vi.fn();
const tryAcquireLock = vi.fn();
const runIngest = vi.fn();
let currentSql: unknown;

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
    const res = await POST();
    expect(res.status).toBe(503);
    expect(getLastIngestAt).not.toHaveBeenCalled();
  });

  it("returns triggered:false reason:fresh when the newest article is under 2h old, without touching the lock", async () => {
    getLastIngestAt.mockResolvedValue(new Date());
    const res = await POST();
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
    const res = await POST();
    const body = await res.json();
    expect(body).toEqual({ triggered: false, reason: "locked" });
  });

  it("returns triggered:false reason:locked when stale but another tick holds the lock", async () => {
    getLastIngestAt.mockResolvedValue(new Date(Date.now() - 3 * 60 * 60 * 1000));
    tryAcquireLock.mockResolvedValue(false);
    const res = await POST();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ triggered: false, reason: "locked" });
    expect(runIngest).not.toHaveBeenCalled();
  });

  it("runs ingest and returns triggered:true with the ingest stats when it wins the lock", async () => {
    getLastIngestAt.mockResolvedValue(new Date(Date.now() - 3 * 60 * 60 * 1000));
    tryAcquireLock.mockResolvedValue(true);
    runIngest.mockResolvedValue({ status: 200, body: { inserted: 5, tookMs: 42 } });

    const res = await POST();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ triggered: true, inserted: 5, tookMs: 42 });
  });

  it("propagates an ingest failure's status while still marking triggered:true", async () => {
    getLastIngestAt.mockResolvedValue(null);
    tryAcquireLock.mockResolvedValue(true);
    runIngest.mockResolvedValue({ status: 500, body: { error: "Ingest failed", stage: "fetch-feeds" } });

    const res = await POST();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ triggered: true, error: "Ingest failed", stage: "fetch-feeds" });
  });

  it("GET behaves identically to POST (winner path)", async () => {
    getLastIngestAt.mockResolvedValue(new Date(Date.now() - 3 * 60 * 60 * 1000));
    tryAcquireLock.mockResolvedValue(true);
    runIngest.mockResolvedValue({ status: 200, body: { inserted: 1 } });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ triggered: true, inserted: 1 });
  });
});
