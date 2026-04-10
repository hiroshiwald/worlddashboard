import { EnrichedEntity } from "@/lib/types";
import { CardTheme, reasonBadgeClasses, reasonTypeLabel } from "./utils";

interface EntityCardProps {
  entity: EnrichedEntity;
  dark: boolean;
  t: CardTheme;
  onEntityClick: (name: string) => void;
}

export default function EntityCard({
  entity,
  dark,
  t,
  onEntityClick,
}: EntityCardProps) {
  const topReason = entity.noveltyReasons[0];

  return (
    <div className={`border rounded-xl px-4 py-3 ${t.cardBg}`}>
      {/* Name + type */}
      <div className="flex items-center gap-2 mb-1.5">
        <button
          onClick={() => onEntityClick(entity.name)}
          className={`text-sm font-semibold cursor-pointer hover:underline ${t.entityName}`}
        >
          {entity.name}
        </button>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${dark ? "bg-slate-800 text-slate-500" : "bg-gray-100 text-gray-400"}`}>
          {entity.type}
        </span>
      </div>

      {/* Novelty score + why badge */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <div className={`w-12 h-2 rounded-full overflow-hidden ${t.confidenceBg}`}>
            <div className={`h-full rounded-full ${t.noveltyBar}`} style={{ width: `${entity.noveltyScore}%` }} />
          </div>
          <span className={`text-[10px] font-semibold ${t.textMuted}`}>{entity.noveltyScore}</span>
        </div>
        {topReason && (
          <span className={reasonBadgeClasses(topReason.type, dark)}>
            {reasonTypeLabel(topReason.type)}
          </span>
        )}
      </div>

      {topReason && (
        <p className={`text-xs leading-relaxed mb-2 ${t.textMuted}`}>
          {topReason.label}
        </p>
      )}

      {/* Meta */}
      <div className={`text-[10px] ${t.textMuted}`}>
        {entity.mentions} mentions &middot; {entity.sourceCount} sources &middot; {entity.categorySpread} categories
      </div>
    </div>
  );
}
