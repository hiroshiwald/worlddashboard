// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDashboardTable } from "../useDashboardTable";
import type { FeedItem } from "@/lib/types";

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

function stubFetchRouter(handlers: Record<string, () => Promise<unknown>>) {
  const fn = vi.fn((url: string) => {
    const handler = handlers[url];
    if (!handler) throw new Error(`fetch must be mocked per test (unexpected url: ${url})`);
    return handler();
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function makeItem(id: string, published: string, updatedAt?: string): FeedItem {
  return {
    id, title: `Story ${id}`, link: `https://example.com/${id}`, published, updatedAt,
    summary: "", sourceName: "Source", sourceCategory: "world", sourceTier: "1", imageUrl: "",
  };
}

function mockCandidates() {
  return Promise.resolve({ ok: true, json: async () => ({ candidates: [] }) });
}

describe("useDashboardTable default sort (Time column)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("orders by updatedAt, not by publish time, when they disagree (db mode)", async () => {
    // A: published very recently, but its cluster hasn't updated in days.
    // B: published days ago, but a member just arrived — B should rank first.
    const items = [
      makeItem("a", iso(10 * 60 * 1000), iso(3 * 24 * 60 * 60 * 1000)),
      makeItem("b", iso(3 * 24 * 60 * 60 * 1000), iso(10 * 60 * 1000)),
    ];
    stubFetchRouter({
      "/api/articles": () =>
        Promise.resolve({ ok: true, json: async () => ({ items, lastIngestAt: iso(60 * 1000), count: items.length }) }),
      "/api/candidates": mockCandidates,
    });

    const { result } = renderHook(() => useDashboardTable());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    expect(result.current.sort).toEqual({ key: "published", direction: "desc" });
    expect(result.current.sortedItems.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("falls back to publish time when updatedAt is absent (live mode) — unchanged behavior", async () => {
    const items = [
      { ...makeItem("a", iso(10 * 60 * 1000)), updatedAt: undefined },
      { ...makeItem("b", iso(3 * 24 * 60 * 60 * 1000)), updatedAt: undefined },
    ];
    stubFetchRouter({
      "/api/articles": () => Promise.resolve({ ok: false, status: 503, json: async () => ({}) }),
      "/api/sources": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            items, fetchedAt: new Date().toISOString(),
            feedsAttempted: 1, feedsSucceeded: 1, count: items.length, feedDiagnostics: [],
          }),
        }),
      "/api/candidates": mockCandidates,
    });

    const { result } = renderHook(() => useDashboardTable());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    expect(result.current.sortedItems.map((i) => i.id)).toEqual(["a", "b"]);
  });
});
