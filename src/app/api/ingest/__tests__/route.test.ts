import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const fetchAllFeeds = vi.fn();
const persistArticles = vi.fn();
const sweepRetention = vi.fn();
const processNewArticles = vi.fn();
const getSettings = vi.fn();
const runDetectors = vi.fn();
const persistSignals = vi.fn();

vi.mock("@/lib/feed-fetcher", () => ({
  fetchAllFeeds: (...args: unknown[]) => fetchAllFeeds(...args),
}));
vi.mock("@/lib/server/db", () => ({
  getSql: () => ({}),
}));
vi.mock("@/lib/server/ingest-writer", () => ({
  persistArticles: (...args: unknown[]) => persistArticles(...args),
  sweepRetention: (...args: unknown[]) => sweepRetention(...args),
}));
vi.mock("@/lib/server/entity-ingest", () => ({
  processNewArticles: (...args: unknown[]) => processNewArticles(...args),
}));
vi.mock("@/lib/server/settings", () => ({
  getSettings: (...args: unknown[]) => getSettings(...args),
}));
vi.mock("@/lib/server/detectors", () => ({
  runDetectors: (...args: unknown[]) => runDetectors(...args),
}));
vi.mock("@/lib/server/signal-store", () => ({
  persistSignals: (...args: unknown[]) => persistSignals(...args),
}));

const { POST } = await import("../route");

function authedRequest(): NextRequest {
  return new NextRequest("http://localhost/api/ingest", {
    method: "POST",
    headers: { "x-ingest-key": "test-secret" },
  });
}

describe("POST /api/ingest stage attribution", () => {
  beforeEach(() => {
    process.env.INGEST_SECRET = "test-secret";
    fetchAllFeeds.mockReset();
    persistArticles.mockReset();
    sweepRetention.mockReset();
    processNewArticles.mockReset();
    getSettings.mockReset();
    runDetectors.mockReset();
    persistSignals.mockReset();
  });

  it("returns all counts and 200 when every stage succeeds", async () => {
    fetchAllFeeds.mockResolvedValue({ items: [], feedsAttempted: 5, feedsSucceeded: 5 });
    persistArticles.mockResolvedValue({ inserted: 2, duplicates: 1 });
    sweepRetention.mockResolvedValue(undefined);
    processNewArticles.mockResolvedValue({ articlesProcessed: 1, mentionsWritten: 1, newEntities: 0, candidatesTouched: 0 });
    getSettings.mockResolvedValue({ surprise_k: 3, dismiss_cooldown_hours: 72, brief_max_blocks: 10 });
    runDetectors.mockResolvedValue([]);
    persistSignals.mockResolvedValue({ created: 0, refreshed: 0, suppressed: 0 });

    const res = await POST(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ feedsAttempted: 5, feedsSucceeded: 5, inserted: 2, duplicates: 1 });
    expect(body.entities).toEqual({ articlesProcessed: 1, mentionsWritten: 1, newEntities: 0, candidatesTouched: 0 });
    expect(body.signals).toEqual({ created: 0, refreshed: 0, suppressed: 0 });
  });

  it("attributes a detect-signals failure while still reporting entities and earlier counts", async () => {
    fetchAllFeeds.mockResolvedValue({ items: [], feedsAttempted: 5, feedsSucceeded: 5 });
    persistArticles.mockResolvedValue({ inserted: 2, duplicates: 1 });
    sweepRetention.mockResolvedValue(undefined);
    processNewArticles.mockResolvedValue({ articlesProcessed: 1, mentionsWritten: 1, newEntities: 0, candidatesTouched: 0 });
    getSettings.mockResolvedValue({ surprise_k: 3, dismiss_cooldown_hours: 72, brief_max_blocks: 10 });
    runDetectors.mockRejectedValue(new Error("detector boom"));

    const res = await POST(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.stage).toBe("detect-signals");
    expect(body.entities).toEqual({ articlesProcessed: 1, mentionsWritten: 1, newEntities: 0, candidatesTouched: 0 });
    expect(persistSignals).not.toHaveBeenCalled();
  });

  it("attributes a fetch-feeds failure with no counts computed yet", async () => {
    fetchAllFeeds.mockRejectedValue(new Error("network down"));

    const res = await POST(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.stage).toBe("fetch-feeds");
    expect(body.inserted).toBeUndefined();
  });

  it("attributes a process-entities failure while still reporting the counts already computed", async () => {
    fetchAllFeeds.mockResolvedValue({ items: [], feedsAttempted: 5, feedsSucceeded: 5 });
    persistArticles.mockResolvedValue({ inserted: 2, duplicates: 1 });
    sweepRetention.mockResolvedValue(undefined);
    processNewArticles.mockRejectedValue(new Error("boom"));

    const res = await POST(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.stage).toBe("process-entities");
    expect(body.inserted).toBe(2);
    expect(body.feedsSucceeded).toBe(5);
  });

  it("attributes a persist-articles failure and does not run sweep or entities", async () => {
    fetchAllFeeds.mockResolvedValue({ items: [], feedsAttempted: 5, feedsSucceeded: 5 });
    persistArticles.mockRejectedValue(new Error("db unreachable"));

    const res = await POST(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.stage).toBe("persist-articles");
    expect(sweepRetention).not.toHaveBeenCalled();
    expect(processNewArticles).not.toHaveBeenCalled();
  });
});
