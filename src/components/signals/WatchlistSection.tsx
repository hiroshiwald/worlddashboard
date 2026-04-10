import { EnrichedEntity } from "@/lib/types";
import { SignalsTabTheme } from "@/hooks/useSignalsTab";
import WatchlistCard from "./WatchlistCard";

interface WatchlistSectionProps {
  topEntities: EnrichedEntity[];
  sparklineData: Map<string, number[]>;
  dark: boolean;
  onEntityClick: (name: string) => void;
  t: SignalsTabTheme;
}

export default function WatchlistSection({
  topEntities, sparklineData, dark, onEntityClick, t,
}: WatchlistSectionProps) {
  if (topEntities.length === 0) return null;

  return (
    <>
      <div className={`flex items-center gap-3 px-4 md:px-5 py-3 mt-4 mb-3 text-xs font-bold rounded-xl ${t.summaryBg} ${t.summaryText}`}>
        Watchlist — Top {topEntities.length}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {topEntities.map((entity) => (
          <WatchlistCard
            key={entity.name}
            entity={entity}
            bins={sparklineData.get(entity.name) || new Array(24).fill(0)}
            dark={dark}
            onEntityClick={onEntityClick}
            t={t}
          />
        ))}
      </div>
    </>
  );
}
