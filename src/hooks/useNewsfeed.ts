"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  parseFeedResponse,
  cursorOf,
  mergeNewer,
  applyEntityStatus,
  applyCandidateStatus,
  type FeedArticle,
  type FeedCandidate,
  type FeedEntity,
} from "@/components/newsfeed/feed-logic";
import { useSnapshot } from "@/components/SnapshotContext";

const PAGE_LIMIT = 50;
const POLL_LIMIT = 100;
const POLL_MS = 60_000;
const GROWTH_LIMIT = 200;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;
const MAX_QUERY_LEN = 100;

class DatabaseNotConfiguredError extends Error {}

export interface EntityGrowth {
  state: string;
  ratioText: string;
  mentions7d: number;
  sourcesLabel: string;
  nearestTracked: { id: string; name: string; hops: number }[];
}

export interface EntityDetailArticle {
  id: number;
  title: string;
  link: string;
  sourceName: string;
  published: string;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 503) throw new DatabaseNotConfiguredError();
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export async function sendJson(method: string, url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return;
  let message = `Request failed (${res.status})`;
  const data: unknown = await res.json().catch(() => null);
  if (typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string") {
    message = (data as { error: string }).error;
  }
  throw new Error(message);
}

function feedUrl(params: Record<string, string>, q: string | null): string {
  const search = new URLSearchParams({ limit: String(PAGE_LIMIT), ...params });
  if (q !== null) search.set("q", q);
  return `/api/feed?${search}`;
}

/** Trimmed search text the server accepts, else null (too short or too long: show the plain feed). */
export function normalizeQuery(raw: string): string | null {
  const q = raw.trim();
  if (q.length < MIN_QUERY_LEN || q.length > MAX_QUERY_LEN) return null;
  return q;
}

/** `typed` follows the input at once; `q` follows it after a pause, and clears at once. */
function useDebouncedQuery(raw: string): { typed: string | null; q: string | null } {
  const typed = normalizeQuery(raw);
  const [q, setQ] = useState<string | null>(typed);
  useEffect(() => {
    if (typed === null) {
      setQ(null);
      return undefined;
    }
    const timer = setTimeout(() => setQ(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  return { typed, q };
}

function parseGrowth(raw: unknown): Record<string, EntityGrowth> {
  const rows = (raw as { entities?: unknown }).entities;
  if (!Array.isArray(rows)) throw new Error("entities: response has no entities array");
  const out: Record<string, EntityGrowth> = {};
  for (const row of rows) {
    out[String(row.id)] = {
      state: String(row.growth?.state ?? ""),
      ratioText: String(row.growth?.ratioText ?? ""),
      mentions7d: Number(row.mentions7d ?? 0),
      sourcesLabel: String(row.sources?.label ?? ""),
      nearestTracked: Array.isArray(row.nearestTracked) ? row.nearestTracked : [],
    };
  }
  return out;
}

/** Growth state per entity id, from the Entities list sorted by growth.
 * `unavailable` is true when that call failed; the feed still works. */
function useGrowth() {
  // The last growth map is drawn at once on return; the reload replaces it.
  const [saved, save] = useSnapshot<Record<string, EntityGrowth>>("newsfeed-growth");
  const [growth, setGrowth] = useState<Record<string, EntityGrowth>>(saved ?? {});
  const [unavailable, setUnavailable] = useState(false);
  const fromCopy = useRef(saved !== undefined);
  const load = useCallback(async () => {
    try {
      const fresh = parseGrowth(await getJson(`/api/entities?sort=growth&limit=${GROWTH_LIMIT}`));
      fromCopy.current = false;
      setGrowth(fresh);
      save(fresh);
      setUnavailable(false);
    } catch (err) {
      console.warn("newsfeed: growth unavailable", err);
      // A copy still on screen stays without the "unavailable" notice.
      if (!fromCopy.current) setUnavailable(true);
    }
  }, [save]);
  useEffect(() => {
    void load();
  }, [load]);
  return { growth, growthUnavailable: unavailable, reloadGrowth: load };
}

interface Pages {
  items: FeedArticle[];
  setItems: React.Dispatch<React.SetStateAction<FeedArticle[]>>;
  nextCursor: string | null;
  lastIngestAt: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  dbUnconfigured: boolean;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  setLastIngestAt: (iso: string | null) => void;
}

interface FeedSnapshot {
  items: FeedArticle[];
  nextCursor: string | null;
  lastIngestAt: string | null;
}

function usePages(q: string | null): Pages {
  // One slot: what the plain feed (no search) showed, including the reader's own
  // Track/Ignore changes. Everything loaded is saved; the reload on mount
  // replaces it with page 1. Never used or written while a search is active.
  const [saved, save] = useSnapshot<FeedSnapshot>("newsfeed");
  const start = q === null ? saved : undefined;
  const [items, setItems] = useState<FeedArticle[]>(start?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(start?.nextCursor ?? null);
  const [lastIngestAt, setLastIngestAt] = useState<string | null>(start?.lastIngestAt ?? null);
  const [loading, setLoading] = useState(start === undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbUnconfigured, setDbUnconfigured] = useState(false);

  // Each reload bumps this; a response for an older query or page is dropped.
  const generation = useRef(0);
  // fromCopy: the saved copy is still on screen. itemsQuery: the query that
  // produced the items on screen (undefined before the first load).
  const fromCopy = useRef(start !== undefined);
  const itemsQuery = useRef<string | null | undefined>(start === undefined ? undefined : null);

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    const background = q === null && fromCopy.current;
    if (!background) setLoading(true);
    setError(null);
    try {
      const page = parseFeedResponse(await getJson(feedUrl({}, q)));
      if (mine !== generation.current) return;
      fromCopy.current = false;
      itemsQuery.current = q;
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setLastIngestAt(page.lastIngestAt);
      setDbUnconfigured(false);
    } catch (err) {
      if (background) {
        console.warn("newsfeed: background reload failed, showing saved feed", err);
      } else if (err instanceof DatabaseNotConfiguredError) setDbUnconfigured(true);
      else setError(err instanceof Error ? err.message : "Failed to load the feed");
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [q]);

  const loadMore = useCallback(async () => {
    if (nextCursor === null) return;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const page = parseFeedResponse(await getJson(feedUrl({ before: nextCursor }, q)));
      if (mine !== generation.current) return;
      setItems((prev) => [...prev, ...page.items.filter((a) => !prev.some((p) => p.id === a.id))]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, q]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Save what is on screen, but only when it came from a no-search load.
  useEffect(() => {
    if (q === null && itemsQuery.current === null) save({ items, nextCursor, lastIngestAt });
  }, [q, items, nextCursor, lastIngestAt, save]);

  return { items, setItems, nextCursor, lastIngestAt, loading, loadingMore, error, dbUnconfigured, reload, loadMore, setLastIngestAt };
}

/** Polls ?after=<newest> every 60 s while visible and not paused. Held
 * articles wait in `pending` until showPending; the list never moves on its own. */
function usePolling(pages: Pages, searching: boolean) {
  const [pending, setPending] = useState<FeedArticle[]>([]);
  const [paused, setPaused] = useState(false);
  const [pollError, setPollError] = useState(false);
  const latest = useRef({ pending, items: pages.items });
  latest.current = { pending, items: pages.items };
  const { setLastIngestAt } = pages;

  const pollOnce = useCallback(async () => {
    const newest = latest.current.pending[0] ?? latest.current.items[0];
    if (newest === undefined || searching) return;
    try {
      const page = parseFeedResponse(await getJson(feedUrl({ after: cursorOf(newest), limit: String(POLL_LIMIT) }, null)));
      setPending((prev) => mergeNewer(prev, page.items));
      setLastIngestAt(page.lastIngestAt);
      setPollError(false);
    } catch (err) {
      console.warn("newsfeed: poll failed", err);
      setPollError(true);
    }
  }, [setLastIngestAt, searching]);

  useEffect(() => {
    if (paused) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void pollOnce();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [paused, pollOnce]);

  const showPending = useCallback(() => {
    pages.setItems((prev) => mergeNewer(prev, latest.current.pending));
    setPending([]);
  }, [pages]);

  return { pendingCount: pending.length, paused, setPaused, pollError, showPending, pollOnce };
}

/** Track / stop / dismiss actions. One request at a time per key; failures surface in `actionError`. */
function useActions(pages: Pages, reloadGrowth: () => Promise<void>) {
  const [busy, setBusy] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const { setItems } = pages;

  const run = useCallback(async (key: string, work: () => Promise<void>) => {
    setBusy((prev) => [...prev, key]);
    setActionError(null);
    try {
      await work();
      await reloadGrowth();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy((prev) => prev.filter((k) => k !== key));
    }
  }, [reloadGrowth]);

  const setEntityStatus = useCallback(
    (entity: FeedEntity, status: "tracked" | "dismissed") =>
      run(`e${entity.id}`, async () => {
        await sendJson("PATCH", `/api/entities/${encodeURIComponent(entity.id)}`, { status });
        setItems((prev) => applyEntityStatus(prev, { entityId: entity.id, status }));
      }),
    [run, setItems],
  );

  const trackCandidate = useCallback(
    (candidate: FeedCandidate) =>
      run(`c${candidate.nameNorm}`, async () => {
        await sendJson("POST", "/api/candidates", { nameNorm: candidate.nameNorm, action: "accept", type: candidate.typeHint });
        setItems((prev) => applyCandidateStatus(prev, candidate, "tracked"));
      }),
    [run, setItems],
  );

  const dismissCandidate = useCallback(
    (candidate: FeedCandidate) =>
      run(`c${candidate.nameNorm}`, async () => {
        await sendJson("POST", "/api/candidates", { nameNorm: candidate.nameNorm, action: "dismiss" });
        setItems((prev) => applyCandidateStatus(prev, candidate, "dismissed"));
      }),
    [run, setItems],
  );

  return { busy, actionError, setEntityStatus, trackCandidate, dismissCandidate };
}

/** `searchText` is the raw header input; the server searches all stored articles. */
export function useNewsfeed(searchText = "") {
  const { typed, q } = useDebouncedQuery(searchText);
  const pages = usePages(q);
  const { growth, growthUnavailable, reloadGrowth } = useGrowth();
  const polling = usePolling(pages, q !== null);
  const actions = useActions(pages, reloadGrowth);
  return {
    items: pages.items,
    loading: pages.loading,
    searchActive: typed !== null,
    searching: typed !== null && (typed !== q || pages.loading),
    loadingMore: pages.loadingMore,
    error: pages.error,
    dbUnconfigured: pages.dbUnconfigured,
    lastIngestAt: pages.lastIngestAt,
    hasMore: pages.nextCursor !== null,
    reload: pages.reload,
    loadMore: pages.loadMore,
    growth,
    growthUnavailable,
    ...polling,
    ...actions,
  };
}

/** Latest articles for the popup's evidence list. Skips ids that are not database entities. */
export function useEntityEvidence(entityId: string | null) {
  const [articles, setArticles] = useState<EntityDetailArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setArticles([]);
    setError(null);
    if (entityId === null || !/^\d+$/.test(entityId)) return undefined;
    let cancelled = false;
    setLoading(true);
    getJson(`/api/entities/${entityId}`)
      .then((data) => {
        const list = (data as { articles?: unknown }).articles;
        if (!Array.isArray(list)) throw new Error("entity: response has no articles array");
        if (!cancelled) setArticles(list.slice(0, 5));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load evidence");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  return { articles, loading, error };
}
