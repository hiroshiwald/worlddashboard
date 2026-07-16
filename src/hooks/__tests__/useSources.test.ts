// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useFeed } from "../useSources";

function mockArticlesResponse(lastIngestAt: string | null) {
  return Promise.resolve({
    ok: true,
    json: async () => ({ items: [], lastIngestAt, count: 0 }),
  });
}

function stubFetchRouter(handlers: Record<string, () => Promise<unknown>>) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const handler = handlers[url];
    if (!handler) throw new Error(`fetch must be mocked per test (unexpected url: ${url})`);
    return handler();
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("useFeed tick trigger", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fires POST /api/tick exactly once when lastIngestAt is older than 2 hours", async () => {
    const staleIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const fetchMock = stubFetchRouter({
      "/api/articles": () => mockArticlesResponse(staleIso),
      "/api/tick": () => Promise.resolve({ ok: true, json: async () => ({ triggered: true }) }),
    });

    const { result, unmount } = renderHook(() => useFeed());

    await waitFor(() => expect(result.current.mode).toBe("db"));
    await waitFor(() => {
      const tickCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/tick");
      expect(tickCalls).toHaveLength(1);
    });

    const tickCall = fetchMock.mock.calls.find(([url]) => url === "/api/tick")!;
    expect(tickCall[1]).toEqual({ method: "POST" });

    unmount();
  });

  it("does not fire /api/tick when lastIngestAt is under 2 hours old", async () => {
    const freshIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const fetchMock = stubFetchRouter({
      "/api/articles": () => mockArticlesResponse(freshIso),
    });

    const { result, unmount } = renderHook(() => useFeed());

    await waitFor(() => expect(result.current.mode).toBe("db"));
    await waitFor(() => expect(result.current.lastIngestAt).toBe(freshIso));

    const tickCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/tick");
    expect(tickCalls).toHaveLength(0);

    unmount();
  });

  it("does not fire /api/tick a second time on a later re-render past the threshold", async () => {
    const staleIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const fetchMock = stubFetchRouter({
      "/api/articles": () => mockArticlesResponse(staleIso),
      "/api/tick": () => Promise.resolve({ ok: true, json: async () => ({ triggered: true }) }),
    });

    const { result, rerender, unmount } = renderHook(() => useFeed());

    await waitFor(() => {
      const tickCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/tick");
      expect(tickCalls).toHaveLength(1);
    });

    rerender();
    expect(result.current.mode).toBe("db");
    const tickCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/tick");
    expect(tickCalls).toHaveLength(1);

    unmount();
  });
});
