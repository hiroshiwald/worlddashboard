"use client";

import { useEffect } from "react";
import { useIsAdmin } from "@/components/AdminContext";
import { isContext, type RowEntity } from "./feed-logic";
import { useEntityEvidence, type EntityGrowth } from "@/hooks/useNewsfeed";

export interface PopupActions {
  onClose: () => void;
  onTrack: (row: RowEntity) => void;
  onStopTracking: (row: RowEntity) => void;
  onNotInterested: (row: RowEntity) => void;
  onOpenMap: (entityId: string) => void;
}

interface PopupProps {
  row: RowEntity;
  growth: EntityGrowth | undefined;
  growthUnavailable: boolean;
  busy: boolean;
  dark: boolean;
  actions: PopupActions;
}

function stateText(growth: EntityGrowth | undefined, unavailable: boolean): string {
  if (growth === undefined) return unavailable ? "unavailable" : "no growth data yet";
  if (growth.state === "WarmingUp") return "warming up (fewer than 3 days of history)";
  const ratio = growth.state === "Steady" ? "" : ` ×${growth.ratioText}`;
  return `${growth.state}${ratio} · ${growth.mentions7d} mentions in 7 days · ${growth.sourcesLabel}`;
}

function Connection({ growth }: { growth: EntityGrowth | undefined }) {
  const near = growth?.nearestTracked ?? [];
  if (near.length === 0) return <p>No path to anything you track yet.</p>;
  return (
    <ul className="list-disc pl-4">
      {near.map((n) => (
        <li key={n.id}>{n.name} ({n.hops} {n.hops === 1 ? "hop" : "hops"})</li>
      ))}
    </ul>
  );
}

function Evidence({ entityId }: { entityId: string }) {
  const { articles, loading, error } = useEntityEvidence(entityId);
  if (loading) return <p>Loading…</p>;
  if (error !== null) return <p role="alert">Could not load articles: {error}</p>;
  if (articles.length === 0) return <p>No articles to show.</p>;
  return (
    <ul className="space-y-1">
      {articles.map((a) => (
        <li key={a.id}>
          <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{a.title}</a>
          <span className="opacity-70"> · {a.sourceName}</span>
        </li>
      ))}
    </ul>
  );
}

function Buttons({ row, busy, actions }: { row: RowEntity; busy: boolean; actions: PopupActions }) {
  const isAdmin = useIsAdmin();
  const base = "rounded-md border px-2.5 py-1 text-xs disabled:opacity-50";
  return (
    <div className="flex flex-wrap gap-2">
      {isAdmin && row.status === "tracked" && (
        <button type="button" disabled={busy} className={base} onClick={() => actions.onStopTracking(row)}>Stop tracking</button>
      )}
      {isAdmin && row.status !== "tracked" && (
        <button type="button" disabled={busy} className={`${base} border-blue-600 bg-blue-600 text-white`} onClick={() => actions.onTrack(row)}>
          Track
        </button>
      )}
      {isAdmin && row.status === "candidate" && row.entity !== null && (
        <button type="button" disabled={busy} className={base} onClick={() => actions.onNotInterested(row)}>Not interested</button>
      )}
      {row.entity !== null && /^\d+$/.test(row.entity.id) && (
        <button type="button" className={base} onClick={() => actions.onOpenMap(row.entity!.id)}>Open on map</button>
      )}
    </div>
  );
}

export default function EntityPopup({ row, growth, growthUnavailable, busy, dark, actions }: PopupProps) {
  const { onClose } = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const type = row.entity?.type ?? row.candidate?.typeHint ?? "";
  const surface = dark ? "bg-slate-900 border-slate-700 text-slate-200" : "bg-white border-gray-200 text-gray-800";
  const head = "text-[10px] font-semibold uppercase tracking-wider opacity-60";
  return (
    <div
      role="dialog"
      aria-label={`${row.name} details`}
      className={`fixed inset-x-0 bottom-0 z-30 max-h-[75vh] overflow-auto rounded-t-xl border p-4 text-sm shadow-2xl md:inset-x-auto md:bottom-6 md:right-6 md:w-[380px] md:rounded-xl ${surface}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{row.name}</h3>
          <p className="text-xs opacity-70">
            {type} · {row.status === "candidate" ? "not tracked" : row.status}
            {row.entity !== null && isContext(row.entity) && " · Context"}
          </p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="px-2 text-lg leading-none">×</button>
      </div>
      <div className="space-y-3">
        <section><h4 className={head}>Growth</h4><p>{stateText(growth, growthUnavailable)}</p></section>
        <section><h4 className={head}>Connection to what you track</h4><Connection growth={growth} /></section>
        {row.entity !== null && <section><h4 className={head}>Latest evidence</h4><Evidence entityId={row.entity.id} /></section>}
        {row.candidate !== null && <p>Named in {row.candidate.mentionCount} articles so far.</p>}
        <Buttons row={row} busy={busy} actions={actions} />
      </div>
    </div>
  );
}
