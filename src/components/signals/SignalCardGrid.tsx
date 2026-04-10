import { Signal, FeedItem } from "@/lib/types";
import { SignalsTabTheme } from "@/hooks/useSignalsTab";
import SignalCard from "./SignalCard";

interface SignalCardGridProps {
  visibleSignals: Signal[];
  totalSignalCount: number;
  initialLimit: number;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
  mutedCount: number;
  dark: boolean;
  onEntityClick: (name: string) => void;
  onMute: (name: string) => void;
  getEvidenceArticles: (signal: Signal) => FeedItem[];
  entitySituationMap: Map<string, string>;
  t: SignalsTabTheme;
}

export default function SignalCardGrid({
  visibleSignals, totalSignalCount, initialLimit, showAll, setShowAll,
  mutedCount, dark, onEntityClick, onMute, getEvidenceArticles, entitySituationMap, t,
}: SignalCardGridProps) {
  if (totalSignalCount === 0) {
    return (
      <div className={`text-center py-12 text-sm ${t.textMuted}`}>
        {mutedCount > 0
          ? "All signals muted — clear mutes to view"
          : "No high-confidence signals detected"}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
        {visibleSignals.map((signal) => {
          const evidence = getEvidenceArticles(signal);
          const relatedSituation = signal.entities
            .map((e) => entitySituationMap.get(e))
            .find(Boolean);

          return (
            <SignalCard
              key={signal.id}
              signal={signal}
              evidence={evidence}
              relatedSituation={relatedSituation}
              dark={dark}
              onEntityClick={onEntityClick}
              onMute={onMute}
              t={t}
            />
          );
        })}
      </div>

      {totalSignalCount > initialLimit && (
        <button
          onClick={() => setShowAll(!showAll)}
          className={`w-full text-center py-2 text-xs font-medium rounded-lg transition-colors ${dark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100"}`}
        >
          {showAll ? "Show Less" : `Show All ${totalSignalCount} Signals`}
        </button>
      )}
    </>
  );
}
