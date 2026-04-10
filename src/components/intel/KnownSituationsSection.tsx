import { Situation } from "@/lib/types";
import { IntelTabTheme } from "@/hooks/useIntelTab";
import { URGENCY_DOT_COLORS, TEMPO_STYLES, timeAgo } from "./utils";

interface KnownSituationsSectionProps {
  knownSituations: Situation[];
  visibleKnown: Situation[];
  expandedSituations: Set<string>;
  toggleSituation: (id: string) => void;
  showAllKnown: boolean;
  setShowAllKnown: (v: boolean) => void;
  knownLimit: number;
  dark: boolean;
  t: IntelTabTheme;
}

export default function KnownSituationsSection({
  knownSituations,
  visibleKnown,
  expandedSituations,
  toggleSituation,
  showAllKnown,
  setShowAllKnown,
  knownLimit,
  dark,
  t,
}: KnownSituationsSectionProps) {
  if (knownSituations.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 px-1 ${t.sectionLabel}`}>
        Known Situations
      </h3>
      <div className={`rounded-xl overflow-hidden border ${dark ? "border-slate-800" : "border-gray-200"} ${t.knownBg}`}>
        {visibleKnown.map((sit) => {
          const isExpanded = expandedSituations.has(sit.id);
          const tempoStyle = TEMPO_STYLES[sit.tempo] || TEMPO_STYLES.steady;
          return (
            <div key={sit.id} className={`border-b last:border-b-0 ${t.knownRowBorder}`}>
              <button
                onClick={() => toggleSituation(sit.id)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${t.knownRowHover}`}
              >
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${URGENCY_DOT_COLORS[sit.urgency]}`} />
                <span className={`text-sm font-semibold flex-shrink-0 ${t.text}`}>
                  {sit.entities.slice(0, 3).join(", ")}
                </span>
                <span className={`text-xs flex-shrink-0 ${t.textMuted}`}>
                  {sit.articleCount} articles &middot; {sit.sourceCount} sources
                </span>
                <span className={`text-xs truncate flex-1 min-w-0 ${t.textMuted}`}>
                  {sit.latestArticle?.title}
                </span>
                <span className={`text-[10px] flex-shrink-0 ${t.textMuted}`}>
                  {sit.latestArticle?.sourceName} &middot; {timeAgo(sit.latestArticle?.published)}
                </span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${dark ? tempoStyle.dark : tempoStyle.light}`}>
                  {sit.tempo}
                </span>
                <svg className={`w-4 h-4 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""} ${t.textMuted}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isExpanded && (
                <div className={`px-4 pb-3 pt-1 space-y-1.5 ${dark ? "bg-slate-800/30" : "bg-gray-50/80"}`}>
                  {sit.articles.slice(0, 10).map((article) => (
                    <div key={article.id} className="flex items-center gap-2 text-xs">
                      <span className={`flex-shrink-0 font-medium ${t.textMuted}`}>
                        {article.sourceName}
                      </span>
                      <a
                        href={article.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`truncate hover:underline ${t.linkText}`}
                      >
                        {article.title}
                      </a>
                      <span className={`flex-shrink-0 ${t.textMuted}`}>
                        {timeAgo(article.published)}
                      </span>
                    </div>
                  ))}
                  {sit.articles.length > 10 && (
                    <span className={`text-[10px] ${t.textMuted}`}>
                      +{sit.articles.length - 10} more articles
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {knownSituations.length > knownLimit && (
        <button
          onClick={() => setShowAllKnown(!showAllKnown)}
          className={`w-full text-center py-2 mt-1 text-xs font-medium rounded-lg transition-colors ${dark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100"}`}
        >
          {showAllKnown ? "Show Less" : `${knownSituations.length - knownLimit} more known situations`}
        </button>
      )}
    </div>
  );
}
