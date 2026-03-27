"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { FeedItem, ExtractedEntity, Signal, SignalSeverity, SignalType } from "@/lib/types";
import { extractEntities } from "@/lib/entity-extractor";
import { detectSignals } from "@/lib/signal-detector";

interface SignalsTabProps {
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

const MUTE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes

function loadMutedEntities(): Map<string, number> {
  try {
    const raw = localStorage.getItem("wd-muted-entities");
    if (!raw) return new Map();
    const arr: [string, number][] = JSON.parse(raw);
    const now = Date.now();
    // Filter expired
    return new Map(arr.filter(([, expiry]) => expiry > now));
  } catch {
    return new Map();
  }
}

function saveMutedEntities(muted: Map<string, number>) {
  localStorage.setItem(
    "wd-muted-entities",
    JSON.stringify(Array.from(muted.entries()))
  );
}

function loadPreviousEntityNames(): Set<string> {
  try {
    const raw = localStorage.getItem("wd-entity-snapshot");
    if (!raw) return new Set();
    const { names, timestamp } = JSON.parse(raw);
    // Only use snapshots less than 2 hours old
    if (Date.now() - timestamp > 2 * 60 * 60 * 1000) return new Set();
    return new Set(names);
  } catch {
    return new Set();
  }
}

function saveEntitySnapshot(entities: ExtractedEntity[]) {
  const names = entities.map((e) => e.name);
  localStorage.setItem(
    "wd-entity-snapshot",
    JSON.stringify({ names, timestamp: Date.now() })
  );
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
    colorClass = dark ? "text-slate-400 bg-slate-500/10" : "text-stone-500 bg-stone-100";
  }

  return (
    <span
      className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${colorClass}`}
      title={`Sentiment: ${value.toFixed(2)}`}
    >
      {label}
    </span>
  );
}

function UrgencyMiniBar({
  breakdown,
  total,
  dark,
}: {
  breakdown: ExtractedEntity["urgencyBreakdown"];
  total: number;
  dark: boolean;
}) {
  const segments = [
    { key: "critical", count: breakdown.critical, color: "bg-red-500" },
    { key: "warning", count: breakdown.warning, color: "bg-amber-500" },
    { key: "advisory", count: breakdown.advisory, color: "bg-yellow-500" },
    { key: "monitoring", count: breakdown.monitoring, color: "bg-sky-500" },
    {
      key: "neutral",
      count: breakdown.neutral + breakdown.system,
      color: dark ? "bg-slate-600" : "bg-stone-300",
    },
  ].filter((s) => s.count > 0);

  return (
    <div
      className="flex h-2 w-14 overflow-hidden"
      title={segments.map((s) => `${s.key}: ${s.count}`).join(", ")}
    >
      {segments.map((seg) => (
        <div
          key={seg.key}
          className={`${seg.color} h-full`}
          style={{ width: `${(seg.count / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

export default function SignalsTab({
  items,
  dark,
  onEntityClick,
}: SignalsTabProps) {
  const entities = useMemo(() => extractEntities(items), [items]);

  // --- Muting state (persisted to localStorage) ---
  const [mutedEntities, setMutedEntities] = useState<Map<string, number>>(
    () => new Map()
  );

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

  // --- Novelty tracking (entity snapshot) ---
  const previousEntityNames = useRef<Set<string>>(new Set());
  const lastSnapshotTime = useRef<number>(0);

  useEffect(() => {
    previousEntityNames.current = loadPreviousEntityNames();
  }, []);

  // Save snapshot periodically
  useEffect(() => {
    const now = Date.now();
    if (
      entities.length > 0 &&
      now - lastSnapshotTime.current > SNAPSHOT_INTERVAL
    ) {
      lastSnapshotTime.current = now;
      saveEntitySnapshot(entities);
    }
  }, [entities]);

  // --- Signal detection ---
  const signals = useMemo(
    () => detectSignals(entities, items, previousEntityNames.current),
    [entities, items]
  );

  // Filter out signals where ALL entities are muted
  const activeSignals = useMemo(() => {
    if (mutedEntities.size === 0) return signals;
    const now = Date.now();
    return signals.filter(
      (s) => !s.entities.every((e) => {
        const expiry = mutedEntities.get(e);
        return expiry !== undefined && expiry > now;
      })
    );
  }, [signals, mutedEntities]);

  const [showAll, setShowAll] = useState(false);
  const INITIAL_LIMIT = 12;

  const visibleSignals = showAll
    ? activeSignals
    : activeSignals.slice(0, INITIAL_LIMIT);

  // Top 20 entities by recent mentions for the velocity grid (excluding muted)
  const topEntities = useMemo(() => {
    const now = Date.now();
    return [...entities]
      .filter((e) => {
        const expiry = mutedEntities.get(e.name);
        return !expiry || expiry <= now;
      })
      .sort((a, b) => b.recentMentions.day - a.recentMentions.day)
      .slice(0, 20);
  }, [entities, mutedEntities]);

  // Compute max values for normalizing bars
  const maxHour = useMemo(
    () => Math.max(1, ...topEntities.map((e) => e.recentMentions.hour)),
    [topEntities]
  );
  const maxSixHour = useMemo(
    () => Math.max(1, ...topEntities.map((e) => e.recentMentions.sixHour)),
    [topEntities]
  );
  const maxDay = useMemo(
    () => Math.max(1, ...topEntities.map((e) => e.recentMentions.day)),
    [topEntities]
  );

  const severityCounts = useMemo(() => {
    const c = { critical: 0, warning: 0, advisory: 0 };
    for (const s of activeSignals) c[s.severity]++;
    return c;
  }, [activeSignals]);

  const mutedCount = mutedEntities.size;

  const t = {
    cardBg: dark
      ? "bg-slate-900 border-slate-700"
      : "bg-white border-stone-200",
    summaryBg: dark ? "bg-slate-800/50" : "bg-stone-100",
    summaryText: dark ? "text-slate-300" : "text-stone-700",
    summaryBorder: dark ? "border-slate-700" : "border-stone-300",
    text: dark ? "text-slate-200" : "text-stone-800",
    textMuted: dark ? "text-slate-400" : "text-stone-500",
    entityName: dark
      ? "text-amber-300 hover:text-amber-200"
      : "text-blue-700 hover:text-blue-900",
    tableBorder: dark
      ? "border-slate-700 bg-slate-900"
      : "border-stone-300 bg-white",
    theadBg: dark
      ? "bg-slate-800 border-b border-slate-600"
      : "bg-stone-200 border-b border-stone-300",
    theadText: dark ? "text-slate-300" : "text-stone-700",
    rowAltA: dark ? "bg-slate-900" : "bg-white",
    rowAltB: dark ? "bg-slate-900/60" : "bg-stone-50",
    rowHover: dark ? "hover:bg-slate-800" : "hover:bg-stone-100",
    rowBorder: dark
      ? "border-b border-slate-800"
      : "border-b border-stone-200",
    confidenceBg: dark ? "bg-slate-700" : "bg-stone-200",
    barHour: "bg-amber-500",
    barSixHour: "bg-sky-500",
    barDay: dark ? "bg-slate-500" : "bg-stone-400",
    muteBtnBg: dark
      ? "text-slate-500 hover:text-red-400 hover:bg-red-500/10"
      : "text-stone-400 hover:text-red-600 hover:bg-red-50",
  };

  return (
    <div className="max-w-[1920px] mx-auto px-2 py-2">
      {/* ─── Summary Strip ─── */}
      <div
        className={`flex flex-wrap items-center gap-3 md:gap-6 px-3 md:px-4 py-2 md:py-2.5 mb-2 text-[10px] md:text-xs uppercase tracking-wide ${t.summaryBg} ${t.summaryText} border ${t.summaryBorder}`}
      >
        <span className="font-bold">{activeSignals.length} SIGNALS</span>
        {severityCounts.critical > 0 && (
          <span>
            <span className="text-red-500 font-bold">
              {severityCounts.critical}
            </span>{" "}
            CRITICAL
          </span>
        )}
        {severityCounts.warning > 0 && (
          <span>
            <span className="text-amber-500 font-bold">
              {severityCounts.warning}
            </span>{" "}
            WARNING
          </span>
        )}
        {severityCounts.advisory > 0 && (
          <span>
            <span className="text-yellow-500 font-bold">
              {severityCounts.advisory}
            </span>{" "}
            ADVISORY
          </span>
        )}
        {mutedCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span className={t.textMuted}>
              {mutedCount} MUTED
            </span>
            <button
              onClick={handleUnmuteAll}
              className={`text-[10px] underline ${dark ? "text-slate-500 hover:text-slate-300" : "text-stone-400 hover:text-stone-700"}`}
            >
              CLEAR
            </button>
          </span>
        )}
        <span className={`ml-auto text-[10px] ${t.textMuted}`}>
          {entities.length} ENTITIES ANALYZED
        </span>
      </div>

      {/* ─── Signal Cards ─── */}
      {activeSignals.length > 0 ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 mb-2">
            {visibleSignals.map((signal) => {
              const sc = severityColor(signal.severity, dark);
              return (
                <div
                  key={signal.id}
                  className={`border border-l-4 ${sc.border} ${t.cardBg} px-3 py-2.5`}
                >
                  {/* Header: icon + title + confidence */}
                  <div className="flex items-start gap-2 mb-1.5">
                    <span className={`mt-0.5 flex-shrink-0 ${sc.text}`}>
                      <SignalIcon type={signal.type} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[11px] font-bold uppercase tracking-wide ${sc.text} truncate`}
                        >
                          {signal.title}
                        </span>
                      </div>
                    </div>
                    {/* Confidence bar */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <div
                        className={`w-12 h-1.5 rounded-full overflow-hidden ${t.confidenceBg}`}
                      >
                        <div
                          className={`h-full rounded-full ${sc.bar}`}
                          style={{
                            width: `${signal.confidence * 100}%`,
                          }}
                        />
                      </div>
                      <span className={`text-[9px] ${t.textMuted}`}>
                        {Math.round(signal.confidence * 100)}%
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  <p
                    className={`text-[10px] leading-tight mb-2 ${t.textMuted}`}
                  >
                    {signal.description}
                  </p>

                  {/* Entity chips with mute buttons */}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {signal.entities.map((name) => (
                      <span key={name} className="inline-flex items-center gap-0.5">
                        <button
                          onClick={() => onEntityClick(name)}
                          className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded cursor-pointer hover:underline ${sc.bg} ${sc.text}`}
                        >
                          {name}
                        </button>
                        <button
                          onClick={() => handleMute(name)}
                          className={`text-[10px] px-0.5 py-0.5 rounded transition-colors ${t.muteBtnBg}`}
                          title={`Mute "${name}" for 24h`}
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </span>
                    ))}
                    <span
                      className={`text-[9px] uppercase font-semibold px-1 py-0.5 ${t.textMuted}`}
                    >
                      {signal.type.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Show all toggle */}
          {activeSignals.length > INITIAL_LIMIT && (
            <button
              onClick={() => setShowAll(!showAll)}
              className={`w-full text-center py-1.5 text-[10px] uppercase tracking-wide font-semibold ${t.textMuted} transition-colors`}
            >
              {showAll
                ? "SHOW LESS"
                : `SHOW ALL ${activeSignals.length} SIGNALS`}
            </button>
          )}
        </>
      ) : (
        <div
          className={`text-center py-12 text-xs uppercase tracking-wide ${t.textMuted}`}
        >
          {mutedCount > 0
            ? "ALL SIGNALS MUTED — CLEAR MUTES TO VIEW"
            : "NO SIGNALS DETECTED"}
        </div>
      )}

      {/* ─── Entity Velocity Grid ─── */}
      {topEntities.length > 0 && (
        <>
          <div
            className={`flex items-center gap-3 px-3 py-1.5 mt-2 mb-1 text-[10px] uppercase tracking-wide font-bold ${t.summaryBg} ${t.summaryText} border ${t.summaryBorder}`}
          >
            ENTITY VELOCITY — TOP {topEntities.length}
            <span className={`ml-auto font-normal ${t.textMuted}`}>
              <span className="inline-block w-2 h-2 bg-amber-500 rounded-sm mr-0.5" />{" "}
              1H
              <span className="inline-block w-2 h-2 bg-sky-500 rounded-sm ml-2 mr-0.5" />{" "}
              6H
              <span
                className={`inline-block w-2 h-2 ${t.barDay} rounded-sm ml-2 mr-0.5`}
              />{" "}
              24H
            </span>
          </div>

          {/* Desktop table */}
          <div
            className={`hidden md:block border overflow-auto ${t.tableBorder}`}
          >
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10">
                <tr className={t.theadBg}>
                  <th
                    className={`min-w-[160px] px-3 py-2 text-left text-xs font-bold uppercase tracking-wider ${t.theadText}`}
                  >
                    ENTITY
                  </th>
                  <th
                    className={`w-32 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider ${t.theadText}`}
                  >
                    1H
                  </th>
                  <th
                    className={`w-32 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider ${t.theadText}`}
                  >
                    6H
                  </th>
                  <th
                    className={`w-32 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider ${t.theadText}`}
                  >
                    24H
                  </th>
                  <th
                    className={`w-16 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider ${t.theadText}`}
                  >
                    TONE
                  </th>
                  <th
                    className={`w-24 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider ${t.theadText}`}
                  >
                    URGENCY
                  </th>
                </tr>
              </thead>
              <tbody>
                {topEntities.map((entity, idx) => (
                  <tr
                    key={entity.name}
                    className={`${idx % 2 === 0 ? t.rowAltA : t.rowAltB} ${t.rowHover} transition-colors ${t.rowBorder}`}
                  >
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => onEntityClick(entity.name)}
                        className={`text-xs font-bold uppercase cursor-pointer hover:underline ${t.entityName}`}
                      >
                        {entity.name}
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <div
                          className={`h-2.5 rounded-sm ${t.barHour}`}
                          style={{
                            width: `${(entity.recentMentions.hour / maxHour) * 80}px`,
                          }}
                        />
                        <span
                          className={`text-[10px] ${entity.recentMentions.hour > 0 ? "text-amber-500 font-bold" : t.textMuted}`}
                        >
                          {entity.recentMentions.hour}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <div
                          className={`h-2.5 rounded-sm ${t.barSixHour}`}
                          style={{
                            width: `${(entity.recentMentions.sixHour / maxSixHour) * 80}px`,
                          }}
                        />
                        <span className={`text-[10px] ${t.textMuted}`}>
                          {entity.recentMentions.sixHour}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <div
                          className={`h-2.5 rounded-sm ${t.barDay}`}
                          style={{
                            width: `${(entity.recentMentions.day / maxDay) * 80}px`,
                          }}
                        />
                        <span className={`text-[10px] ${t.textMuted}`}>
                          {entity.recentMentions.day}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <SentimentBadge value={entity.sentiment} dark={dark} />
                    </td>
                    <td className="px-3 py-1.5">
                      <UrgencyMiniBar
                        breakdown={entity.urgencyBreakdown}
                        total={entity.mentions}
                        dark={dark}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-1.5">
            {topEntities.map((entity) => (
              <div
                key={entity.name}
                className={`border px-3 py-2 ${t.cardBg}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <button
                    onClick={() => onEntityClick(entity.name)}
                    className={`text-xs font-bold uppercase cursor-pointer hover:underline ${t.entityName}`}
                  >
                    {entity.name}
                  </button>
                  <SentimentBadge value={entity.sentiment} dark={dark} />
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-1">
                      <span className={`text-[9px] w-4 ${t.textMuted}`}>
                        1H
                      </span>
                      <div
                        className={`h-2 rounded-sm flex-1 ${t.confidenceBg}`}
                      >
                        <div
                          className={`h-full rounded-sm ${t.barHour}`}
                          style={{
                            width: `${(entity.recentMentions.hour / maxHour) * 100}%`,
                          }}
                        />
                      </div>
                      <span
                        className={`text-[9px] w-4 text-right ${entity.recentMentions.hour > 0 ? "text-amber-500 font-bold" : t.textMuted}`}
                      >
                        {entity.recentMentions.hour}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-[9px] w-4 ${t.textMuted}`}>
                        6H
                      </span>
                      <div
                        className={`h-2 rounded-sm flex-1 ${t.confidenceBg}`}
                      >
                        <div
                          className={`h-full rounded-sm ${t.barSixHour}`}
                          style={{
                            width: `${(entity.recentMentions.sixHour / maxSixHour) * 100}%`,
                          }}
                        />
                      </div>
                      <span
                        className={`text-[9px] w-4 text-right ${t.textMuted}`}
                      >
                        {entity.recentMentions.sixHour}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-[9px] w-4 ${t.textMuted}`}>
                        24H
                      </span>
                      <div
                        className={`h-2 rounded-sm flex-1 ${t.confidenceBg}`}
                      >
                        <div
                          className={`h-full rounded-sm ${t.barDay}`}
                          style={{
                            width: `${(entity.recentMentions.day / maxDay) * 100}%`,
                          }}
                        />
                      </div>
                      <span
                        className={`text-[9px] w-4 text-right ${t.textMuted}`}
                      >
                        {entity.recentMentions.day}
                      </span>
                    </div>
                  </div>
                  <UrgencyMiniBar
                    breakdown={entity.urgencyBreakdown}
                    total={entity.mentions}
                    dark={dark}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
