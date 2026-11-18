// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, cleanup } from "@testing-library/react";
import { SnapshotProvider, useSnapshot } from "@/components/SnapshotContext";
import { useEntitiesTab } from "../useEntitiesTab";
import { useCandidateQueue } from "../useCandidateQueue";

const STATS = { totalTracked: 1 };
const row = (id: number, name: string) => ({ id, canonicalName: name, status: "tracked", fame: "unknown", fameLocked: false });
const cand = (name: string) => ({ nameNorm: name, displayName: name, typeHint: "other" });
const DEFAULTS = { debouncedQ: "", status: "tracked", fame: "all", fameChecked: "all", fameLocked: false, sort: "growth", offset: 0, pageSize: 50 };
const entitiesCopy = (name: string, params = DEFAULTS) => ({ params, stats: STATS, entities: [row(1, name)], total: 1 });

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
const entitiesFetch = (name: string) => vi.fn(async (url: string) => ok(url.includes("view=stats") ? STATS : { entities: [row(1, name)], total: 1 }));
const failingFetch = () => vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));

// Mounts `useHook` in a provider that already holds `seed` under `key`; the
// hook can be unmounted and mounted again inside that same provider.
function setup<T>(key: string, seed: unknown, useHook: () => T) {
  const out: { current: T | null } = { current: null };
  const slot: { save: ((v: unknown) => void) | null } = { save: null };
  function Seeder() {
    slot.save = useSnapshot<unknown>(key)[1];
    return null;
  }
  function Probe() {
    out.current = useHook();
    return null;
  }
  const tree = (show: boolean) => (
    <SnapshotProvider>
      <Seeder />
      {show ? <Probe /> : null}
    </SnapshotProvider>
  );
  const view = render(tree(false));
  if (seed !== undefined) act(() => slot.save!(seed));
  return {
    out,
    show: () => view.rerender(tree(true)),
    hide: () => view.rerender(tree(false)),
  };
}

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("useEntitiesTab snapshot", () => {
  it("shows a saved copy at once, still fetches, then the fresh result replaces it", async () => {
    const fetchMock = entitiesFetch("Fresh");
    vi.stubGlobal("fetch", fetchMock);
    const h = setup("entities", entitiesCopy("Saved"), useEntitiesTab);
    h.show();
    expect(h.out.current!.loading).toBe(false);
    expect(h.out.current!.entities[0].canonicalName).toBe("Saved");
    await waitFor(() => expect(h.out.current!.entities[0].canonicalName).toBe("Fresh"));
    expect(fetchMock).toHaveBeenCalled();
    expect(h.out.current!.loading).toBe(false);
  });

  it("keeps the copy and sets no error when the background load fails", async () => {
    const fetchMock = failingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const h = setup("entities", entitiesCopy("Saved"), useEntitiesTab);
    h.show();
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalled();
    expect(h.out.current!.entities[0].canonicalName).toBe("Saved");
    expect(h.out.current!.error).toBeNull();
    expect(h.out.current!.loading).toBe(false);
  });

  it("ignores a copy with different params", async () => {
    vi.stubGlobal("fetch", entitiesFetch("Fresh"));
    const h = setup("entities", entitiesCopy("Saved", { ...DEFAULTS, status: "dismissed" }), useEntitiesTab);
    h.show();
    expect(h.out.current!.loading).toBe(true);
    expect(h.out.current!.entities).toEqual([]);
    await waitFor(() => expect(h.out.current!.entities[0].canonicalName).toBe("Fresh"));
  });

  it("saves a local change so a remount in the same provider shows it", async () => {
    const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") return ok({ ...row(1, "Fresh"), status: "tracked", fame: "famous" });
      return ok(url.includes("view=stats") ? STATS : { entities: [row(1, "Fresh")], total: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const h = setup("entities", undefined, useEntitiesTab);
    h.show();
    await waitFor(() => expect(h.out.current!.entities[0]?.canonicalName).toBe("Fresh"));
    // From here only the PATCH succeeds, so the table can show nothing but the local change.
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") return ok({ ...row(1, "Fresh"), fame: "famous" });
      return { ok: false, status: 500, json: async () => ({}) };
    });
    await act(async () => { await h.out.current!.updateEntity(1, { fame: "famous" }); });
    expect(h.out.current!.entities[0].fame).toBe("famous");
    h.hide();
    h.show();
    expect(h.out.current!.entities[0].fame).toBe("famous");
  });
});

describe("useCandidateQueue snapshot", () => {
  it("shows a saved copy at once, reports its count, fetches, then the fresh list replaces it", async () => {
    const fetchMock = vi.fn(async () => ok({ candidates: [cand("fresh")] }));
    vi.stubGlobal("fetch", fetchMock);
    const onCount = vi.fn();
    const h = setup("candidates", [cand("saved1"), cand("saved2")], () => useCandidateQueue(onCount));
    h.show();
    expect(h.out.current!.loading).toBe(false);
    expect(h.out.current!.total).toBe(2);
    expect(onCount).toHaveBeenCalledWith(2);
    await waitFor(() => expect(h.out.current!.pageItems[0].nameNorm).toBe("fresh"));
    expect(fetchMock).toHaveBeenCalled();
    expect(onCount).toHaveBeenLastCalledWith(1);
  });

  it("keeps the copy and sets no error when the background load fails", async () => {
    vi.stubGlobal("fetch", failingFetch());
    const onCount = vi.fn();
    const h = setup("candidates", [cand("saved")], () => useCandidateQueue(onCount));
    h.show();
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(h.out.current!.pageItems[0].nameNorm).toBe("saved");
    expect(h.out.current!.error).toBeNull();
    expect(onCount).not.toHaveBeenCalledWith(0);
  });

  it("saves the list after the reader's own dismiss, so a remount shows it", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === "POST") return ok({});
      return ok({ candidates: [cand("a")] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onCount = vi.fn(); // must be stable: load() depends on it
    const h = setup("candidates", undefined, () => useCandidateQueue(onCount));
    h.show();
    await waitFor(() => expect(h.out.current!.total).toBe(1));
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => {
      if (init?.method === "POST") return ok({});
      return ok({ candidates: [] });
    });
    await act(async () => { await h.out.current!.dismissOne("a"); });
    expect(h.out.current!.total).toBe(0);
    h.hide();
    h.show();
    expect(h.out.current!.total).toBe(0);
    expect(h.out.current!.loading).toBe(false);
  });
});
