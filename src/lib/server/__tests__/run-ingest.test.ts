import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Sql } from "../db";

// Every stage dependency is mocked wholesale — this file exists specifically
// to cover the fame-sweep stage's wiring (added after detect-signals), which
// deliberately deviates from every other stage's runStage abort-on-failure
// convention. It is not a general run-ingest.ts behavior suite.
vi.mock("@/lib/feed-fetcher", () => ({ fetchAllFeeds: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ getSql: vi.fn() }));
vi.mock("@/lib/server/ingest-writer", () => ({ persistArticles: vi.fn(), sweepRetention: vi.fn() }));
vi.mock("@/lib/server/entity-ingest", () => ({ processNewArticles: vi.fn() }));
vi.mock("@/lib/server/settings", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/server/detectors", () => ({ runDetectors: vi.fn(), computeWarmupState: vi.fn() }));
vi.mock("@/lib/server/signal-store", () => ({ persistSignals: vi.fn() }));
vi.mock("@/lib/server/fame-sweep", () => ({ runFameSweep: vi.fn() }));

const { fetchAllFeeds } = await import("@/lib/feed-fetcher");
const { getSql } = await import("@/lib/server/db");
const { persistArticles, sweepRetention } = await import("@/lib/server/ingest-writer");
const { processNewArticles } = await import("@/lib/server/entity-ingest");
const { getSettings } = await import("@/lib/server/settings");
const { runDetectors, computeWarmupState } = await import("@/lib/server/detectors");
const { persistSignals } = await import("@/lib/server/signal-store");
const { runFameSweep } = await import("@/lib/server/fame-sweep");
const { runIngest } = await import("../run-ingest");

const FAKE_SETTINGS = { surprise_k: 3, dismiss_cooldown_hours: 72, brief_max_blocks: 10, warmup_days: 7, llm_monthly_budget_usd: 5 };

beforeEach(() => {
  vi.mocked(fetchAllFeeds).mockResolvedValue({ items: [], feedsAttempted: 10, feedsSucceeded: 10, relayConfigured: false, feedDiagnostics: [] });
  vi.mocked(getSql).mockReturnValue((async () => []) as unknown as Sql);
  vi.mocked(persistArticles).mockResolvedValue({ inserted: 0, duplicates: 0 });
  vi.mocked(sweepRetention).mockResolvedValue({ expired: 0 });
  vi.mocked(processNewArticles).mockResolvedValue({
    articlesProcessed: 0, mentionsWritten: 0, newEntities: 0, candidatesTouched: 0,
    llm: { used: false, articles: 0, monthCostUsd: 0 }, entities: { autoAccepted: 0 }, relations: { written: 0 },
  });
  vi.mocked(getSettings).mockResolvedValue(FAKE_SETTINGS);
  vi.mocked(runDetectors).mockResolvedValue([]);
  vi.mocked(computeWarmupState).mockReturnValue({ active: false, daysRemaining: 0 });
  vi.mocked(persistSignals).mockResolvedValue({ created: 0, refreshed: 0, suppressed: 0, purged: 0, expired: 0 });
  vi.mocked(runFameSweep).mockResolvedValue({ checked: 0, succeeded: 0, failed: 0, failureReasons: {} });
});

describe("runIngest: fame sweep stage", () => {
  it("includes fameSweep stats in the response body on success, running after the signals stage", async () => {
    const order: string[] = [];
    vi.mocked(persistSignals).mockImplementation(async () => {
      order.push("signals");
      return { created: 0, refreshed: 0, suppressed: 0, purged: 0, expired: 0 };
    });
    vi.mocked(runFameSweep).mockImplementation(async () => {
      order.push("fame-sweep");
      return { checked: 5, succeeded: 4, failed: 1, failureReasons: { search_http_403: 1 } };
    });

    const result = await runIngest();

    expect(result.status).toBe(200);
    // The failureReasons tally must reach the ingest response body — this is
    // the diagnostic the 24h 100%-failure incident lacked (see DEVLOG): with
    // Vercel's runtime logs gone after an hour, this JSON body (surfaced in
    // the GitHub Actions job log) is the only durable record of *why* a
    // sweep failed, not just that it did.
    expect(result.body.fameSweep).toEqual({ checked: 5, succeeded: 4, failed: 1, failureReasons: { search_http_403: 1 } });
    expect(order).toEqual(["signals", "fame-sweep"]);
  });

  it("an aborted (rate-limited) sweep's marker also reaches the ingest response body", async () => {
    vi.mocked(runFameSweep).mockResolvedValue({
      checked: 3,
      succeeded: 0,
      failed: 3,
      failureReasons: { search_http_429: 3 },
      abortedReason: "rate_limited",
    });

    const result = await runIngest();

    expect(result.status).toBe(200);
    expect(result.body.fameSweep).toMatchObject({ abortedReason: "rate_limited" });
  });

  it("a fame-sweep failure logs loudly and does not abort the run — other stages' counts still return with status 200", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runFameSweep).mockRejectedValue(new Error("wikidata connection reset"));

    const result = await runIngest();

    expect(result.status).toBe(200);
    expect(result.body.fameSweep).toBeNull();
    expect(result.body.signals).toBeDefined();
    expect(result.body.warmup).toBeDefined();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("fame-sweep"), expect.any(Error));
    consoleError.mockRestore();
  });

  it("a fame-sweep failure does not prevent compute-warmup from still running afterward", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runFameSweep).mockRejectedValue(new Error("down"));
    const result = await runIngest();
    expect(result.body.warmup).toEqual({ active: false, daysRemaining: 0 });
  });
});

describe("runIngest: signals stats (purged/expired observability)", () => {
  it("passes sweepRetention's expired count through to persistSignals, and the result lands in body.signals", async () => {
    vi.mocked(sweepRetention).mockResolvedValue({ expired: 4 });
    vi.mocked(persistSignals).mockResolvedValue({ created: 0, refreshed: 0, suppressed: 0, purged: 2, expired: 4 });

    const result = await runIngest();

    expect(persistSignals).toHaveBeenCalledWith(expect.anything(), [], FAKE_SETTINGS, 4);
    expect(result.body.signals).toEqual({ created: 0, refreshed: 0, suppressed: 0, purged: 2, expired: 4 });
  });

  it("defaults the expired count to 0 when sweepRetention resolves to undefined (a bare-mock consumer)", async () => {
    vi.mocked(sweepRetention).mockResolvedValue(undefined as never);

    await runIngest();

    expect(persistSignals).toHaveBeenCalledWith(expect.anything(), [], FAKE_SETTINGS, 0);
  });
});

describe("runIngest: unrelated stages still abort the run on failure (pre-existing convention, unchanged)", () => {
  it("a persist-articles failure still 500s the whole run, unlike a fame-sweep failure", async () => {
    vi.mocked(persistArticles).mockRejectedValue(new Error("db down"));
    const result = await runIngest();
    expect(result.status).toBe(500);
    expect(result.body.stage).toBe("persist-articles");
  });
});
