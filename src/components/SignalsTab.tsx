"use client";

import { FeedItem } from "@/lib/types";
import { useSignalsTab } from "@/hooks/useSignalsTab";
import { StateFilterBar, ManagedSignalGrid, WatchlistSection } from "./signals";

interface SignalsTabProps {
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

function EmptyState({ dark, message }: { dark: boolean; message: string }) {
  return <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>{message}</p>;
}

export default function SignalsTab({ items, dark, onEntityClick }: SignalsTabProps) {
  const {
    topEntities, sparklineData, visibleSignals, stateCounts, stateFilter, setStateFilter,
    loading, error, dbUnconfigured, busyIds, act, t,
  } = useSignalsTab({ items, dark, onEntityClick });

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

      {!dbUnconfigured && !loading && (
        <>
          <StateFilterBar counts={stateCounts} active={stateFilter} dark={dark} onChange={setStateFilter} />
          <ManagedSignalGrid signals={visibleSignals} busyIds={busyIds} dark={dark} onAction={act} onEntityClick={onEntityClick} />
        </>
      )}

      <WatchlistSection topEntities={topEntities} sparklineData={sparklineData} dark={dark} onEntityClick={onEntityClick} t={t} />
    </div>
  );
}
