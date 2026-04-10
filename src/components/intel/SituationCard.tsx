import { Situation } from "@/lib/types";
import { CardTheme, reasonBadgeClasses, reasonTypeLabel, timeAgo } from "./utils";

interface SituationCardProps {
  situation: Situation;
  dark: boolean;
  t: CardTheme;
  onEntityClick: (name: string) => void;
}

export default function SituationCard({
  situation: sit,
  dark,
  t,
  onEntityClick,
}: SituationCardProps) {
  const topReason = sit.noveltyReasons[0];

  return (
    <div className={`border rounded-xl px-4 py-3 ${t.cardBg}`}>
      {/* Title */}
      <h4 className={`text-sm font-semibold mb-1.5 line-clamp-2 ${t.text}`}>
        {sit.title}
      </h4>

      {/* Novelty score + why badge */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <div className={`w-12 h-2 rounded-full overflow-hidden ${t.confidenceBg}`}>
            <div className={`h-full rounded-full ${t.noveltyBar}`} style={{ width: `${sit.noveltyScore}%` }} />
          </div>
          <span className={`text-[10px] font-semibold ${t.textMuted}`}>{sit.noveltyScore}</span>
        </div>
        {topReason && (
          <span className={reasonBadgeClasses(topReason.type, dark)}>
            {reasonTypeLabel(topReason.type)}
          </span>
        )}
      </div>

      {/* Description from top reason */}
      {topReason && (
        <p className={`text-xs leading-relaxed mb-2 ${t.textMuted}`}>
          {topReason.label}
        </p>
      )}

      {/* Entity chips */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {sit.entities.slice(0, 5).map((name) => (
          <button
            key={name}
            onClick={() => onEntityClick(name)}
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full cursor-pointer hover:underline ${
              dark ? "bg-slate-800 text-slate-300" : "bg-gray-100 text-gray-600"
            }`}
          >
            {name}
          </button>
        ))}
        {sit.entities.length > 5 && (
          <span className={`text-[10px] ${t.textMuted}`}>+{sit.entities.length - 5}</span>
        )}
      </div>

      {/* Meta line */}
      <div className={`text-[10px] mb-1.5 ${t.textMuted}`}>
        {sit.articleCount} articles &middot; {sit.sourceCount} sources &middot; {sit.categorySpread} categories &middot; {timeAgo(sit.firstSeen)}
      </div>

      {/* Latest article peek */}
      {sit.latestArticle && (
        <div className={`text-xs flex items-center gap-1.5 ${t.textMuted}`}>
          <span className="font-medium flex-shrink-0">{sit.latestArticle.sourceName}</span>
          <a
            href={sit.latestArticle.link}
            target="_blank"
            rel="noopener noreferrer"
            className={`truncate hover:underline ${t.linkText}`}
          >
            {sit.latestArticle.title}
          </a>
        </div>
      )}
    </div>
  );
}
