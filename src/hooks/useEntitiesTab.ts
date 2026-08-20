"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useBusyIds } from "./useBusyIds";
import {
  EntityRowData, EntityStats, EntityPatch, StatusFilter, FameFilter,
} from "@/components/entities/types";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

// Distinguishes "no database configured yet" from a genuine fetch/shape
// failure — same convention as ReviewTab/useSignalsTab.
class DatabaseNotConfiguredError extends Error {}

async function fetchStats(): Promise<EntityStats> {
  const res = await fetch("/api/entities?view=stats", { cache: "no-store" });
  if (res.status === 503) throw new DatabaseNotConfiguredError();
  if (!res.ok) throw new Error(`Failed to load entity stats (${res.status})`);
  return res.json();
}

function buildListQuery(q: string, status: StatusFilter, fame: FameFilter, offset: number): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (status !== "all") params.set("status", status);
  if (fame !== "all") params.set("fame", fame);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  return params.toString();
}

interface FetchListResult {
  entities: EntityRowData[];
  total: number;
}

async function fetchEntitiesList(q: string, status: StatusFilter, fame: FameFilter, offset: number): Promise<FetchListResult> {
  const res = await fetch(`/api/entities?${buildListQuery(q, status, fame, offset)}`, { cache: "no-store" });
  if (res.status === 503) throw new DatabaseNotConfiguredError();
  if (!res.ok) throw new Error(`Failed to load entities (${res.status})`);
  const data = await res.json();
  return {
    entities: Array.isArray(data.entities) ? data.entities : [],
    total: typeof data.total === "number" ? data.total : 0,
  };
}

async function patchEntity(id: number, patch: EntityPatch): Promise<void> {
  const res = await fetch(`/api/entities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.error === "string" ? data.error : `Update failed (${res.status})`);
  }
}

// Exception to 50-line rule: search/filter/pagination/PATCH state for the
// Entities tab is tightly coupled — the debounced query, the two filters,
// and offset all drive the same load()'s sequence guard, and PATCH shares
// its busyIds/error handling with that same load(). Splitting would scatter
// one hook's state across files without improving readability (same
// rationale useSignalsTab.ts already documents).
export function useEntitiesTab() {
  const [q, setQInternal] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatusInternal] = useState<StatusFilter>("tracked");
  const [fame, setFameInternal] = useState<FameFilter>("all");
  const [offset, setOffset] = useState(0);

  const [stats, setStats] = useState<EntityStats | null>(null);
  const [entities, setEntities] = useState<EntityRowData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Separate from `error`: a PATCH failure must stay visible until the user
  // dismisses it, not get silently wiped by the refetch's own setError(null)
  // a few lines below (operator feedback: errors must never auto-hide).
  const [actionError, setActionError] = useState<string | null>(null);
  const [dbUnconfigured, setDbUnconfigured] = useState(false);
  const { busyIds, withBusy } = useBusyIds();
  const loadSeq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Guards against an in-flight load's response landing after a newer one
  // was started (a filter change firing while a PATCH refetch is pending)
  // and overwriting fresher data with stale data.
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    setDbUnconfigured(false);
    try {
      const [statsResult, listResult] = await Promise.all([
        fetchStats(),
        fetchEntitiesList(debouncedQ, status, fame, offset),
      ]);
      if (seq !== loadSeq.current) return;
      setStats(statsResult);
      setEntities(listResult.entities);
      setTotal(listResult.total);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      if (e instanceof DatabaseNotConfiguredError) setDbUnconfigured(true);
      else setError(e instanceof Error ? e.message : "Failed to load entities");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [debouncedQ, status, fame, offset]);

  useEffect(() => {
    // Fire-and-forget: load() owns its own try/catch and reports via state.
    load();
  }, [load]);

  const setQ = useCallback((next: string) => { setOffset(0); setQInternal(next); }, []);
  const setStatus = useCallback((next: StatusFilter) => { setOffset(0); setStatusInternal(next); }, []);
  const setFame = useCallback((next: FameFilter) => { setOffset(0); setFameInternal(next); }, []);

  // Fails loud, never silently reverts: a PATCH failure still refetches so
  // the table always reflects the server's real current state. The failure
  // message itself lives in actionError, untouched by load()'s own error
  // handling, so it survives that refetch instead of vanishing with it.
  const updateEntity = useCallback(
    (id: number, patch: EntityPatch) =>
      withBusy(id, async () => {
        setActionError(null);
        try {
          await patchEntity(id, patch);
        } catch (e) {
          setActionError(e instanceof Error ? e.message : "Update failed");
        } finally {
          await load();
        }
      }),
    [load, withBusy],
  );

  const dismissErrors = useCallback(() => {
    setError(null);
    setActionError(null);
  }, []);

  const hasPrev = offset > 0;
  const hasNext = offset + entities.length < total;
  const goPrev = useCallback(() => setOffset((o) => Math.max(0, o - PAGE_SIZE)), []);
  const goNext = useCallback(() => setOffset((o) => o + PAGE_SIZE), []);

  return {
    q, setQ, status, setStatus, fame, setFame,
    stats, entities, total, loading, error, actionError, dismissErrors, dbUnconfigured,
    busyIds, updateEntity,
    offset, pageSize: PAGE_SIZE, hasPrev, hasNext, goPrev, goNext,
  };
}
