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

const PAGE_LIMIT = 50;
const POLL_LIMIT = 100;
const POLL_MS = 60_000;
const GROWTH_LIMIT = 200;

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

function feedUrl(params: Record<string, string>): string {
  return `/api/feed?${new URLSearchParams({ limit: String(PAGE_LIMIT), ...params })}`;
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
  const [growth, setGrowth] = useState<Record<string, EntityGrowth>>({});
  const [unavailable, setUnavailable] = useState(false);
  const load = useCallback(async () => {
    try {
      setGrowth(parseGrowth(await getJson(`/api/entities?sort=growth&limit=${GROWTH_LIMIT}`)));
      setUnavailable(false);
    } catch (err) {
      console.warn("newsfeed: growth unavailable", err);
      setUnavailable(true);
    }
  }, []);
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

function usePages(): Pages {
  const [items, setItems] = useState<FeedArticle[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [lastIngestAt, setLastIngestAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbUnconfigured, setDbUnconfigured] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = parseFeedResponse(await getJson(feedUrl({})));
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setLastIngestAt(page.lastIngestAt);
      setDbUnconfigured(false);
    } catch (err) {
      if (err instanceof DatabaseNotConfiguredError) setDbUnconfigured(true);
      else setError(err instanceof Error ? err.message : "Failed to load the feed");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (nextCursor === null) return;
    setLoadingMore(true);
    try {
      const page = parseFeedResponse(await getJson(feedUrl({ before: nextCursor })));
      setItems((prev) => [...prev, ...page.items.filter((a) => !prev.some((p) => p.id === a.id))]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, setItems, nextCursor, lastIngestAt, loading, loadingMore, error, dbUnconfigured, reload, loadMore, setLastIngestAt };
}

/** Polls ?after=<newest> every 60 s while visible and not paused. Held
 * articles wait in `pending` until showPending; the list never moves on its own. */
function usePolling(pages: Pages) {
  const [pending, setPending] = useState<FeedArticle[]>([]);
  const [paused, setPaused] = useState(false);
  const [pollError, setPollError] = useState(false);
  const latest = useRef({ pending, items: pages.items });
  latest.current = { pending, items: pages.items };
  const { setLastIngestAt } = pages;

  const pollOnce = useCallback(async () => {
    const newest = latest.current.pending[0] ?? latest.current.items[0];
    if (newest === undefined) return;
    try {
      const page = parseFeedResponse(await getJson(feedUrl({ after: cursorOf(newest), limit: String(POLL_LIMIT) })));
      setPending((prev) => mergeNewer(prev, page.items));
      setLastIngestAt(page.lastIngestAt);
      setPollError(false);
    } catch (err) {
      console.warn("newsfeed: poll failed", err);
      setPollError(true);
    }
  }, [setLastIngestAt]);

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

export function useNewsfeed() {
  const pages = usePages();
  const { growth, growthUnavailable, reloadGrowth } = useGrowth();
  const polling = usePolling(pages);
  const actions = useActions(pages, reloadGrowth);
  return {
    items: pages.items,
    loading: pages.loading,
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
