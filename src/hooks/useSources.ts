"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FeedItem, FeedDiagnostic } from "@/lib/types";

const STALE_INGEST_MS = 2 * 60 * 60 * 1000; // 2 hours
const TICK_REFRESH_DELAY_MS = 90 * 1000; // 90 seconds
const MANUAL_TICK_FIRST_REFETCH_MS = 30 * 1000; // 30 seconds
const FRESH_STATUS_DISPLAY_MS = 4 * 1000; // 4 seconds

interface ValidatedResponse {
  items: FeedItem[];
  fetchedAt: string | null;
  feedsAttempted: number;
  feedsSucceeded: number;
  count: number;
  feedDiagnostics: FeedDiagnostic[];
}

function validateApiResponse(data: unknown): ValidatedResponse {
  const obj = (data && typeof data === "object" ? data : {}) as Record<
    string,
    unknown
  >;

  if (!Array.isArray(obj.items)) {
    console.warn("[useSources] data.items is not an array, defaulting to []");
  }
  if (typeof obj.feedsAttempted !== "number") {
    console.warn(
      "[useSources] data.feedsAttempted is not a number, defaulting to 0",
    );
  }
  if (typeof obj.feedsSucceeded !== "number") {
    console.warn(
      "[useSources] data.feedsSucceeded is not a number, defaulting to 0",
    );
  }
  if (typeof obj.count !== "number") {
    console.warn(
      "[useSources] data.count is not a number, defaulting to 0",
    );
  }
  if (obj.feedDiagnostics !== undefined && !Array.isArray(obj.feedDiagnostics)) {
    console.warn(
      "[useSources] data.feedDiagnostics is not an array, defaulting to []",
    );
  }

  return {
    items: Array.isArray(obj.items) ? (obj.items as FeedItem[]) : [],
    fetchedAt: typeof obj.fetchedAt === "string" ? obj.fetchedAt : null,
    feedsAttempted:
      typeof obj.feedsAttempted === "number" ? obj.feedsAttempted : 0,
    feedsSucceeded:
      typeof obj.feedsSucceeded === "number" ? obj.feedsSucceeded : 0,
    count: typeof obj.count === "number" ? obj.count : 0,
    feedDiagnostics: Array.isArray(obj.feedDiagnostics)
      ? (obj.feedDiagnostics as FeedDiagnostic[])
      : [],
  };
}

interface ValidatedDbResponse {
  items: FeedItem[];
  lastIngestAt: string | null;
  count: number;
}

function validateDbResponse(data: unknown): ValidatedDbResponse | null {
  const obj = (data && typeof data === "object" ? data : {}) as Record<
    string,
    unknown
  >;
  if (!Array.isArray(obj.items)) return null;
  if (typeof obj.lastIngestAt !== "string" && obj.lastIngestAt !== null) {
    return null;
  }

  return {
    items: obj.items as FeedItem[],
    lastIngestAt: typeof obj.lastIngestAt === "string" ? obj.lastIngestAt : null,
    count: typeof obj.count === "number" ? obj.count : obj.items.length,
  };
}

interface TickResponse {
  triggered: boolean;
  reason: string | null;
}

// /api/tick's only two `reason` values are "fresh" and "locked" (see
// tick/route.ts), kept as a loose string here rather than re-encoding the
// server's contract as a union — same style as validateDbResponse above.
function validateTickResponse(data: unknown): TickResponse | null {
  const obj = (data && typeof data === "object" ? data : {}) as Record<
    string,
    unknown
  >;
  if (typeof obj.triggered !== "boolean") return null;
  return {
    triggered: obj.triggered,
    reason: typeof obj.reason === "string" ? obj.reason : null,
  };
}

// Applies the refreshState transition for a validated /api/tick response
// and returns any follow-up refetch timeouts to track. Split out of
// refresh() below to stay under the 50-line function limit.
async function applyTickResult(
  tick: TickResponse,
  fetchFeed: () => Promise<void>,
  setRefreshState: (state: "idle" | "collecting" | "fresh") => void,
): Promise<ReturnType<typeof setTimeout>[]> {
  if (tick.triggered) {
    // This response only arrives after the server has finished the run,
    // so the data is already fresh — refetch now. /api/articles still sits
    // behind a 60s CDN edge cache, so one backup refetch follows in case
    // this one raced a still-cached pre-collection response.
    await fetchFeed();
    setRefreshState("idle");
    return [setTimeout(fetchFeed, MANUAL_TICK_FIRST_REFETCH_MS)];
  }
  if (tick.reason === "locked") {
    // Another caller's run holds the lock, not this one — unlike
    // `triggered`, there's no guarantee it has finished yet, so this keeps
    // the original wait-then-refetch-twice schedule rather than refetching
    // immediately.
    const first = setTimeout(fetchFeed, MANUAL_TICK_FIRST_REFETCH_MS);
    const second = setTimeout(() => {
      fetchFeed();
      setRefreshState("idle");
    }, TICK_REFRESH_DELAY_MS);
    return [first, second];
  }
  if (tick.reason === "fresh") {
    await fetchFeed();
    setRefreshState("fresh");
    return [setTimeout(() => setRefreshState("idle"), FRESH_STATUS_DISPLAY_MS)];
  }
  await fetchFeed();
  setRefreshState("idle");
  return [];
}

interface UseFeedReturn {
  items: FeedItem[];
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
  feedsAttempted: number;
  feedsSucceeded: number;
  totalItems: number;
  feedDiagnostics: FeedDiagnostic[];
  mode: "db" | "live";
  lastIngestAt: string | null;
  refresh: () => void;
  refreshState: "idle" | "collecting" | "fresh";
}

// Exception to 50-line rule: 11 state variables + 2 refs + 4 callbacks + 3
// effects make further reduction below 50 counterproductive. Pure
// validation helpers (validateApiResponse, validateDbResponse,
// validateTickResponse) are already extracted above; remaining code is
// React state/effect wiring that must stay co-located with the hook.
export function useFeed(): UseFeedReturn {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [feedsAttempted, setFeedsAttempted] = useState(0);
  const [feedsSucceeded, setFeedsSucceeded] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [feedDiagnostics, setFeedDiagnostics] = useState<FeedDiagnostic[]>([]);
  const [mode, setMode] = useState<"db" | "live">("live");
  const [lastIngestAt, setLastIngestAt] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<"idle" | "collecting" | "fresh">("idle");
  const tickFiredRef = useRef(false);
  const refreshTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Tries the DB-backed read path first. Returns false (and warns) on a
  // 503 (no data yet), any other non-2xx, a malformed body, or a network
  // error — the caller then falls back to the live fetch path.
  const fetchFromDb = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/articles", { cache: "no-store" });
      if (!res.ok) {
        console.warn(`[useSources] /api/articles returned ${res.status}, falling back to live fetch`);
        return false;
      }
      const data = await res.json();
      const validated = validateDbResponse(data);
      if (!validated) {
        console.warn("[useSources] /api/articles response has unexpected shape, falling back to live fetch");
        return false;
      }
      setItems(validated.items);
      setFetchedAt(new Date().toISOString());
      setFeedsAttempted(0);
      setFeedsSucceeded(0);
      setTotalItems(validated.count);
      setFeedDiagnostics([]);
      setMode("db");
      setLastIngestAt(validated.lastIngestAt);
      return true;
    } catch (err) {
      console.warn("[useSources] /api/articles fetch failed, falling back to live fetch", err);
      return false;
    }
  }, []);

  const fetchFromLive = useCallback(async () => {
    const res = await fetch("/api/sources", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const validated = validateApiResponse(data);
    setItems(validated.items);
    setFetchedAt(validated.fetchedAt);
    setFeedsAttempted(validated.feedsAttempted);
    setFeedsSucceeded(validated.feedsSucceeded);
    setTotalItems(validated.count);
    setFeedDiagnostics(validated.feedDiagnostics);
    setMode("live");
    setLastIngestAt(null);
  }, []);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const usedDb = await fetchFromDb();
      if (!usedDb) await fetchFromLive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch feed");
    } finally {
      setLoading(false);
    }
  }, [fetchFromDb, fetchFromLive]);

  useEffect(() => {
    // Fire-and-forget: useEffect cannot return a promise. Errors handled inside fetchFeed.
    fetchFeed();
  }, [fetchFeed]);

  // Self-heals cron gaps: a DB-mode load reporting stale data pings the
  // tick endpoint once per page load, then re-fetches ~90s later so the
  // user sees fresh data without a manual reload.
  useEffect(() => {
    if (mode !== "db" || !lastIngestAt || tickFiredRef.current) return;
    const age = Date.now() - new Date(lastIngestAt).getTime();
    if (age < STALE_INGEST_MS) return;

    tickFiredRef.current = true;

    // Detached on purpose: a best-effort self-heal ping outside the render
    // path. Failure here isn't actionable beyond a warning — the next page
    // load (or the hourly cron) will try again.
    fetch("/api/tick", { method: "POST" }).catch((err) => {
      console.warn("[useSources] /api/tick trigger failed", err);
    });

    const timeoutId = setTimeout(fetchFeed, TICK_REFRESH_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [mode, lastIngestAt, fetchFeed]);

  // Clears any refetches scheduled by refresh() below on unmount — those
  // timers are set from a click handler, not an effect, so there's no
  // effect-return cleanup already covering them.
  useEffect(() => {
    return () => refreshTimeoutsRef.current.forEach(clearTimeout);
  }, []);

  // Fire-and-forget from the caller's perspective (a UI click handler can't
  // await); every path below handles its own errors, so there's nothing
  // left for a caller to catch. Live mode just re-fetches, unchanged from
  // before. Db mode makes the click actually trigger collection instead of
  // re-reading whatever the last cron run left behind.
  const refresh = useCallback(async () => {
    if (mode !== "db") {
      await fetchFeed();
      return;
    }

    refreshTimeoutsRef.current.forEach(clearTimeout);
    refreshTimeoutsRef.current = [];
    // Set before the request is sent: /api/tick?manual=1 only replies once
    // the server has finished the whole collection run (15-40s), so waiting
    // for the response to show "Collecting…" left the button looking dead
    // on every click.
    setRefreshState("collecting");

    try {
      const res = await fetch("/api/tick?manual=1", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tick = validateTickResponse(await res.json());
      if (!tick) throw new Error("malformed /api/tick response");
      refreshTimeoutsRef.current = await applyTickResult(tick, fetchFeed, setRefreshState);
    } catch (err) {
      console.warn("[useSources] /api/tick?manual=1 failed, falling back to a plain refetch", err);
      await fetchFeed();
      setRefreshState("idle");
    }
  }, [mode, fetchFeed]);

  return {
    items,
    loading,
    error,
    fetchedAt,
    feedsAttempted,
    feedsSucceeded,
    totalItems,
    feedDiagnostics,
    mode,
    lastIngestAt,
    refresh,
    refreshState,
  };
}
