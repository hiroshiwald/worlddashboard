import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const fetchAllFeeds = vi.fn();
const persistArticles = vi.fn();
const sweepRetention = vi.fn();
const processNewArticles = vi.fn();

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
  });

  it("returns all counts and 200 when every stage succeeds", async () => {
    fetchAllFeeds.mockResolvedValue({ items: [], feedsAttempted: 5, feedsSucceeded: 5 });
    persistArticles.mockResolvedValue({ inserted: 2, duplicates: 1 });
    sweepRetention.mockResolvedValue(undefined);
    processNewArticles.mockResolvedValue({ articlesProcessed: 1, mentionsWritten: 1, newEntities: 0, candidatesTouched: 0 });

    const res = await POST(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ feedsAttempted: 5, feedsSucceeded: 5, inserted: 2, duplicates: 1 });
    expect(body.entities).toEqual({ articlesProcessed: 1, mentionsWritten: 1, newEntities: 0, candidatesTouched: 0 });
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
