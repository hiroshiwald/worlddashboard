import { EnrichedEntity } from "@/lib/types";
import { SignalsTabTheme } from "@/hooks/useSignalsTab";
import { SentimentBadge } from "./utils";

interface WatchlistCardProps {
  entity: EnrichedEntity;
  bins: number[];
  dark: boolean;
  onEntityClick: (name: string) => void;
  t: SignalsTabTheme;
}

export default function WatchlistCard({ entity, bins, dark, onEntityClick, t }: WatchlistCardProps) {
  const maxBin = Math.max(1, ...bins);

  return (
    <div className={`border rounded-xl px-4 py-3 ${t.cardBg}`}>
      {/* Name + sentiment */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => onEntityClick(entity.name)}
          className={`text-sm font-semibold cursor-pointer hover:underline ${t.entityName}`}
        >
          {entity.name}
        </button>
        <SentimentBadge value={entity.sentiment} dark={dark} />
      </div>

      {/* Sparkline: 24 bars */}
      <div className="flex items-end gap-px h-8 mb-2">
        {bins.map((count, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t-sm ${count > 0 ? t.sparkBarActive : t.sparkBarEmpty}`}
            style={{ height: `${Math.max(2, (count / maxBin) * 100)}%` }}
            title={`${24 - i}h ago: ${count} mentions`}
          />
        ))}
      </div>

      {/* Stats */}
      <div className={`text-[10px] ${t.textMuted}`}>
        {entity.recentMentions.day} 24h &middot; {entity.recentMentions.hour} 1h &middot; {entity.sourceCount} sources
      </div>
    </div>
  );
}
