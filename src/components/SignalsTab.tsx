"use client";

import { FeedItem } from "@/lib/types";
import { useSignalsTab } from "@/hooks/useSignalsTab";
import { SignalsSummaryStrip, SignalCardGrid, WatchlistSection } from "./signals";

interface SignalsTabProps {
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

export default function SignalsTab({ items, dark, onEntityClick }: SignalsTabProps) {
  const {
    entities, activeSignals, visibleSignals, severityCounts,
    topEntities, sparklineData, entitySituationMap, getEvidenceArticles,
    mutedCount, handleMute, handleUnmuteAll,
    showAll, setShowAll, initialLimit, totalSignalCount, t,
  } = useSignalsTab({ items, dark, onEntityClick });

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      <SignalsSummaryStrip
        signalCount={activeSignals.length}
        severityCounts={severityCounts}
        mutedCount={mutedCount}
        entityCount={entities.length}
        dark={dark}
        onUnmuteAll={handleUnmuteAll}
        t={t}
      />

      <SignalCardGrid
        visibleSignals={visibleSignals}
        totalSignalCount={totalSignalCount}
        initialLimit={initialLimit}
        showAll={showAll}
        setShowAll={setShowAll}
        mutedCount={mutedCount}
        dark={dark}
        onEntityClick={onEntityClick}
        onMute={handleMute}
        getEvidenceArticles={getEvidenceArticles}
        entitySituationMap={entitySituationMap}
        t={t}
      />

      <WatchlistSection
        topEntities={topEntities}
        sparklineData={sparklineData}
        dark={dark}
        onEntityClick={onEntityClick}
        t={t}
      />
    </div>
  );
}
