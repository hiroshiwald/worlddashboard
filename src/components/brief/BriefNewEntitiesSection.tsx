"use client";

import { BriefNewEntity } from "@/hooks/useBriefTab";
import { timeAgo } from "@/lib/date-utils";

interface BriefNewEntitiesSectionProps {
  entities: BriefNewEntity[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

export default function BriefNewEntitiesSection({ entities, dark, onEntityClick }: BriefNewEntitiesSectionProps) {
  if (entities.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className={`text-xs font-bold uppercase tracking-wide mb-2 ${dark ? "text-slate-400" : "text-gray-500"}`}>
        New entities
      </h3>
      <div className="flex flex-wrap gap-2">
        {entities.map((entity) => (
          <button
            key={entity.id}
            onClick={() => onEntityClick(entity.canonicalName)}
            className={`text-xs px-3 py-1.5 rounded-full border ${dark ? "bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"}`}
          >
            <span className="font-semibold">{entity.canonicalName}</span>
            <span className={dark ? "text-slate-500" : "text-gray-400"}>
              {" "}&middot; {entity.sourceCount} sources &middot; {timeAgo(entity.firstSeenAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
