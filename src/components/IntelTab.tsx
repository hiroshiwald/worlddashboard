"use client";

import { FeedItem } from "@/lib/types";
import { useIntelTab } from "@/hooks/useIntelTab";
import { IntelSummary, KnownSituationsSection, NovelSection } from "./intel";

interface IntelTabProps {
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

export default function IntelTab({ items, dark, onEntityClick }: IntelTabProps) {
  const {
    enriched, situations, knownSituations, novelSituations,
    standaloneNovelEntities, visibleKnown, visibleNovel,
    expandedSituations, toggleSituation,
    showAllKnown, setShowAllKnown, showAllNovel, setShowAllNovel,
    knownLimit, novelLimit, hasFewItems, t,
  } = useIntelTab({ items, dark, onEntityClick });

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      <IntelSummary
        entityCount={enriched.length}
        situationCount={situations.length}
        knownCount={knownSituations.length}
        emergingCount={novelSituations.length + standaloneNovelEntities.length}
        hasFewItems={hasFewItems}
        noSituations={situations.length === 0}
        t={t}
      />

      <KnownSituationsSection
        knownSituations={knownSituations}
        visibleKnown={visibleKnown}
        expandedSituations={expandedSituations}
        toggleSituation={toggleSituation}
        showAllKnown={showAllKnown}
        setShowAllKnown={setShowAllKnown}
        knownLimit={knownLimit}
        dark={dark}
        t={t}
      />

      <NovelSection
        novelSituations={novelSituations}
        visibleNovel={visibleNovel}
        standaloneNovelEntities={standaloneNovelEntities}
        showAllNovel={showAllNovel}
        setShowAllNovel={setShowAllNovel}
        novelLimit={novelLimit}
        dark={dark}
        onEntityClick={onEntityClick}
        t={t}
      />

      {enriched.length === 0 && (
        <div className={`text-center py-12 text-sm ${t.textMuted}`}>
          No entities with 2+ mentions
        </div>
      )}
    </div>
  );
}
