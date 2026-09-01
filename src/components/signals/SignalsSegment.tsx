"use client";

import { useMemo, useState } from "react";
import { useSignalsTab } from "@/hooks/useSignalsTab";
import StateFilterBar from "./StateFilterBar";
import SeverityFilterBar, { SeverityFilter } from "./SeverityFilterBar";
import TypeFilterBar, { TypeFilter } from "./TypeFilterBar";
import ManagedSignalGrid from "./ManagedSignalGrid";
import { SignalCardData } from "./types";

interface SignalsSegmentProps {
  dark: boolean;
  onEntityClick: (name: string) => void;
}

function EmptyState({ dark, message }: { dark: boolean; message: string }) {
  return <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>{message}</p>;
}

// Shown instead of the generic "No signals in this view" only while warm-up
// is active and nothing has fired yet — the honest reason is that baselines
// are still forming, not that the system is broken or has found nothing.
function WarmupEmptyState({ dark, daysRemaining }: { dark: boolean; daysRemaining: number }) {
  const days = Math.max(1, Math.ceil(daysRemaining));
  return (
    <div className={`text-center py-12 text-sm max-w-md mx-auto ${dark ? "text-slate-400" : "text-gray-500"}`}>
      Detectors compare each entity against its own normal — and that takes time to
      learn. Baselines are still forming, so nothing has fired yet. Check back in
      about {days} {days === 1 ? "day" : "days"}.
    </div>
  );
}

function bySeverityAndType(signals: SignalCardData[], severity: SeverityFilter, type: TypeFilter): SignalCardData[] {
  return signals.filter((s) => (severity === "all" || s.severity === severity) && (type === "all" || s.type === type));
}

export default function SignalsSegment({ dark, onEntityClick }: SignalsSegmentProps) {
  const {
    visibleSignals, stateCounts, stateFilter, setStateFilter,
    loading, error, dbUnconfigured, busyIds, act, warmup,
  } = useSignalsTab({ dark, onEntityClick });
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const shownSignals = useMemo(
    () => bySeverityAndType(visibleSignals, severityFilter, typeFilter),
    [visibleSignals, severityFilter, typeFilter],
  );
  const showWarmupEmpty = warmup !== null && warmup.active && stateCounts.all === 0;

  return (
    <>
      {dbUnconfigured && <EmptyState dark={dark} message="Signal management requires a configured database." />}

      {!dbUnconfigured && error && (
        <div className={`mb-4 border text-sm px-4 py-3 rounded-xl ${dark ? "bg-red-950 border-red-800 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          {error}
        </div>
      )}

      {!dbUnconfigured && loading && stateCounts.all === 0 && !error && (
        <EmptyState dark={dark} message="Loading signals..." />
      )}

      {!dbUnconfigured && !loading && showWarmupEmpty && (
        <WarmupEmptyState dark={dark} daysRemaining={warmup?.daysRemaining ?? 0} />
      )}

      {!dbUnconfigured && !loading && !showWarmupEmpty && (
        <>
          <StateFilterBar counts={stateCounts} active={stateFilter} dark={dark} onChange={setStateFilter} />
          <SeverityFilterBar active={severityFilter} dark={dark} onChange={setSeverityFilter} />
          <TypeFilterBar active={typeFilter} dark={dark} onChange={setTypeFilter} />
          <ManagedSignalGrid signals={shownSignals} busyIds={busyIds} dark={dark} onAction={act} onEntityClick={onEntityClick} />
        </>
      )}
    </>
  );
}
