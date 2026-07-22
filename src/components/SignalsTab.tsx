"use client";

import { useSignalsTab } from "@/hooks/useSignalsTab";
import { StateFilterBar, ManagedSignalGrid } from "./signals";

interface SignalsTabProps {
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

export default function SignalsTab({ dark, onEntityClick }: SignalsTabProps) {
  const {
    visibleSignals, stateCounts, stateFilter, setStateFilter,
    loading, error, dbUnconfigured, busyIds, act, warmup,
  } = useSignalsTab({ dark, onEntityClick });

  const showWarmupEmpty = warmup !== null && warmup.active && stateCounts.all === 0;

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
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
          <ManagedSignalGrid signals={visibleSignals} busyIds={busyIds} dark={dark} onAction={act} onEntityClick={onEntityClick} />
        </>
      )}
    </div>
  );
}
