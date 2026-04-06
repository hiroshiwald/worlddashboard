"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { FeedItem, ExtractedEntity, Signal, SignalSeverity, SignalType, EnrichedEntity } from "@/lib/types";
import { extractEntities } from "@/lib/entity-extractor";
import { detectSignals } from "@/lib/signal-detector";
import { enrichEntities } from "@/lib/novelty-scorer";
import { buildSituations } from "@/lib/situation-builder";
import {
  MUTE_DURATION,
  SNAPSHOT_INTERVAL,
  loadMutedEntities,
  saveMutedEntities,
  loadPreviousEntityNames,
  saveEntitySnapshot,
} from "@/lib/signal-storage";

interface SignalsTabProps {
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

function SignalIcon({ type, className }: { type: SignalType; className?: string }) {
  const cls = className || "w-4 h-4";
  switch (type) {
    case "surge":
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M12.577 4.878a.75.75 0 01.919-.53l4.78 1.281a.75.75 0 01.531.919l-1.281 4.78a.75.75 0 01-1.449-.387l.81-3.022a19.407 19.407 0 00-5.594 5.203.75.75 0 01-1.139.093L7 10.06l-4.72 4.72a.75.75 0 01-1.06-1.06l5.25-5.25a.75.75 0 011.06 0l3.074 3.073a20.923 20.923 0 015.545-4.93l-3.042.815a.75.75 0 01-.53-.919z" clipRule="evenodd" />
        </svg>
      );
    case "sentiment_deterioration":
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
        </svg>
      );
    case "cross_category":
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor">
          <path d="M2 4.25A2.25 2.25 0 014.25 2h2.5A2.25 2.25 0 019 4.25v2.5A2.25 2.25 0 016.75 9h-2.5A2.25 2.25 0 012 6.75v-2.5zM2 13.25A2.25 2.25 0 014.25 11h2.5A2.25 2.25 0 019 13.25v2.5A2.25 2.25 0 016.75 18h-2.5A2.25 2.25 0 012 15.75v-2.5zM11 4.25A2.25 2.25 0 0113.25 2h2.5A2.25 2.25 0 0118 4.25v2.5A2.25 2.25 0 0115.75 9h-2.5A2.25 2.25 0 0111 6.75v-2.5zM11 13.25A2.25 2.25 0 0113.25 11h2.5A2.25 2.25 0 0118 13.25v2.5A2.25 2.25 0 0115.75 18h-2.5A2.25 2.25 0 0111 15.75v-2.5z" />
        </svg>
      );
    case "novel_cooccurrence":
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor">
          <path d="M12.232 4.232a2.5 2.5 0 013.536 3.536l-1.225 1.224a.75.75 0 001.061 1.06l1.224-1.224a4 4 0 00-5.656-5.656l-3 3a4 4 0 00.225 5.865.75.75 0 00.977-1.138 2.5 2.5 0 01-.142-3.667l3-3z" />
          <path d="M11.603 7.963a.75.75 0 00-.977 1.138 2.5 2.5 0 01.142 3.667l-3 3a2.5 2.5 0 01-3.536-3.536l1.225-1.224a.75.75 0 00-1.061-1.06l-1.224 1.224a4 4 0 105.656 5.656l3-3a4 4 0 00-.225-5.865z" />
        </svg>
      );
    case "escalation":
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
      );
    case "novel_emergence":
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401z" clipRule="evenodd" />
        </svg>
      );
  }
}

function severityColor(severity: SignalSeverity, dark: boolean) {
  switch (severity) {
    case "critical":
      return {
        border: "border-l-red-500",
        text: dark ? "text-red-400" : "text-red-600",
        bg: dark ? "bg-red-500/10" : "bg-red-50",
        bar: "bg-red-500",
      };
    case "warning":
      return {
        border: "border-l-amber-500",
        text: dark ? "text-amber-400" : "text-amber-600",
        bg: dark ? "bg-amber-500/10" : "bg-amber-50",
        bar: "bg-amber-500",
      };
    case "advisory":
      return {
        border: "border-l-yellow-500",
        text: dark ? "text-yellow-400" : "text-yellow-600",
        bg: dark ? "bg-yellow-500/10" : "bg-yellow-50",
        bar: "bg-yellow-500",
      };
  }
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

function SentimentBadge({ value, dark }: { value: number; dark: boolean }) {
  let label: string;
  let colorClass: string;

  if (value <= -0.3) {
    label = "NEG";
    colorClass = dark ? "text-red-400 bg-red-500/15" : "text-red-700 bg-red-100";
  } else if (value <= -0.1) {
    label = "NEG";
    colorClass = dark ? "text-red-300 bg-red-500/10" : "text-red-600 bg-red-50";
  } else if (value >= 0.3) {
    label = "POS";
    colorClass = dark ? "text-emerald-400 bg-emerald-500/15" : "text-emerald-700 bg-emerald-100";
  } else if (value >= 0.1) {
    label = "POS";
    colorClass = dark ? "text-emerald-300 bg-emerald-500/10" : "text-emerald-600 bg-emerald-50";
  } else {
    label = "NEU";
    colorClass = dark ? "text-slate-400 bg-slate-500/10" : "text-gray-500 bg-gray-100";
  }

  return (
    <span
      className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${colorClass}`}
      title={`Sentiment: ${value.toFixed(2)}`}
    >
      {label}
    </span>
  );
}

export default function SignalsTab({ items, dark, onEntityClick }: SignalsTabProps) {
  const entities = useMemo(() => extractEntities(items), [items]);
  const enriched = useMemo(() => enrichEntities(entities, items), [entities, items]);
  const situations = useMemo(() => buildSituations(enriched, items), [enriched, items]);

  const [mutedEntities, setMutedEntities] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    setMutedEntities(loadMutedEntities());
  }, []);

  const handleMute = useCallback((name: string) => {
    setMutedEntities((prev) => {
      const next = new Map(prev);
      next.set(name, Date.now() + MUTE_DURATION);
      saveMutedEntities(next);
      return next;
    });
  }, []);

  const handleUnmuteAll = useCallback(() => {
    setMutedEntities(new Map());
    localStorage.removeItem("wd-muted-entities");
  }, []);

  const previousEntityNames = useRef<Set<string>>(new Set());
  const lastSnapshotTime = useRef<number>(0);

  useEffect(() => {
    previousEntityNames.current = loadPreviousEntityNames();
  }, []);

  useEffect(() => {
    const now = Date.now();
    if (entities.length > 0 && now - lastSnapshotTime.current > SNAPSHOT_INTERVAL) {
      lastSnapshotTime.current = now;
      saveEntitySnapshot(entities);
    }
  }, [entities]);

  const signals = useMemo(
    () => detectSignals(entities, items, previousEntityNames.current),
    [entities, items]
  );

  // Filter signals: only confidence >= 0.70, and not fully muted
  const activeSignals = useMemo(() => {
    const now = Date.now();
    return signals
      .filter((s) => s.confidence >= 0.70)
      .filter((s) => !s.entities.every((e) => {
        const expiry = mutedEntities.get(e);
        return expiry !== undefined && expiry > now;
      }));
  }, [signals, mutedEntities]);

  const [showAll, setShowAll] = useState(false);
  const INITIAL_LIMIT = 12;
  const visibleSignals = showAll ? activeSignals : activeSignals.slice(0, INITIAL_LIMIT);

  // Build item lookup for evidence articles
  const itemMap = useMemo(() => {
    const map = new Map<string, FeedItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  // Entity lookup for evidence
  const entityLookup = useMemo(() => {
    const map = new Map<string, EnrichedEntity>();
    for (const e of enriched) map.set(e.name, e);
    return map;
  }, [enriched]);

  // Situation lookup by entity name
  const entitySituationMap = useMemo(() => {
    const map = new Map<string, string>(); // entity name -> situation title
    for (const sit of situations) {
      for (const name of sit.entities) {
        if (!map.has(name)) map.set(name, sit.title);
      }
    }
    return map;
  }, [situations]);

  // Get evidence articles for a signal
  const getEvidenceArticles = useCallback(
    (signal: Signal): FeedItem[] => {
      const articleIds = new Set<string>();
      for (const entityName of signal.entities) {
        const entity = entityLookup.get(entityName);
        if (entity) {
          for (const id of entity.itemIds) articleIds.add(id);
        }
      }
      return Array.from(articleIds)
        .map((id) => itemMap.get(id))
        .filter((item): item is FeedItem => !!item)
        .sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime())
        .slice(0, 3);
    },
    [entityLookup, itemMap]
  );

  // ─── Watchlist: top 12 entities by day mentions ───
  const topEntities = useMemo(() => {
    const now = Date.now();
    return [...enriched]
      .filter((e) => {
        const expiry = mutedEntities.get(e.name);
        return !expiry || expiry <= now;
      })
      .sort((a, b) => b.recentMentions.day - a.recentMentions.day)
      .slice(0, 12);
  }, [enriched, mutedEntities]);

  // Build sparkline data: bucket entity articles into 24 hourly bins
  const sparklineData = useMemo(() => {
    const now = Date.now();
    const result = new Map<string, number[]>();

    for (const entity of topEntities) {
      const bins = new Array(24).fill(0);
      for (const itemId of entity.itemIds) {
        const item = itemMap.get(itemId);
        if (!item) continue;
        const age = now - new Date(item.published).getTime();
        const hoursAgo = Math.floor(age / (60 * 60 * 1000));
        if (hoursAgo >= 0 && hoursAgo < 24) {
          bins[23 - hoursAgo]++; // index 0 = oldest, 23 = most recent
        }
      }
      result.set(entity.name, bins);
    }

    return result;
  }, [topEntities, itemMap]);

  const severityCounts = useMemo(() => {
    const c = { critical: 0, warning: 0, advisory: 0 };
    for (const s of activeSignals) c[s.severity]++;
    return c;
  }, [activeSignals]);

  const mutedCount = mutedEntities.size;

  const t = {
    cardBg: dark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-100 shadow-sm",
    summaryBg: dark ? "bg-slate-900 shadow-lg shadow-black/20" : "bg-white shadow-sm",
    summaryText: dark ? "text-slate-300" : "text-gray-700",
    text: dark ? "text-slate-200" : "text-gray-800",
    textMuted: dark ? "text-slate-400" : "text-gray-500",
    entityName: dark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700",
    confidenceBg: dark ? "bg-slate-700" : "bg-gray-200",
    muteBtnBg: dark
      ? "text-slate-500 hover:text-red-400 hover:bg-red-500/10"
      : "text-gray-400 hover:text-red-600 hover:bg-red-50",
    sectionLabel: dark ? "text-slate-300" : "text-gray-700",
    evidenceBg: dark ? "bg-slate-800/50 border-slate-700" : "bg-gray-50 border-gray-200",
    linkText: dark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700",
    sparkBarActive: dark ? "bg-emerald-500" : "bg-emerald-500",
    sparkBarEmpty: dark ? "bg-slate-700" : "bg-gray-200",
  };

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      {/* ─── Summary Strip ─── */}
      <div className={`flex flex-wrap items-center gap-4 md:gap-6 px-4 md:px-5 py-3 mb-4 text-xs rounded-xl ${t.summaryBg} ${t.summaryText}`}>
        <span className="font-bold text-sm">{activeSignals.length} Signals</span>
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
              onClick={handleUnmuteAll}
              className={`text-xs underline ${dark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-700"}`}
            >
              Clear
            </button>
          </span>
        )}
        <span className={`ml-auto text-xs ${t.textMuted}`}>
          {entities.length} entities analyzed &middot; confidence &ge; 70%
        </span>
      </div>

      {/* ─── Signal Cards ─── */}
      {activeSignals.length > 0 ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
            {visibleSignals.map((signal) => {
              const sc = severityColor(signal.severity, dark);
              const evidence = getEvidenceArticles(signal);
              const relatedSituation = signal.entities
                .map((e) => entitySituationMap.get(e))
                .find(Boolean);

              return (
                <div
                  key={signal.id}
                  className={`border border-l-4 rounded-xl ${sc.border} ${t.cardBg} px-4 py-3`}
                >
                  {/* Header: icon + title + confidence */}
                  <div className="flex items-start gap-2.5 mb-2">
                    <span className={`mt-0.5 flex-shrink-0 ${sc.text}`}>
                      <SignalIcon type={signal.type} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs font-bold uppercase tracking-wide ${sc.text} truncate block`}>
                        {signal.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <div className={`w-14 h-2 rounded-full overflow-hidden ${t.confidenceBg}`}>
                        <div className={`h-full rounded-full ${sc.bar}`} style={{ width: `${signal.confidence * 100}%` }} />
                      </div>
                      <span className={`text-[10px] ${t.textMuted}`}>{Math.round(signal.confidence * 100)}%</span>
                    </div>
                  </div>

                  {/* Description */}
                  <p className={`text-xs leading-relaxed mb-2.5 ${t.textMuted}`}>
                    {signal.description}
                  </p>

                  {/* Evidence articles */}
                  {evidence.length > 0 && (
                    <div className={`rounded-lg border px-3 py-2 mb-2.5 ${t.evidenceBg}`}>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${t.textMuted}`}>
                        Triggering articles
                      </span>
                      <div className="mt-1.5 space-y-1">
                        {evidence.map((article) => (
                          <div key={article.id} className="flex items-center gap-1.5 text-[11px]">
                            <span className={`font-medium flex-shrink-0 ${t.textMuted}`}>
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
                            <span className={`flex-shrink-0 text-[10px] ${t.textMuted}`}>
                              {timeAgo(article.published)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Related situation link */}
                  {relatedSituation && (
                    <p className={`text-[10px] mb-2 ${t.textMuted}`}>
                      Related: <span className="font-medium">{relatedSituation.length > 60 ? relatedSituation.slice(0, 60) + "..." : relatedSituation}</span>
                    </p>
                  )}

                  {/* Entity chips with mute buttons */}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {signal.entities.map((name) => (
                      <span key={name} className="inline-flex items-center gap-0.5">
                        <button
                          onClick={() => onEntityClick(name)}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full cursor-pointer hover:underline ${sc.bg} ${sc.text}`}
                        >
                          {name}
                        </button>
                        <button
                          onClick={() => handleMute(name)}
                          className={`text-[10px] p-0.5 rounded-full transition-colors ${t.muteBtnBg}`}
                          title={`Mute "${name}" for 24h`}
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${dark ? "bg-slate-800 text-slate-500" : "bg-gray-100 text-gray-400"}`}>
                      {signal.type.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {activeSignals.length > INITIAL_LIMIT && (
            <button
              onClick={() => setShowAll(!showAll)}
              className={`w-full text-center py-2 text-xs font-medium rounded-lg transition-colors ${dark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100"}`}
            >
              {showAll ? "Show Less" : `Show All ${activeSignals.length} Signals`}
            </button>
          )}
        </>
      ) : (
        <div className={`text-center py-12 text-sm ${t.textMuted}`}>
          {mutedCount > 0
            ? "All signals muted — clear mutes to view"
            : "No high-confidence signals detected"}
        </div>
      )}

      {/* ─── Watchlist: Sparkline Cards ─── */}
      {topEntities.length > 0 && (
        <>
          <div className={`flex items-center gap-3 px-4 md:px-5 py-3 mt-4 mb-3 text-xs font-bold rounded-xl ${t.summaryBg} ${t.summaryText}`}>
            Watchlist — Top {topEntities.length}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {topEntities.map((entity) => {
              const bins = sparklineData.get(entity.name) || new Array(24).fill(0);
              const maxBin = Math.max(1, ...bins);

              return (
                <div key={entity.name} className={`border rounded-xl px-4 py-3 ${t.cardBg}`}>
                  {/* Name + sentiment */}
                  <div className="flex items-center justify-between mb-2">
                    <button
                      onClick={() => onEntityClick(entity.name)}
                      className={`text-sm font-semibold cursor-pointer hover:underline ${t.entityName}`}
                    >
                      {entity.name}
                    </button>
                    <SentimentBadge value={entity.sentiment} dark={dark} />
                  </div>

                  {/* Sparkline: 24 bars */}
                  <div className="flex items-end gap-px h-8 mb-2">
                    {bins.map((count, i) => (
                      <div
                        key={i}
                        className={`flex-1 rounded-t-sm ${count > 0 ? t.sparkBarActive : t.sparkBarEmpty}`}
                        style={{ height: `${Math.max(2, (count / maxBin) * 100)}%` }}
                        title={`${24 - i}h ago: ${count} mentions`}
                      />
                    ))}
                  </div>

                  {/* Stats */}
                  <div className={`text-[10px] ${t.textMuted}`}>
                    {entity.recentMentions.day} 24h &middot; {entity.recentMentions.hour} 1h &middot; {entity.sourceCount} sources
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
