"use client";

import { useMemo, useState } from "react";
import { FeedItem, EnrichedEntity, Situation, NoveltyReasonType } from "@/lib/types";
import { extractEntities } from "@/lib/entity-extractor";
import { enrichEntities, isKnownSituation } from "@/lib/novelty-scorer";
import { buildSituations } from "@/lib/situation-builder";
import { getThemeClasses } from "@/lib/theme";

interface IntelTabProps {
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 0) return "now";
  if (secs < 5) return "now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const URGENCY_DOT_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  advisory: "bg-yellow-500",
  monitoring: "bg-sky-500",
  system: "bg-slate-500",
  neutral: "bg-gray-400",
};

const TEMPO_STYLES: Record<string, { dark: string; light: string }> = {
  accelerating: {
    dark: "text-red-400 bg-red-500/15",
    light: "text-red-700 bg-red-50",
  },
  steady: {
    dark: "text-slate-400 bg-slate-500/10",
    light: "text-gray-500 bg-gray-100",
  },
  fading: {
    dark: "text-slate-500 bg-slate-500/10 italic",
    light: "text-gray-400 bg-gray-100 italic",
  },
  new: {
    dark: "text-emerald-400 bg-emerald-500/15",
    light: "text-emerald-700 bg-emerald-50",
  },
};

function reasonBadgeClasses(type: NoveltyReasonType, dark: boolean): string {
  const base = "text-[10px] font-semibold px-2 py-0.5 rounded-full";
  switch (type) {
    case "novel_edge":
      return `${base} ${dark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-700"}`;
    case "category_crossover":
      return `${base} ${dark ? "bg-orange-500/15 text-orange-400" : "bg-orange-50 text-orange-700"}`;
    case "quiet_mover":
      return `${base} ${dark ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-700"}`;
    case "entity_emergence":
      return `${base} ${dark ? "bg-violet-500/15 text-violet-400" : "bg-violet-50 text-violet-700"}`;
    case "baseline_surprise":
      return `${base} ${dark ? "bg-blue-500/15 text-blue-400" : "bg-blue-50 text-blue-700"}`;
  }
}

function reasonTypeLabel(type: NoveltyReasonType): string {
  switch (type) {
    case "novel_edge": return "Novel Link";
    case "category_crossover": return "Cross-Category";
    case "quiet_mover": return "Quiet Mover";
    case "entity_emergence": return "New Entity";
    case "baseline_surprise": return "Spiking";
  }
}

export default function IntelTab({ items, dark, onEntityClick }: IntelTabProps) {
  const entities = useMemo(() => extractEntities(items), [items]);
  const enriched = useMemo(() => enrichEntities(entities, items), [entities, items]);
  const situations = useMemo(() => buildSituations(enriched, items), [enriched, items]);

  const [expandedSituations, setExpandedSituations] = useState<Set<string>>(new Set());
  const [showAllKnown, setShowAllKnown] = useState(false);
  const [showAllNovel, setShowAllNovel] = useState(false);

  // Entity lookup for situation classification
  const entityLookup = useMemo(() => {
    const map = new Map<string, EnrichedEntity>();
    for (const e of enriched) map.set(e.name, e);
    return map;
  }, [enriched]);

  // Separate known vs novel situations
  const { knownSituations, novelSituations } = useMemo(() => {
    const known: Situation[] = [];
    const novel: Situation[] = [];

    for (const sit of situations) {
      // A situation is "known" if its dominant entity (most mentions) is a known situation
      const dominantEntity = sit.entities
        .map((n) => entityLookup.get(n))
        .filter(Boolean)
        .sort((a, b) => b!.mentions - a!.mentions)[0];

      if (dominantEntity && isKnownSituation(dominantEntity)) {
        known.push(sit);
      } else {
        novel.push(sit);
      }
    }

    return { knownSituations: known, novelSituations: novel };
  }, [situations, entityLookup]);

  // Standalone novel entities not in any situation
  const situationEntityNames = useMemo(() => {
    const names = new Set<string>();
    for (const sit of situations) {
      for (const n of sit.entities) names.add(n);
    }
    return names;
  }, [situations]);

  const standaloneNovelEntities = useMemo(() => {
    return enriched
      .filter((e) => !situationEntityNames.has(e.name) && !isKnownSituation(e) && e.noveltyScore > 0)
      .sort((a, b) => b.noveltyScore - a.noveltyScore);
  }, [enriched, situationEntityNames]);

  const toggleSituation = (id: string) => {
    setExpandedSituations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const KNOWN_LIMIT = 6;
  const NOVEL_LIMIT = 15;
  const visibleKnown = showAllKnown ? knownSituations : knownSituations.slice(0, KNOWN_LIMIT);
  const visibleNovel = showAllNovel ? novelSituations : novelSituations.slice(0, NOVEL_LIMIT);

  const t = {
    summaryBg: dark ? "bg-slate-900 shadow-lg shadow-black/20" : "bg-white shadow-sm",
    summaryText: dark ? "text-slate-300" : "text-gray-700",
    text: dark ? "text-slate-200" : "text-gray-800",
    textMuted: dark ? "text-slate-400" : "text-gray-500",
    entityName: dark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700",
    cardBg: dark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-100 shadow-sm",
    knownBg: dark ? "bg-slate-900/80" : "bg-gray-50",
    knownRowBorder: dark ? "border-slate-800/60" : "border-gray-100",
    knownRowHover: dark ? "hover:bg-slate-800/80" : "hover:bg-blue-50/40",
    sectionLabel: dark ? "text-slate-300" : "text-gray-700",
    confidenceBg: dark ? "bg-slate-700" : "bg-gray-200",
    noveltyBar: dark ? "bg-emerald-500" : "bg-emerald-500",
    linkText: dark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700",
  };

  const hasFewItems = items.length < 10;

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      {/* ─── Summary ─── */}
      <div className={`flex flex-wrap items-center gap-4 md:gap-6 px-4 md:px-5 py-3 mb-4 text-xs rounded-xl ${t.summaryBg} ${t.summaryText}`}>
        <span className="font-bold text-sm">{enriched.length} Entities</span>
        <span>{situations.length} situations</span>
        <span>{knownSituations.length} known</span>
        <span>{novelSituations.length + standaloneNovelEntities.length} emerging</span>
      </div>

      {hasFewItems && situations.length === 0 && (
        <div className={`text-center py-8 text-sm ${t.textMuted}`}>
          Not enough data for situation clustering. Showing enriched entities below.
        </div>
      )}

      {/* ═══ Section 1: Known Situations Strip ═══ */}
      {knownSituations.length > 0 && (
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
                    {/* Urgency dot */}
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${URGENCY_DOT_COLORS[sit.urgency]}`} />

                    {/* Entities */}
                    <span className={`text-sm font-semibold flex-shrink-0 ${t.text}`}>
                      {sit.entities.slice(0, 3).join(", ")}
                    </span>

                    {/* Article + source count */}
                    <span className={`text-xs flex-shrink-0 ${t.textMuted}`}>
                      {sit.articleCount} articles &middot; {sit.sourceCount} sources
                    </span>

                    {/* Latest headline */}
                    <span className={`text-xs truncate flex-1 min-w-0 ${t.textMuted}`}>
                      {sit.latestArticle?.title}
                    </span>

                    {/* Source + time */}
                    <span className={`text-[10px] flex-shrink-0 ${t.textMuted}`}>
                      {sit.latestArticle?.sourceName} &middot; {timeAgo(sit.latestArticle?.published)}
                    </span>

                    {/* Tempo badge */}
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${dark ? tempoStyle.dark : tempoStyle.light}`}>
                      {sit.tempo}
                    </span>

                    {/* Expand chevron */}
                    <svg className={`w-4 h-4 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""} ${t.textMuted}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded articles */}
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

          {knownSituations.length > KNOWN_LIMIT && (
            <button
              onClick={() => setShowAllKnown(!showAllKnown)}
              className={`w-full text-center py-2 mt-1 text-xs font-medium rounded-lg transition-colors ${dark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100"}`}
            >
              {showAllKnown ? "Show Less" : `${knownSituations.length - KNOWN_LIMIT} more known situations`}
            </button>
          )}
        </div>
      )}

      {/* ═══ Section 2: Emerging & Novel Cards ═══ */}
      {(novelSituations.length > 0 || standaloneNovelEntities.length > 0) && (
        <div>
          <h3 className={`text-xs font-bold uppercase tracking-wider mb-3 px-1 ${t.sectionLabel}`}>
            Emerging &amp; Novel
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {/* Situation cards */}
            {visibleNovel.map((sit) => (
              <SituationCard
                key={sit.id}
                situation={sit}
                dark={dark}
                t={t}
                onEntityClick={onEntityClick}
              />
            ))}

            {/* Standalone entity cards */}
            {standaloneNovelEntities.slice(0, showAllNovel ? undefined : Math.max(0, NOVEL_LIMIT - novelSituations.length)).map((entity) => (
              <EntityCard
                key={entity.name}
                entity={entity}
                dark={dark}
                t={t}
                onEntityClick={onEntityClick}
              />
            ))}
          </div>

          {(novelSituations.length > NOVEL_LIMIT || standaloneNovelEntities.length > NOVEL_LIMIT - novelSituations.length) && (
            <button
              onClick={() => setShowAllNovel(!showAllNovel)}
              className={`w-full text-center py-2 mt-2 text-xs font-medium rounded-lg transition-colors ${dark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100"}`}
            >
              {showAllNovel ? "Show Less" : "Show All"}
            </button>
          )}
        </div>
      )}

      {enriched.length === 0 && (
        <div className={`text-center py-12 text-sm ${t.textMuted}`}>
          No entities with 2+ mentions
        </div>
      )}
    </div>
  );
}

// ─── Sub-Components ───

interface CardTheme {
  cardBg: string;
  text: string;
  textMuted: string;
  entityName: string;
  linkText: string;
  confidenceBg: string;
  noveltyBar: string;
}

function SituationCard({
  situation: sit,
  dark,
  t,
  onEntityClick,
}: {
  situation: Situation;
  dark: boolean;
  t: CardTheme;
  onEntityClick: (name: string) => void;
}) {
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

function EntityCard({
  entity,
  dark,
  t,
  onEntityClick,
}: {
  entity: EnrichedEntity;
  dark: boolean;
  t: CardTheme;
  onEntityClick: (name: string) => void;
}) {
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
