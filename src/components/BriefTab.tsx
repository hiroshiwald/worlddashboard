"use client";

import { useBriefTab } from "@/hooks/useBriefTab";
import { BriefSignalsSection, BriefNewEntitiesSection, BriefTopStoriesSection } from "./brief";

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

export default function BriefTab({ dark, onEntityClick }: BriefTabProps) {
  const { data, loading, error, dbUnconfigured, busyId, act } = useBriefTab();

  if (dbUnconfigured) return <EmptyState dark={dark} message="The daily brief requires a configured database." />;
  if (error) return <EmptyState dark={dark} message={`Couldn't load the brief: ${error}`} />;
  if (loading && !data) return <EmptyState dark={dark} message="Loading brief..." />;
  if (!data) return null;

  const isEmpty = data.signals.length === 0 && data.newEntities.length === 0 && data.topStories.length === 0;
  if (isEmpty) return <EmptyState dark={dark} message="All quiet — nothing to report since the last check." />;

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      <BriefSignalsSection signals={data.signals} busyId={busyId} dark={dark} onAction={act} onEntityClick={onEntityClick} />
      <BriefNewEntitiesSection entities={data.newEntities} dark={dark} onEntityClick={onEntityClick} />
      <BriefTopStoriesSection stories={data.topStories} dark={dark} />
    </div>
  );
}
