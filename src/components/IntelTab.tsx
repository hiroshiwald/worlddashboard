"use client";

import { useMemo, useState } from "react";
import { FeedItem, ExtractedEntity, EntityType } from "@/lib/types";
import { extractEntities } from "@/lib/entity-extractor";

interface IntelTabProps {
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

type SortKey =
  | "name"
  | "type"
  | "mentions"
  | "recentHour"
  | "lastSeen"
  | "urgency"
  | "cooccurrences"
  | "sentiment";

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 0) return "NOW";
  if (secs < 5) return "NOW";
  if (secs < 60) return `${secs}s AGO`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h AGO`;
  const days = Math.floor(hrs / 24);
  return `${days}d AGO`;
}

function typeLabel(t: EntityType): string {
  switch (t) {
    case "country":
      return "COUNTRY";
    case "organization":
      return "ORG";
    case "region":
      return "REGION";
    case "person":
      return "PERSON";
  }
}

function SentimentBadge({ value, dark }: { value: number; dark: boolean }) {
  const abs = Math.abs(value);
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
    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${colorClass}`} title={`Sentiment: ${value.toFixed(2)}`}>
      {label}
    </span>
  );
}

function UrgencyBar({
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
    <div className="flex items-center gap-1">
      <div
        className="flex h-2.5 w-16 md:w-20 overflow-hidden"
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
    </div>
  );
}

export default function IntelTab({
  items,
  dark,
  onEntityClick,
}: IntelTabProps) {
  const entities = useMemo(() => extractEntities(items), [items]);

  const [sortKey, setSortKey] = useState<SortKey>("mentions");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [typeFilter, setTypeFilter] = useState<EntityType | "all">("all");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const filtered = useMemo(() => {
    let result = entities;
    if (typeFilter !== "all") {
      result = result.filter((e) => e.type === typeFilter);
    }
    return result;
  }, [entities, typeFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp: number;
      const urgencyPriority: Record<string, number> = {
        critical: 6, warning: 5, advisory: 4, monitoring: 3, system: 2, neutral: 1,
      };
      const getMaxUrgency = (e: ExtractedEntity) => {
        for (const level of ["critical", "warning", "advisory", "monitoring", "system", "neutral"] as const) {
          if (e.urgencyBreakdown[level] > 0) return urgencyPriority[level];
        }
        return 0;
      };
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "type":
          cmp = a.type.localeCompare(b.type);
          break;
        case "mentions":
          cmp = a.mentions - b.mentions;
          break;
        case "recentHour":
          cmp = a.recentMentions.hour - b.recentMentions.hour;
          break;
        case "lastSeen":
          cmp =
            new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime();
          break;
        case "urgency":
          cmp = getMaxUrgency(a) - getMaxUrgency(b);
          break;
        case "cooccurrences":
          cmp = a.cooccurrences.length - b.cooccurrences.length;
          break;
        case "sentiment":
          cmp = a.sentiment - b.sentiment;
          break;
        default:
          cmp = 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const getSortArrow = (key: SortKey): string => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  const counts = useMemo(() => {
    const c = { country: 0, organization: 0, region: 0, person: 0 };
    for (const e of entities) {
      c[e.type]++;
    }
    return c;
  }, [entities]);

  const t = {
    tableBorder: dark
      ? "border-slate-700 bg-slate-900"
      : "border-stone-300 bg-white",
    theadBg: dark
      ? "bg-slate-800 border-b border-slate-600"
      : "bg-stone-200 border-b border-stone-300",
    theadText: dark
      ? "text-slate-300 hover:text-white"
      : "text-stone-700 hover:text-stone-900",
    rowAltA: dark ? "bg-slate-900" : "bg-white",
    rowAltB: dark ? "bg-slate-900/60" : "bg-stone-50",
    rowHover: dark ? "hover:bg-slate-800" : "hover:bg-stone-100",
    rowBorder: dark
      ? "border-b border-slate-800"
      : "border-b border-stone-200",
    text: dark ? "text-slate-200" : "text-stone-800",
    textMuted: dark ? "text-slate-400" : "text-stone-500",
    entityName: dark
      ? "text-amber-300 hover:text-amber-200"
      : "text-blue-700 hover:text-blue-900",
    typeBadge: (type: EntityType) => {
      if (dark) {
        switch (type) {
          case "country":
            return "text-emerald-400";
          case "organization":
            return "text-violet-400";
          case "region":
            return "text-cyan-400";
          case "person":
            return "text-orange-400";
        }
      } else {
        switch (type) {
          case "country":
            return "text-emerald-700";
          case "organization":
            return "text-violet-700";
          case "region":
            return "text-cyan-700";
          case "person":
            return "text-orange-700";
        }
      }
    },
    summaryBg: dark ? "bg-slate-800/50" : "bg-stone-100",
    summaryText: dark ? "text-slate-300" : "text-stone-700",
    filterBg: dark
      ? "bg-slate-800 border-slate-600 text-slate-200"
      : "bg-stone-800 border-stone-600 text-stone-200",
    cardBg: dark
      ? "bg-slate-900 border-slate-700"
      : "bg-white border-stone-200",
  };

  return (
    <div className="max-w-[1920px] mx-auto px-2 py-2">
      {/* Summary strip */}
      <div
        className={`flex flex-wrap items-center gap-3 md:gap-6 px-3 md:px-4 py-2 md:py-2.5 mb-2 text-[10px] md:text-xs uppercase tracking-wide ${t.summaryBg} ${t.summaryText} border ${dark ? "border-slate-700" : "border-stone-300"}`}
      >
        <span className="font-bold">{entities.length} ENTITIES</span>
        <span>
          <span className="text-emerald-500">{counts.country}</span> CTRY
        </span>
        <span>
          <span className="text-violet-500">{counts.organization}</span> ORG
        </span>
        <span>
          <span className="text-orange-500">{counts.person}</span> PERS
        </span>
        <span>
          <span className="text-cyan-500">{counts.region}</span> REG
        </span>
        <select
          value={typeFilter}
          onChange={(e) =>
            setTypeFilter(e.target.value as EntityType | "all")
          }
          className={`ml-auto px-1.5 md:px-2 py-0.5 md:py-1 text-[10px] md:text-xs border focus:outline-none cursor-pointer uppercase ${t.filterBg}`}
        >
          <option value="all">ALL TYPES</option>
          <option value="country">COUNTRIES</option>
          <option value="organization">ORGS</option>
          <option value="person">PERSONS</option>
          <option value="region">REGIONS</option>
        </select>
      </div>

      {/* ─── Desktop: Entity table ─── */}
      <div
        className={`hidden md:block border overflow-auto ${t.tableBorder}`}
      >
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr className={t.theadBg}>
              <th
                onClick={() => handleSort("name")}
                className={`min-w-[180px] px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                ENTITY{getSortArrow("name")}
              </th>
              <th
                onClick={() => handleSort("type")}
                className={`w-24 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                TYPE{getSortArrow("type")}
              </th>
              <th
                onClick={() => handleSort("mentions")}
                className={`w-24 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                MENTIONS{getSortArrow("mentions")}
              </th>
              <th
                onClick={() => handleSort("urgency")}
                className={`w-32 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                URGENCY{getSortArrow("urgency")}
              </th>
              <th
                onClick={() => handleSort("recentHour")}
                className={`w-20 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                1H{getSortArrow("recentHour")}
              </th>
              <th
                onClick={() => handleSort("sentiment")}
                className={`w-20 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                TONE{getSortArrow("sentiment")}
              </th>
              <th
                onClick={() => handleSort("lastSeen")}
                className={`w-28 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                LAST SEEN{getSortArrow("lastSeen")}
              </th>
              <th
                onClick={() => handleSort("cooccurrences")}
                className={`min-w-[200px] px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                CO-OCCURS WITH{getSortArrow("cooccurrences")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entity, idx) => (
              <tr
                key={entity.name}
                className={`${
                  idx % 2 === 0 ? t.rowAltA : t.rowAltB
                } ${t.rowHover} transition-colors ${t.rowBorder}`}
              >
                <td className="px-3 py-2">
                  <button
                    onClick={() => onEntityClick(entity.name)}
                    className={`text-xs font-bold uppercase cursor-pointer hover:underline ${t.entityName}`}
                    title={`Filter feeds for "${entity.name}"`}
                  >
                    {entity.name}
                  </button>
                </td>
                <td
                  className={`px-3 py-2 text-xs font-semibold ${t.typeBadge(entity.type)}`}
                >
                  {typeLabel(entity.type)}
                </td>
                <td className={`px-3 py-2 text-xs font-bold ${t.text}`}>
                  {entity.mentions}
                </td>
                <td className="px-3 py-2">
                  <UrgencyBar
                    breakdown={entity.urgencyBreakdown}
                    total={entity.mentions}
                    dark={dark}
                  />
                </td>
                <td className={`px-3 py-2 text-xs ${t.text}`}>
                  {entity.recentMentions.hour > 0 ? (
                    <span className="text-amber-500 font-bold">
                      +{entity.recentMentions.hour}
                    </span>
                  ) : (
                    <span className={t.textMuted}>—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <SentimentBadge value={entity.sentiment} dark={dark} />
                </td>
                <td
                  className={`px-3 py-2 text-xs whitespace-nowrap ${t.textMuted}`}
                >
                  {timeAgo(entity.lastSeen)}
                </td>
                <td className={`px-3 py-2 text-xs ${t.textMuted}`}>
                  {entity.cooccurrences.length > 0
                    ? entity.cooccurrences
                        .slice(0, 3)
                        .map(([name, count]) => (
                          <button
                            key={name}
                            onClick={() => onEntityClick(name)}
                            className={`inline-block mr-2 cursor-pointer hover:underline ${t.entityName}`}
                            title={`${count} co-occurrences`}
                          >
                            {name.toUpperCase()}
                            <span className="opacity-50 ml-0.5">
                              ({count})
                            </span>
                          </button>
                        ))
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ─── Mobile: Entity cards ─── */}
      <div className="md:hidden space-y-1.5">
        {sorted.map((entity) => (
          <div
            key={entity.name}
            className={`border px-3 py-2.5 ${t.cardBg}`}
          >
            {/* Row 1: entity name + type badge */}
            <div className="flex items-center justify-between mb-1.5">
              <button
                onClick={() => onEntityClick(entity.name)}
                className={`text-xs font-bold uppercase cursor-pointer hover:underline ${t.entityName}`}
              >
                {entity.name}
              </button>
              <span
                className={`text-[10px] font-semibold ${t.typeBadge(entity.type)}`}
              >
                {typeLabel(entity.type)}
              </span>
            </div>

            {/* Row 2: mentions, urgency bar, trend */}
            <div className="flex items-center gap-3 mb-1.5">
              <span className={`text-xs font-bold ${t.text}`}>
                {entity.mentions} MENTIONS
              </span>
              <UrgencyBar
                breakdown={entity.urgencyBreakdown}
                total={entity.mentions}
                dark={dark}
              />
              {entity.recentMentions.hour > 0 && (
                <span className="text-amber-500 text-xs font-bold">
                  +{entity.recentMentions.hour} 1H
                </span>
              )}
              <SentimentBadge value={entity.sentiment} dark={dark} />
              <span className={`text-[10px] ml-auto ${t.textMuted}`}>
                {timeAgo(entity.lastSeen)}
              </span>
            </div>

            {/* Row 3: co-occurrences */}
            {entity.cooccurrences.length > 0 && (
              <div className={`flex flex-wrap gap-2 text-[10px] ${t.textMuted}`}>
                {entity.cooccurrences.slice(0, 3).map(([name, count]) => (
                  <button
                    key={name}
                    onClick={() => onEntityClick(name)}
                    className={`cursor-pointer hover:underline ${t.entityName}`}
                  >
                    {name.toUpperCase()} ({count})
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {sorted.length === 0 && (
        <div className={`text-center py-12 text-xs uppercase ${t.textMuted}`}>
          NO ENTITIES WITH 2+ MENTIONS
        </div>
      )}
    </div>
  );
}
