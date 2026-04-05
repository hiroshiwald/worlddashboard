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

function typeLabel(t: EntityType): string {
  switch (t) {
    case "country":
      return "Country";
    case "organization":
      return "Org";
    case "region":
      return "Region";
    case "person":
      return "Person";
  }
}

function typeBadgeClasses(type: EntityType, dark: boolean): string {
  if (dark) {
    switch (type) {
      case "country":
        return "text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "organization":
        return "text-violet-400 bg-violet-500/15 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "region":
        return "text-cyan-400 bg-cyan-500/15 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "person":
        return "text-orange-400 bg-orange-500/15 px-2 py-0.5 rounded-full text-[10px] font-semibold";
    }
  } else {
    switch (type) {
      case "country":
        return "text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "organization":
        return "text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "region":
        return "text-cyan-700 bg-cyan-100 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "person":
        return "text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full text-[10px] font-semibold";
    }
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
    colorClass = dark ? "text-slate-400 bg-slate-500/10" : "text-gray-500 bg-gray-100";
  }

  return (
    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${colorClass}`} title={`Sentiment: ${value.toFixed(2)}`}>
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
      color: dark ? "bg-slate-600" : "bg-gray-300",
    },
  ].filter((s) => s.count > 0);

  return (
    <div className="flex items-center gap-1.5">
      <div
        className="flex h-3 w-20 md:w-24 rounded-full overflow-hidden"
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
      ? "bg-slate-900"
      : "bg-white",
    theadBg: dark
      ? "bg-slate-800/60 border-b border-slate-700"
      : "bg-gray-50/80 border-b border-gray-200",
    theadText: dark
      ? "text-slate-400 hover:text-slate-200"
      : "text-gray-500 hover:text-gray-700",
    rowAltA: dark ? "bg-slate-900" : "bg-white",
    rowAltB: dark ? "bg-slate-900/60" : "bg-gray-50/50",
    rowHover: dark ? "hover:bg-slate-800/80" : "hover:bg-blue-50/40",
    rowBorder: dark
      ? "border-b border-slate-800/60"
      : "border-b border-gray-100",
    text: dark ? "text-slate-200" : "text-gray-800",
    textMuted: dark ? "text-slate-400" : "text-gray-500",
    entityName: dark
      ? "text-blue-400 hover:text-blue-300"
      : "text-blue-600 hover:text-blue-700",
    summaryBg: dark ? "bg-slate-900 shadow-lg shadow-black/20" : "bg-white shadow-sm",
    summaryText: dark ? "text-slate-300" : "text-gray-700",
    filterBg: dark
      ? "bg-slate-800 border-slate-700 text-slate-200"
      : "bg-gray-100 border-gray-200 text-gray-700",
    cardBg: dark
      ? "bg-slate-900 border-slate-700"
      : "bg-white border-gray-100 shadow-sm",
  };

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      {/* Summary strip */}
      <div
        className={`flex flex-wrap items-center gap-4 md:gap-6 px-4 md:px-5 py-3 mb-4 text-xs rounded-xl ${t.summaryBg} ${t.summaryText}`}
      >
        <span className="font-bold text-sm">{entities.length} Entities</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="font-semibold">{counts.country}</span> Countries
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-violet-500" />
          <span className="font-semibold">{counts.organization}</span> Orgs
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-orange-500" />
          <span className="font-semibold">{counts.person}</span> Persons
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-cyan-500" />
          <span className="font-semibold">{counts.region}</span> Regions
        </span>
        <select
          value={typeFilter}
          onChange={(e) =>
            setTypeFilter(e.target.value as EntityType | "all")
          }
          className={`ml-auto px-3 py-1.5 text-xs border rounded-lg focus:outline-none cursor-pointer ${t.filterBg}`}
        >
          <option value="all">All Types</option>
          <option value="country">Countries</option>
          <option value="organization">Orgs</option>
          <option value="person">Persons</option>
          <option value="region">Regions</option>
        </select>
      </div>

      {/* ─── Desktop: Entity table ─── */}
      <div
        className={`hidden md:block rounded-xl overflow-hidden shadow-sm ${dark ? "shadow-black/20" : ""} ${t.tableBorder}`}
      >
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className={t.theadBg}>
              <th
                onClick={() => handleSort("name")}
                className={`min-w-[180px] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                Entity{getSortArrow("name")}
              </th>
              <th
                onClick={() => handleSort("type")}
                className={`w-24 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                Type{getSortArrow("type")}
              </th>
              <th
                onClick={() => handleSort("mentions")}
                className={`w-24 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                Mentions{getSortArrow("mentions")}
              </th>
              <th
                onClick={() => handleSort("urgency")}
                className={`w-36 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                Urgency{getSortArrow("urgency")}
              </th>
              <th
                onClick={() => handleSort("recentHour")}
                className={`w-20 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                1H{getSortArrow("recentHour")}
              </th>
              <th
                onClick={() => handleSort("sentiment")}
                className={`w-20 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                Tone{getSortArrow("sentiment")}
              </th>
              <th
                onClick={() => handleSort("lastSeen")}
                className={`w-28 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                Last Seen{getSortArrow("lastSeen")}
              </th>
              <th
                onClick={() => handleSort("cooccurrences")}
                className={`min-w-[200px] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
              >
                Co-occurs With{getSortArrow("cooccurrences")}
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
                <td className="px-4 py-3">
                  <button
                    onClick={() => onEntityClick(entity.name)}
                    className={`text-sm font-semibold cursor-pointer hover:underline ${t.entityName}`}
                    title={`Filter feeds for "${entity.name}"`}
                  >
                    {entity.name}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <span className={typeBadgeClasses(entity.type, dark)}>
                    {typeLabel(entity.type)}
                  </span>
                </td>
                <td className={`px-4 py-3 text-sm font-semibold ${t.text}`}>
                  {entity.mentions}
                </td>
                <td className="px-4 py-3">
                  <UrgencyBar
                    breakdown={entity.urgencyBreakdown}
                    total={entity.mentions}
                    dark={dark}
                  />
                </td>
                <td className={`px-4 py-3 text-sm ${t.text}`}>
                  {entity.recentMentions.hour > 0 ? (
                    <span className="text-amber-500 font-bold">
                      +{entity.recentMentions.hour}
                    </span>
                  ) : (
                    <span className={t.textMuted}>—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <SentimentBadge value={entity.sentiment} dark={dark} />
                </td>
                <td
                  className={`px-4 py-3 text-xs whitespace-nowrap ${t.textMuted}`}
                >
                  {timeAgo(entity.lastSeen)}
                </td>
                <td className={`px-4 py-3 text-xs ${t.textMuted}`}>
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
                            {name}
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
      <div className="md:hidden space-y-2">
        {sorted.map((entity) => (
          <div
            key={entity.name}
            className={`border rounded-xl px-4 py-3 ${t.cardBg}`}
          >
            {/* Row 1: entity name + type badge */}
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => onEntityClick(entity.name)}
                className={`text-sm font-semibold cursor-pointer hover:underline ${t.entityName}`}
              >
                {entity.name}
              </button>
              <span className={typeBadgeClasses(entity.type, dark)}>
                {typeLabel(entity.type)}
              </span>
            </div>

            {/* Row 2: mentions, urgency bar, trend */}
            <div className="flex items-center gap-3 mb-2">
              <span className={`text-sm font-semibold ${t.text}`}>
                {entity.mentions} mentions
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
              <span className={`text-xs ml-auto ${t.textMuted}`}>
                {timeAgo(entity.lastSeen)}
              </span>
            </div>

            {/* Row 3: co-occurrences */}
            {entity.cooccurrences.length > 0 && (
              <div className={`flex flex-wrap gap-2 text-xs ${t.textMuted}`}>
                {entity.cooccurrences.slice(0, 3).map(([name, count]) => (
                  <button
                    key={name}
                    onClick={() => onEntityClick(name)}
                    className={`cursor-pointer hover:underline ${t.entityName}`}
                  >
                    {name} ({count})
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {sorted.length === 0 && (
        <div className={`text-center py-12 text-sm ${t.textMuted}`}>
          No entities with 2+ mentions
        </div>
      )}
    </div>
  );
}
