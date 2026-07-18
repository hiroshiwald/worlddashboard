// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useFeed } from "../useSources";

function mockArticlesResponse(lastIngestAt: string | null) {
  return Promise.resolve({
    ok: true,
    json: async () => ({ items: [], lastIngestAt, count: 0 }),
  });
}

function mockTickResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body });
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

function countCalls(fetchMock: ReturnType<typeof stubFetchRouter>, url: string): number {
  return fetchMock.mock.calls.filter(([calledUrl]) => calledUrl === url).length;
}

// jsdom hardcodes visible/not-hidden; these tests override both properties
// to simulate backgrounding a tab, matching how a real browser flips them.
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(document, "hidden", {
    value: state === "hidden",
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  setVisibility("visible");
});

describe("useFeed passive freshness check", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fires a plain POST /api/tick when lastIngestAt is stale (>15min) and the document is visible", async () => {
    const staleIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();
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

  it("does not fire when lastIngestAt is under 15 minutes old", async () => {
    const freshIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
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

  it("does not fire while the document is hidden, even when stale", async () => {
    setVisibility("hidden");
    const staleIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const fetchMock = stubFetchRouter({
      "/api/articles": () => mockArticlesResponse(staleIso),
    });

    const { result, unmount } = renderHook(() => useFeed());

    await waitFor(() => expect(result.current.mode).toBe("db"));
    await waitFor(() => expect(result.current.lastIngestAt).toBe(staleIso));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const tickCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/tick");
    expect(tickCalls).toHaveLength(0);

    unmount();
  });

  it("a visibilitychange to visible triggers an immediate check", async () => {
    setVisibility("hidden");
    const staleIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const fetchMock = stubFetchRouter({
      "/api/articles": () => mockArticlesResponse(staleIso),
      "/api/tick": () => Promise.resolve({ ok: true, json: async () => ({ triggered: true }) }),
    });

    const { result, unmount } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.lastIngestAt).toBe(staleIso));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/tick")).toHaveLength(0);

    setVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      const tickCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/tick");
      expect(tickCalls).toHaveLength(1);
    });

    unmount();
  });

  it("never touches refreshState, even when the response is triggered:true", async () => {
    const staleIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const fetchMock = stubFetchRouter({
      "/api/articles": () => mockArticlesResponse(staleIso),
      "/api/tick": () => Promise.resolve({ ok: true, json: async () => ({ triggered: true }) }),
    });

    const { result, unmount } = renderHook(() => useFeed());

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/tick")).toHaveLength(1);
    });
    // Let the triggered:true follow-up refetch (immediate + 30s backup
    // schedule) run its immediate leg too.
    await waitFor(() => expect(countCalls(fetchMock, "/api/articles")).toBeGreaterThanOrEqual(2));

    expect(result.current.refreshState).toBe("idle");

    unmount();
  });

  it("clears the passive interval and visibilitychange listener on unmount", async () => {
    const staleIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    stubFetchRouter({
      "/api/articles": () => mockArticlesResponse(staleIso),
      "/api/tick": () => Promise.resolve({ ok: true, json: async () => ({ triggered: true }) }),
    });

    const { result, unmount } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.mode).toBe("db"));

    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});

// A 5-minute-old lastIngestAt is deliberately used throughout: fresh enough
// (< 15min) that the passive check in the suite above never fires, so every
// /api/tick?manual=1 call below comes solely from the explicit refresh()
// under test.
describe("useFeed refresh()", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("db mode, triggered:true: sets 'collecting' synchronously before the tick response resolves, then refetches immediately and schedules one ~30s backup", async () => {
    const freshIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    let resolveTick!: (value: unknown) => void;
    const tickPromise = new Promise<unknown>((resolve) => {
      resolveTick = resolve;
    });
    const fetchMock = stubFetchRouter({
      "/api/articles": () => mockArticlesResponse(freshIso),
      "/api/tick?manual=1": () => tickPromise,
    });

    const { result, unmount } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.mode).toBe("db"));
    const articlesCallsBeforeClick = countCalls(fetchMock, "/api/articles");
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    act(() => {
      result.current.refresh();
    });

    // The tick request is in flight and still unresolved — 'collecting'
    // must come from the click itself, not from the (pending) response.
    expect(result.current.refreshState).toBe("collecting");
    expect(countCalls(fetchMock, "/api/tick?manual=1")).toBe(1);
    expect(countCalls(fetchMock, "/api/articles")).toBe(articlesCallsBeforeClick);

    resolveTick({ ok: true, json: async () => ({ triggered: true, inserted: 2 }) });
    await waitFor(() => expect(result.current.refreshState).toBe("idle"));

    expect(countCalls(fetchMock, "/api/articles")).toBe(articlesCallsBeforeClick + 1);
    const delays = setTimeoutSpy.mock.calls.map(([, delay]) => delay);
    expect(delays).toContain(30_000);
    expect(delays).not.toContain(90_000);

    unmount();
  });

  it("db mode, reason:'locked': treated like collecting (same delayed-refetch schedule)", async () => {
    const freshIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const fetchMock = stubFetchRouter({
      "/api/articles": () => mockArticlesResponse(freshIso),
      "/api/tick?manual=1": () => mockTickResponse({ triggered: false, reason: "locked" }),
    });

    const { result, unmount } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.mode).toBe("db"));
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.refreshState).toBe("collecting");
    const delays = setTimeoutSpy.mock.calls.map(([, delay]) => delay);
    expect(delays).toContain(30_000);
    expect(delays).toContain(90_000);

    unmount();
  });

  it("db mode, reason:'fresh': refetches /api/articles once immediately and shows refreshState 'fresh'", async () => {
    const freshIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const fetchMock = stubFetchRouter({
      "/api/articles": () => mockArticlesResponse(freshIso),
      "/api/tick?manual=1": () => mockTickResponse({ triggered: false, reason: "fresh" }),
    });

    const { result, unmount } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.mode).toBe("db"));
    const articlesCallsBefore = countCalls(fetchMock, "/api/articles");

    await act(async () => {
      await result.current.refresh();
    });

    expect(countCalls(fetchMock, "/api/articles")).toBe(articlesCallsBefore + 1);
    expect(result.current.refreshState).toBe("fresh");
    expect(countCalls(fetchMock, "/api/tick?manual=1")).toBe(1);

    unmount();
  });

  it("db mode: a failed tick request warns and falls back to a single plain refetch", async () => {
    const freshIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const fetchMock = stubFetchRouter({
      "/api/articles": () => mockArticlesResponse(freshIso),
      "/api/tick?manual=1": () => Promise.reject(new Error("network down")),
    });

    const { result, unmount } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.mode).toBe("db"));
    const articlesCallsBefore = countCalls(fetchMock, "/api/articles");

    await act(async () => {
      await result.current.refresh();
    });

    expect(countCalls(fetchMock, "/api/articles")).toBe(articlesCallsBefore + 1);
    expect(result.current.refreshState).toBe("idle");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("/api/tick?manual=1 failed"),
      expect.anything(),
    );

    unmount();
  });

  it("db mode: a non-ok tick response also warns and falls back to a single plain refetch", async () => {
    const freshIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const fetchMock = stubFetchRouter({
      "/api/articles": () => mockArticlesResponse(freshIso),
      "/api/tick?manual=1": () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }),
    });

    const { result, unmount } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.mode).toBe("db"));
    const articlesCallsBefore = countCalls(fetchMock, "/api/articles");

    await act(async () => {
      await result.current.refresh();
    });

    expect(countCalls(fetchMock, "/api/articles")).toBe(articlesCallsBefore + 1);
    expect(result.current.refreshState).toBe("idle");

    unmount();
  });

  it("live mode: refresh() re-fetches /api/sources directly and never touches /api/tick", async () => {
    const fetchMock = stubFetchRouter({
      "/api/articles": () => Promise.resolve({ ok: false, status: 503, json: async () => ({}) }),
      "/api/sources": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            items: [], fetchedAt: new Date().toISOString(),
            feedsAttempted: 5, feedsSucceeded: 5, count: 0, feedDiagnostics: [],
          }),
        }),
    });

    const { result, unmount } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.mode).toBe("live"));
    const sourcesCallsBefore = countCalls(fetchMock, "/api/sources");

    await act(async () => {
      await result.current.refresh();
    });

    expect(countCalls(fetchMock, "/api/sources")).toBe(sourcesCallsBefore + 1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/tick"))).toBe(false);
    expect(result.current.refreshState).toBe("idle");

    unmount();
  });
});
