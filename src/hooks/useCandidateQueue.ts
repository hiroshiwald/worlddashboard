"use client";

import { useState, useEffect, useCallback } from "react";
import { CandidateRowData, BulkItemResult, ENTITY_TYPES } from "@/components/entities/types";

const PAGE_SIZE = 100;

// Same convention as useEntitiesTab/ReviewTab: distinguishes "no database
// configured yet" from a genuine fetch/shape failure.
class DatabaseNotConfiguredError extends Error {}

async function fetchCandidates(): Promise<CandidateRowData[]> {
  const res = await fetch("/api/candidates", { cache: "no-store" });
  if (res.status === 503) throw new DatabaseNotConfiguredError();
  if (!res.ok) throw new Error(`Failed to load candidates (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data.candidates)) throw new Error("Malformed candidates response");
  return data.candidates;
}

async function postCandidateAction(nameNorm: string, action: string, extra: Record<string, string> = {}): Promise<void> {
  const res = await fetch("/api/candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nameNorm, action, ...extra }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.error === "string" ? data.error : `Action failed (${res.status})`);
  }
}

async function postBulkAction(action: "accept" | "dismiss", items: { nameNorm: string; type?: string }[]): Promise<BulkItemResult[]> {
  const res = await fetch("/api/candidates/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, items }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.error === "string" ? data.error : `Bulk action failed (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

function resolveRowType(overrides: Record<string, string>, nameNorm: string, typeHint: string): string {
  const override = overrides[nameNorm];
  if (override) return override;
  return ENTITY_TYPES.includes(typeHint) ? typeHint : "other";
}

// Exception to the 50-line rule (same rationale useEntitiesTab.ts already
// documents): fetch/pagination/selection/per-row-type/bulk-action state for
// the candidate queue is tightly coupled through one load() and one
// selection set. Pure helpers are already extracted above.
export function useCandidateQueue(onCountChange: (count: number) => void) {
  const [candidates, setCandidates] = useState<CandidateRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [bulkErrors, setBulkErrors] = useState<BulkItemResult[]>([]);
  const [dbUnconfigured, setDbUnconfigured] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowTypeOverrides, setRowTypeOverrides] = useState<Record<string, string>>({});
  const [busyNorms, setBusyNorms] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDbUnconfigured(false);
    try {
      const list = await fetchCandidates();
      setCandidates(list);
      onCountChange(list.length);
    } catch (e) {
      onCountChange(0);
      if (e instanceof DatabaseNotConfiguredError) setDbUnconfigured(true);
      else setError(e instanceof Error ? e.message : "Failed to load candidates");
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    // Fire-and-forget: load() owns its own try/catch and reports via state.
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const offset = clampedPage * PAGE_SIZE;
  const pageItems = candidates.slice(offset, offset + PAGE_SIZE);
  const hasPrev = clampedPage > 0;
  const hasNext = offset + pageItems.length < candidates.length;
  const isAllPageSelected = pageItems.length > 0 && pageItems.every((c) => selected.has(c.nameNorm));

  const goPrev = useCallback(() => { setSelected(new Set()); setPage(Math.max(0, clampedPage - 1)); }, [clampedPage]);
  const goNext = useCallback(() => { setSelected(new Set()); setPage(clampedPage + 1); }, [clampedPage]);

  const toggleSelect = useCallback((nameNorm: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nameNorm)) next.delete(nameNorm); else next.add(nameNorm);
      return next;
    });
  }, []);

  const toggleSelectAllOnPage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (isAllPageSelected) pageItems.forEach((c) => next.delete(c.nameNorm));
      else pageItems.forEach((c) => next.add(c.nameNorm));
      return next;
    });
  }, [isAllPageSelected, pageItems]);

  const setRowType = useCallback((nameNorm: string, type: string) => {
    setRowTypeOverrides((prev) => ({ ...prev, [nameNorm]: type }));
  }, []);
  const getRowType = useCallback((nameNorm: string, typeHint: string) => resolveRowType(rowTypeOverrides, nameNorm, typeHint), [rowTypeOverrides]);

  // Fails loud, never silently reverts: same fail-loud-and-refetch contract
  // as useEntitiesTab's updateEntity.
  const runRowAction = useCallback(async (nameNorm: string, action: string, extra?: Record<string, string>) => {
    setBusyNorms((prev) => new Set(prev).add(nameNorm));
    setActionError(null);
    try {
      await postCandidateAction(nameNorm, action, extra);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyNorms((prev) => { const next = new Set(prev); next.delete(nameNorm); return next; });
      await load();
    }
  }, [load]);

  const acceptOne = useCallback((nameNorm: string, type: string) => runRowAction(nameNorm, "accept", { type }), [runRowAction]);
  const mergeOne = useCallback((nameNorm: string, mergeInto: string) => runRowAction(nameNorm, "merge", { mergeInto }), [runRowAction]);
  const dismissOne = useCallback((nameNorm: string) => runRowAction(nameNorm, "dismiss"), [runRowAction]);

  // Bulk failures render loudly (per-item, via bulkErrors) rather than
  // aborting the batch — succeeded items simply leave the list on refetch.
  const runBulkAction = useCallback(async (action: "accept" | "dismiss") => {
    const items = Array.from(selected).map((nameNorm) => {
      const candidate = candidates.find((c) => c.nameNorm === nameNorm);
      const type = action === "accept" ? getRowType(nameNorm, candidate?.typeHint ?? "other") : undefined;
      return { nameNorm, type };
    });
    if (items.length === 0) return;
    setBulkBusy(true);
    setBulkErrors([]);
    try {
      const results = await postBulkAction(action, items);
      setBulkErrors(results.filter((r) => !r.ok));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Bulk action failed");
    } finally {
      setBulkBusy(false);
      setSelected(new Set());
      await load();
    }
  }, [selected, candidates, getRowType, load]);

  const bulkAccept = useCallback(() => runBulkAction("accept"), [runBulkAction]);
  const bulkDismiss = useCallback(() => runBulkAction("dismiss"), [runBulkAction]);

  const dismissErrors = useCallback(() => {
    setError(null);
    setActionError(null);
    setBulkErrors([]);
  }, []);

  return {
    loading, error, actionError, bulkErrors, dbUnconfigured, dismissErrors,
    total: candidates.length, pageItems, offset, hasPrev, hasNext, goPrev, goNext,
    selected, toggleSelect, isAllPageSelected, toggleSelectAllOnPage,
    getRowType, setRowType, busyNorms, bulkBusy,
    acceptOne, mergeOne, dismissOne, bulkAccept, bulkDismiss,
  };
}
