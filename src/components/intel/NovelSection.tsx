import { Situation, EnrichedEntity } from "@/lib/types";
import { IntelTabTheme } from "@/hooks/useIntelTab";
import SituationCard from "./SituationCard";
import EntityCard from "./EntityCard";

interface NovelSectionProps {
  novelSituations: Situation[];
  visibleNovel: Situation[];
  standaloneNovelEntities: EnrichedEntity[];
  showAllNovel: boolean;
  setShowAllNovel: (v: boolean) => void;
  novelLimit: number;
  dark: boolean;
  onEntityClick: (name: string) => void;
  t: IntelTabTheme;
}

export default function NovelSection({
  novelSituations,
  visibleNovel,
  standaloneNovelEntities,
  showAllNovel,
  setShowAllNovel,
  novelLimit,
  dark,
  onEntityClick,
  t,
}: NovelSectionProps) {
  if (novelSituations.length === 0 && standaloneNovelEntities.length === 0) return null;

  return (
    <div>
      <h3 className={`text-xs font-bold uppercase tracking-wider mb-3 px-1 ${t.sectionLabel}`}>
        Emerging &amp; Novel
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {visibleNovel.map((sit) => (
          <SituationCard
            key={sit.id}
            situation={sit}
            dark={dark}
            t={t}
            onEntityClick={onEntityClick}
          />
        ))}

        {standaloneNovelEntities.slice(0, showAllNovel ? undefined : Math.max(0, novelLimit - novelSituations.length)).map((entity) => (
          <EntityCard
            key={entity.name}
            entity={entity}
            dark={dark}
            t={t}
            onEntityClick={onEntityClick}
          />
        ))}
      </div>

      {(novelSituations.length > novelLimit || standaloneNovelEntities.length > novelLimit - novelSituations.length) && (
        <button
          onClick={() => setShowAllNovel(!showAllNovel)}
          className={`w-full text-center py-2 mt-2 text-xs font-medium rounded-lg transition-colors ${dark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100"}`}
        >
          {showAllNovel ? "Show Less" : "Show All"}
        </button>
      )}
    </div>
  );
}
