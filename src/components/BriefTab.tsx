"use client";

import { useBriefTab } from "@/hooks/useBriefTab";
import { BriefDevelopmentsSection, BriefSignalsSection, BriefNewEntitiesSection, BriefTopStoriesSection, BriefMoversSection } from "./brief";
import { timeAgo } from "@/lib/date-utils";

interface BriefTabProps {
  dark: boolean;
  onEntityClick: (name: string) => void;
}

function EmptyState({ dark, message }: { dark: boolean; message: string }) {
  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-20 text-center">
      <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>{message}</p>
    </div>
  );
}

// Honest time (DESIGN.md spine #4): a missing or unparsable generatedAt
// renders nothing rather than a "NaN ago" lie.
function GeneratedAt({ generatedAt, dark }: { generatedAt: string; dark: boolean }) {
  const date = new Date(generatedAt);
  if (isNaN(date.getTime())) return null;
  const age = timeAgo(generatedAt);
  const text = age === "NOW" ? "Generated just now" : `Generated ${age} ago`;
  return (
    <p title={date.toLocaleString()} className={`text-[11px] mb-3 ${dark ? "text-slate-500" : "text-gray-400"}`}>
      {text}
    </p>
  );
}

export default function BriefTab({ dark, onEntityClick }: BriefTabProps) {
  const { data, loading, error, dbUnconfigured, busyIds, act } = useBriefTab();

  if (dbUnconfigured) return <EmptyState dark={dark} message="The daily brief requires a configured database." />;
  if (error) return <EmptyState dark={dark} message={`Couldn't load the brief: ${error}`} />;
  if (loading && !data) return <EmptyState dark={dark} message="Loading brief..." />;
  if (!data) return null;

  const isEmpty =
    data.developments.length === 0 &&
    data.movers.length === 0 &&
    data.signals.length === 0 &&
    data.newEntities.length === 0 &&
    data.topStories.length === 0;
  if (isEmpty) return <EmptyState dark={dark} message="All quiet — nothing to report since the last check." />;

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      <GeneratedAt generatedAt={data.generatedAt} dark={dark} />
      <BriefDevelopmentsSection developments={data.developments} warmup={data.warmup} dark={dark} onEntityClick={onEntityClick} />
      <BriefMoversSection movers={data.movers} warmup={data.warmup} dark={dark} onEntityClick={onEntityClick} />
      <BriefSignalsSection signals={data.signals} busyIds={busyIds} dark={dark} onAction={act} onEntityClick={onEntityClick} />
      <BriefNewEntitiesSection entities={data.newEntities} dark={dark} onEntityClick={onEntityClick} />
      <BriefTopStoriesSection stories={data.topStories} dark={dark} />
    </div>
  );
}
