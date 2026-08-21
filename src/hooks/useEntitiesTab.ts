"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useBusyIds } from "./useBusyIds";
import {
  EntityRowData, EntityStats, EntityPatch, StatusFilter, FameFilter,
  ToastState, PageSizeOption, PAGE_SIZE_OPTIONS,
} from "@/components/entities/types";

const DEFAULT_PAGE_SIZE: PageSizeOption = PAGE_SIZE_OPTIONS[0];
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

function buildListQuery(q: string, status: StatusFilter, fame: FameFilter, offset: number, pageSize: number): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (status !== "all") params.set("status", status);
  if (fame !== "all") params.set("fame", fame);
  params.set("limit", String(pageSize));
  params.set("offset", String(offset));
  return params.toString();
}

interface FetchListResult {
  entities: EntityRowData[];
  total: number;
}

async function fetchEntitiesList(q: string, status: StatusFilter, fame: FameFilter, offset: number, pageSize: number): Promise<FetchListResult> {
  const res = await fetch(`/api/entities?${buildListQuery(q, status, fame, offset, pageSize)}`, { cache: "no-store" });
  if (res.status === 503) throw new DatabaseNotConfiguredError();
  if (!res.ok) throw new Error(`Failed to load entities (${res.status})`);
  const data = await res.json();
  return {
    entities: Array.isArray(data.entities) ? data.entities : [],
    total: typeof data.total === "number" ? data.total : 0,
  };
}

async function patchEntity(id: number, patch: EntityPatch): Promise<EntityRowData> {
  const res = await fetch(`/api/entities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.error === "string" ? data.error : `Update failed (${res.status})`);
  }
  // The PATCH response is the authoritative post-update row (server truth,
  // not optimistic state) — the live bug this hook exists to fix is that
  // callers used to discard it and wait for a manual refresh.
  return res.json();
}

function matchesActiveFilters(row: EntityRowData, status: StatusFilter, fame: FameFilter): boolean {
  if (status !== "all" && row.status !== status) return false;
  if (fame !== "all" && row.fame !== fame) return false;
  return true;
}

/** Consequence narration copy, decided per-task, keyed off the patch that
 * was actually sent — undoPatch is the inverse, built from the pre-action
 * snapshot. A patch outside this list (e.g. a type change) gets no toast. */
function describePatch(before: EntityRowData, patch: EntityPatch): { message: string; undoPatch: EntityPatch } | null {
  const name = before.canonicalName;
  if (patch.fame === "famous") {
    return {
      message: `${name} is now Established (locked — the automatic sweep won't change it). It can appear as context on cards, never as a subject.`,
      undoPatch: { fame: before.fame, fameLocked: before.fameLocked },
    };
  }
  if (patch.fame === "not_famous") {
    return {
      message: `${name} is now Emerging (locked). It can headline Developments cards.`,
      undoPatch: { fame: before.fame, fameLocked: before.fameLocked },
    };
  }
  if (patch.status === "dismissed") {
    return {
      message: `${name} dismissed — no longer tracked; future mentions are not collected. It stays in the database: filter Status: Dismissed to re-track.`,
      undoPatch: { status: before.status },
    };
  }
  if (patch.status === "tracked") {
    return { message: `${name} is tracked again.`, undoPatch: { status: before.status } };
  }
  if (patch.fameLocked === false) {
    return { message: `${name} unlocked — the automatic sweep may revise its status.`, undoPatch: { fameLocked: before.fameLocked } };
  }
  return null;
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
  const [pageSize, setPageSizeInternal] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);

  const [stats, setStats] = useState<EntityStats | null>(null);
  const [entities, setEntities] = useState<EntityRowData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Separate from `error`: a PATCH failure must stay visible until the user
  // dismisses it, not get silently wiped by the refetch's own setError(null)
  // a few lines below (operator feedback: errors must never auto-hide).
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
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
        fetchEntitiesList(debouncedQ, status, fame, offset, pageSize),
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
  }, [debouncedQ, status, fame, offset, pageSize]);

  useEffect(() => {
    // Fire-and-forget: load() owns its own try/catch and reports via state.
    load();
  }, [load]);

  const setQ = useCallback((next: string) => { setOffset(0); setQInternal(next); }, []);
  const setStatus = useCallback((next: StatusFilter) => { setOffset(0); setStatusInternal(next); }, []);
  const setFame = useCallback((next: FameFilter) => { setOffset(0); setFameInternal(next); }, []);
  const setPageSize = useCallback((next: PageSizeOption) => { setOffset(0); setPageSizeInternal(next); }, []);

  // Applies the PATCH response (server truth) to local state immediately,
  // instead of waiting for the follow-up refetch: replaces the row in
  // place, or — if it no longer matches the active filters — drops it from
  // the visible list and adjusts the visible total. A row not currently in
  // the list (e.g. an undo bringing a filtered-out row back) is left for
  // the refetch below to reinsert in its correct sorted/paged position.
  const applyServerUpdate = useCallback((updated: EntityRowData) => {
    setEntities((prev) => {
      const idx = prev.findIndex((e) => e.id === updated.id);
      if (idx === -1) return prev;
      if (!matchesActiveFilters(updated, status, fame)) {
        setTotal((t) => Math.max(0, t - 1));
        return prev.filter((e) => e.id !== updated.id);
      }
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  }, [status, fame]);

  // Fails loud, never silently reverts: a PATCH failure still refetches so
  // the table always reflects the server's real current state. The failure
  // message itself lives in actionError, untouched by load()'s own error
  // handling, so it survives that refetch instead of vanishing with it.
  // `silent` skips the toast — used for the undo action itself, since
  // one-level undo needs no toast chain of its own.
  const updateEntity = useCallback(
    (id: number, patch: EntityPatch, opts?: { silent?: boolean }) =>
      withBusy(id, async () => {
        setActionError(null);
        const before = entities.find((e) => e.id === id) ?? null;
        try {
          const updated = await patchEntity(id, patch);
          applyServerUpdate(updated);
          if (before && !opts?.silent) {
            const description = describePatch(before, patch);
            if (description) {
              setToast({
                message: description.message,
                onUndo: () => updateEntity(id, description.undoPatch, { silent: true }),
              });
            }
          }
        } catch (e) {
          setActionError(e instanceof Error ? e.message : "Update failed");
        } finally {
          await load();
        }
      }),
    [load, withBusy, entities, applyServerUpdate],
  );

  const dismissErrors = useCallback(() => {
    setError(null);
    setActionError(null);
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const hasPrev = offset > 0;
  const hasNext = offset + entities.length < total;
  const goPrev = useCallback(() => setOffset((o) => Math.max(0, o - pageSize)), [pageSize]);
  const goNext = useCallback(() => setOffset((o) => o + pageSize), [pageSize]);

  return {
    q, setQ, status, setStatus, fame, setFame,
    stats, entities, total, loading, error, actionError, dismissErrors, dbUnconfigured,
    toast, dismissToast,
    busyIds, updateEntity,
    offset, pageSize, setPageSize, hasPrev, hasNext, goPrev, goNext,
  };
}
