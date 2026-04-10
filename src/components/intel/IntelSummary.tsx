import { IntelTabTheme } from "@/hooks/useIntelTab";

interface IntelSummaryProps {
  entityCount: number;
  situationCount: number;
  knownCount: number;
  emergingCount: number;
  hasFewItems: boolean;
  noSituations: boolean;
  t: IntelTabTheme;
}

export default function IntelSummary({
  entityCount,
  situationCount,
  knownCount,
  emergingCount,
  hasFewItems,
  noSituations,
  t,
}: IntelSummaryProps) {
  return (
    <>
      <div className={`flex flex-wrap items-center gap-4 md:gap-6 px-4 md:px-5 py-3 mb-4 text-xs rounded-xl ${t.summaryBg} ${t.summaryText}`}>
        <span className="font-bold text-sm">{entityCount} Entities</span>
        <span>{situationCount} situations</span>
        <span>{knownCount} known</span>
        <span>{emergingCount} emerging</span>
      </div>

      {hasFewItems && noSituations && (
        <div className={`text-center py-8 text-sm ${t.textMuted}`}>
          Not enough data for situation clustering. Showing enriched entities below.
        </div>
      )}
    </>
  );
}
