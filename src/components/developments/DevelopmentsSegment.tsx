"use client";

import { useMemo, useState } from "react";
import { useDevelopmentsTab } from "@/hooks/useDevelopmentsTab";
import { BriefDevelopment } from "@/hooks/useBriefTab";
import DevelopmentCard from "./DevelopmentCard";
import LabelFilterBar, { LabelFilter } from "./LabelFilterBar";
import SortControl, { DevelopmentSort } from "./SortControl";
import DiagnosticsLine from "./DiagnosticsLine";

interface DevelopmentsSegmentProps {
  dark: boolean;
  onEntityClick: (name: string) => void;
}

function EmptyState({ dark, message }: { dark: boolean; message: string }) {
  return <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>{message}</p>;
}

// Mirrors the Signals segment's warm-up copy, in the language of this
// engine (reporting deviation from an entity's own normal, not detector
// firings) — the honest reason nothing qualifies is that baselines are
// still forming, not that the system found nothing.
function WarmupEmptyState({ dark, daysRemaining }: { dark: boolean; daysRemaining: number }) {
  const days = Math.max(1, Math.ceil(daysRemaining));
  return (
    <div className={`text-center py-12 text-sm max-w-md mx-auto ${dark ? "text-slate-400" : "text-gray-500"}`}>
      Developments compare reporting against each entity&apos;s own normal — and that
      takes time to learn. Baselines are still forming, so nothing qualifies yet.
      Check back in about {days} {days === 1 ? "day" : "days"}.
    </div>
  );
}

function byLabel(cards: BriefDevelopment[], filter: LabelFilter): BriefDevelopment[] {
  return filter === "all" ? cards : cards.filter((c) => c.label === filter);
}

function sorted(cards: BriefDevelopment[], sort: DevelopmentSort): BriefDevelopment[] {
  const arr = [...cards];
  if (sort === "newest") arr.sort((a, b) => new Date(b.firstObservedAt).getTime() - new Date(a.firstObservedAt).getTime());
  else arr.sort((a, b) => b.score - a.score);
  return arr;
}

// Opinionated defaults (label=All, sort=Score): a daily reader never needs
// to touch either control. Filters/sort run client-side over the already-
// fetched, already-uncapped set — view controls, not behavior settings.
export default function DevelopmentsSegment({ dark, onEntityClick }: DevelopmentsSegmentProps) {
  const { developments, diagnostics, warmup, loading, error, dbUnconfigured } = useDevelopmentsTab();
  const [labelFilter, setLabelFilter] = useState<LabelFilter>("all");
  const [sort, setSort] = useState<DevelopmentSort>("score");

  const shown = useMemo(() => sorted(byLabel(developments, labelFilter), sort), [developments, labelFilter, sort]);

  if (dbUnconfigured) return <EmptyState dark={dark} message="Developments require a configured database." />;
  if (error) {
    return (
      <div className={`border text-sm px-4 py-3 rounded-xl ${dark ? "bg-red-950 border-red-800 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
        {error}
      </div>
    );
  }
  if (loading && developments.length === 0) return <EmptyState dark={dark} message="Loading developments..." />;
  if (warmup?.active) return <WarmupEmptyState dark={dark} daysRemaining={warmup.daysRemaining} />;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <LabelFilterBar active={labelFilter} dark={dark} onChange={setLabelFilter} />
        <SortControl active={sort} dark={dark} onChange={setSort} />
      </div>

      {diagnostics && <DiagnosticsLine diagnostics={diagnostics} cardCount={developments.length} dark={dark} />}

      {shown.length === 0 ? (
        <EmptyState
          dark={dark}
          message={developments.length === 0 ? "No qualifying developments in the last 14 days." : "No developments match this filter."}
        />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {shown.map((card) => (
            <DevelopmentCard key={`${card.subjectName}-${card.firstObservedAt}`} card={card} dark={dark} onEntityClick={onEntityClick} />
          ))}
        </ul>
      )}
    </>
  );
}
