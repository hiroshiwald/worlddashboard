// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useNewsfeed } from "../useNewsfeed";

const candidate = { nameNorm: "cyan", name: "Cyan", typeHint: "company", firstSeenAt: "2026-11-16T08:00:00.000Z", mentionCount: 3 };
const item = (id: string, over: object = {}) => ({
  id, title: `T${id}`, link: "https://x.test", sourceName: "S", sourceCategory: "news",
  firstSeenAt: "2026-11-16T11:00:00.000Z", publishedAt: null, entities: [], candidates: [candidate], ...over,
});

function stubFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const { status = 200, body } = handler(url, init);
    return Promise.resolve({ ok: status < 400, status, json: async () => body });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("useNewsfeed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("loads the feed and growth", async () => {
    stubFetch((url) =>
      url.startsWith("/api/feed")
        ? { body: { items: [item("1")], nextCursor: "c", lastIngestAt: "2026-11-16T11:30:00.000Z" } }
        : { body: { entities: [{ id: 5, growth: { state: "Rising", ratioText: "4.0" }, nearestTracked: [] }] } },
    );
    const { result } = renderHook(() => useNewsfeed());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.hasMore).toBe(true);
    await waitFor(() => expect(result.current.growth["5"]?.state).toBe("Rising"));
  });

  it("treats 503 as dbUnconfigured", async () => {
    stubFetch(() => ({ status: 503, body: { error: "x" } }));
    const { result } = renderHook(() => useNewsfeed());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dbUnconfigured).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("reports a failed load", async () => {
    stubFetch(() => ({ status: 500, body: {} }));
    const { result } = renderHook(() => useNewsfeed());
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it("tracks a candidate through POST /api/candidates and moves it to entities", async () => {
    const fetchFn = stubFetch((url, init) => {
      if (init?.method === "POST") return { body: { ok: true } };
      if (url.startsWith("/api/feed")) return { body: { items: [item("1")], nextCursor: null, lastIngestAt: null } };
      return { body: { entities: [] } };
    });
    const { result } = renderHook(() => useNewsfeed());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.trackCandidate(candidate);
    });
    const post = fetchFn.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ nameNorm: "cyan", action: "accept", type: "company" });
    expect(result.current.items[0].entities[0]).toMatchObject({ name: "Cyan", status: "tracked" });
    expect(result.current.items[0].candidates).toHaveLength(0);
  });

  it("surfaces an action failure and leaves the item untouched", async () => {
    stubFetch((url, init) => {
      if (init?.method === "POST") return { status: 409, body: { error: "conflict" } };
      if (url.startsWith("/api/feed")) return { body: { items: [item("1")], nextCursor: null, lastIngestAt: null } };
      return { body: { entities: [] } };
    });
    const { result } = renderHook(() => useNewsfeed());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.trackCandidate(candidate);
    });
    expect(result.current.actionError).toBe("conflict");
    expect(result.current.items[0].candidates).toHaveLength(1);
  });

  it("holds polled articles until showPending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchFn = stubFetch((url) => {
      if (url.includes("after=")) return { body: { items: [item("2")], nextCursor: null, lastIngestAt: null } };
      if (url.startsWith("/api/feed")) return { body: { items: [item("1")], nextCursor: null, lastIngestAt: null } };
      return { body: { entities: [] } };
    });
    const { result } = renderHook(() => useNewsfeed());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    expect(fetchFn.mock.calls.some(([u]) => String(u).includes("after="))).toBe(true);
    expect(result.current.items).toHaveLength(1);
    act(() => result.current.showPending());
    expect(result.current.items.map((a) => a.id)).toEqual(["2", "1"]);
    expect(result.current.pendingCount).toBe(0);
  });
});
