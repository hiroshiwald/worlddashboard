import { SignalsTabTheme } from "@/hooks/useSignalsTab";

interface SignalsSummaryStripProps {
  signalCount: number;
  severityCounts: { critical: number; warning: number; advisory: number };
  mutedCount: number;
  entityCount: number;
  dark: boolean;
  onUnmuteAll: () => void;
  t: SignalsTabTheme;
}

export default function SignalsSummaryStrip({
  signalCount, severityCounts, mutedCount, entityCount, dark, onUnmuteAll, t,
}: SignalsSummaryStripProps) {
  return (
    <div className={`flex flex-wrap items-center gap-4 md:gap-6 px-4 md:px-5 py-3 mb-4 text-xs rounded-xl ${t.summaryBg} ${t.summaryText}`}>
      <span className="font-bold text-sm">{signalCount} Signals</span>
      {severityCounts.critical > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-red-500 font-semibold">{severityCounts.critical}</span> Critical
        </span>
      )}
      {severityCounts.warning > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-amber-500 font-semibold">{severityCounts.warning}</span> Warning
        </span>
      )}
      {severityCounts.advisory > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-yellow-500" />
          <span className="text-yellow-500 font-semibold">{severityCounts.advisory}</span> Advisory
        </span>
      )}
      {mutedCount > 0 && (
        <span className="flex items-center gap-1.5">
          <span className={t.textMuted}>{mutedCount} muted</span>
          <button
            onClick={onUnmuteAll}
            className={`text-xs underline ${dark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-700"}`}
          >
            Clear
          </button>
        </span>
      )}
      <span className={`ml-auto text-xs ${t.textMuted}`}>
        {entityCount} entities analyzed &middot; confidence &ge; 70%
      </span>
    </div>
  );
}
