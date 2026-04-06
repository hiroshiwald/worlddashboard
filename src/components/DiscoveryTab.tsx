"use client";

import { useMemo, useState, useCallback } from "react";
import { FeedItem, EnrichedEntity, NoveltyReasonType, EntityType } from "@/lib/types";
import { extractEntities } from "@/lib/entity-extractor";
import { enrichEntities } from "@/lib/novelty-scorer";
import { loadEdgeHistory, edgeKey } from "@/lib/signal-storage";

interface DiscoveryTabProps {
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

type EdgeMode = "all" | "novel" | "none";

const TYPE_DOT_COLORS: Record<string, { dark: string; light: string }> = {
  novel_edge: { dark: "#2dd4bf", light: "#0d9488" },     // teal
  entity_emergence: { dark: "#fbbf24", light: "#d97706" }, // amber
  category_crossover: { dark: "#fb923c", light: "#ea580c" }, // coral
  quiet_mover: { dark: "#a78bfa", light: "#7c3aed" },     // purple
  baseline_surprise: { dark: "#60a5fa", light: "#2563eb" }, // blue
  negative: { dark: "#f87171", light: "#dc2626" },         // red
  default: { dark: "#64748b", light: "#94a3b8" },          // gray
};

function getDotColor(entity: EnrichedEntity, dark: boolean): string {
  if (entity.noveltyReasons.length > 0) {
    const topType = entity.noveltyReasons[0].type;
    const colors = TYPE_DOT_COLORS[topType] || TYPE_DOT_COLORS.default;
    return dark ? colors.dark : colors.light;
  }
  if (entity.sentiment < -0.3) {
    return dark ? TYPE_DOT_COLORS.negative.dark : TYPE_DOT_COLORS.negative.light;
  }
  return dark ? TYPE_DOT_COLORS.default.dark : TYPE_DOT_COLORS.default.light;
}

export default function DiscoveryTab({ items, dark, onEntityClick }: DiscoveryTabProps) {
  const entities = useMemo(() => extractEntities(items), [items]);
  const enriched = useMemo(() => enrichEntities(entities, items), [entities, items]);

  const [edgeMode, setEdgeMode] = useState<EdgeMode>("novel");
  const [typeFilter, setTypeFilter] = useState<Set<EntityType>>(
    new Set(["country", "organization", "person", "region"])
  );
  const [minMentions, setMinMentions] = useState(2);
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const edgeHistory = useMemo(() => loadEdgeHistory(), []);

  const filteredEntities = useMemo(
    () => enriched.filter((e) => typeFilter.has(e.type) && e.mentions >= minMentions),
    [enriched, typeFilter, minMentions]
  );

  // Compute positions
  const maxCat = useMemo(() => Math.max(1, ...filteredEntities.map((e) => e.categorySpread)), [filteredEntities]);
  const maxMentions = useMemo(() => Math.max(1, ...filteredEntities.map((e) => e.mentions)), [filteredEntities]);

  const entityPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; size: number }>();
    for (const e of filteredEntities) {
      const xPct = ((e.categorySpread - 1) / Math.max(1, maxCat - 1)) * 90 + 5; // 5-95%
      const yPct = (1 - Math.log(e.mentions + 1) / Math.log(maxMentions + 1)) * 85 + 5; // 5-90% (inverted, log scale)
      const size = Math.max(8, Math.min(32, 8 + (e.sourceCount / Math.max(1, ...filteredEntities.map((f) => f.sourceCount))) * 24));
      positions.set(e.name, { x: xPct, y: yPct, size });
    }
    return positions;
  }, [filteredEntities, maxCat, maxMentions]);

  // Build edges
  const edges = useMemo(() => {
    if (edgeMode === "none") return [];
    const edgeList: { from: string; to: string; count: number; novel: boolean }[] = [];
    const seen = new Set<string>();
    const posNames = new Set(entityPositions.keys());

    for (const e of filteredEntities) {
      for (const [coName, count] of e.cooccurrences) {
        if (!posNames.has(coName)) continue;
        const key = edgeKey(e.name, coName);
        if (seen.has(key)) continue;
        seen.add(key);

        const isNovel = !edgeHistory.has(key);
        if (edgeMode === "novel" && !isNovel) continue;

        edgeList.push({ from: e.name, to: coName, count, novel: isNovel });
      }
    }
    return edgeList;
  }, [filteredEntities, edgeMode, edgeHistory, entityPositions]);

  const toggleType = useCallback((type: EntityType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleDotHover = useCallback((name: string | null, e?: React.MouseEvent) => {
    setHoveredEntity(name);
    if (e && name) {
      const rect = (e.currentTarget as HTMLElement).closest(".scatter-container")?.getBoundingClientRect();
      if (rect) {
        setTooltipPos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    }
  }, []);

  // Item lookup for tooltip
  const itemMap = useMemo(() => {
    const map = new Map<string, FeedItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const entityLookup = useMemo(() => {
    const map = new Map<string, EnrichedEntity>();
    for (const e of filteredEntities) map.set(e.name, e);
    return map;
  }, [filteredEntities]);

  const hoveredEntityData = hoveredEntity ? entityLookup.get(hoveredEntity) : null;
  const hoveredLatestArticle = useMemo(() => {
    if (!hoveredEntityData) return null;
    let latest: FeedItem | null = null;
    let latestTime = 0;
    for (const id of hoveredEntityData.itemIds) {
      const item = itemMap.get(id);
      if (item) {
        const t = new Date(item.published).getTime();
        if (t > latestTime) { latestTime = t; latest = item; }
      }
    }
    return latest;
  }, [hoveredEntityData, itemMap]);

  const t = {
    bg: dark ? "bg-slate-950" : "bg-white",
    text: dark ? "text-slate-200" : "text-gray-800",
    textMuted: dark ? "text-slate-400" : "text-gray-500",
    textFaint: dark ? "text-slate-600" : "text-gray-300",
    controlBg: dark ? "bg-slate-900 border-slate-700" : "bg-gray-50 border-gray-200",
    controlActive: dark ? "bg-slate-700 text-slate-200" : "bg-gray-200 text-gray-800",
    controlInactive: dark ? "bg-transparent text-slate-500 hover:text-slate-300" : "bg-transparent text-gray-400 hover:text-gray-700",
    tooltipBg: dark ? "bg-slate-800 border-slate-600" : "bg-white border-gray-200 shadow-lg",
    legendBg: dark ? "bg-slate-900/80" : "bg-gray-50/80",
  };

  const entityTypes: EntityType[] = ["country", "organization", "person", "region"];

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      {/* ─── Controls Bar ─── */}
      <div className={`flex flex-wrap items-center gap-3 px-4 py-3 mb-4 rounded-xl border ${t.controlBg}`}>
        {/* Edge toggle */}
        <div className="flex items-center gap-1">
          <span className={`text-[10px] font-semibold uppercase mr-1.5 ${t.textMuted}`}>Edges</span>
          {(["all", "novel", "none"] as EdgeMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setEdgeMode(mode)}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                edgeMode === mode ? t.controlActive : t.controlInactive
              }`}
            >
              {mode === "novel" ? "Novel only" : mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Entity type filter */}
        <div className="flex items-center gap-1 ml-2">
          <span className={`text-[10px] font-semibold uppercase mr-1.5 ${t.textMuted}`}>Type</span>
          {entityTypes.map((type) => (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors capitalize ${
                typeFilter.has(type) ? t.controlActive : t.controlInactive
              }`}
            >
              {type === "organization" ? "Org" : type}
            </button>
          ))}
        </div>

        {/* Min mentions slider */}
        <div className="flex items-center gap-2 ml-auto">
          <span className={`text-[10px] font-semibold uppercase ${t.textMuted}`}>Min mentions</span>
          <input
            type="range"
            min={2}
            max={20}
            value={minMentions}
            onChange={(e) => setMinMentions(Number(e.target.value))}
            className="w-20 accent-emerald-500"
          />
          <span className={`text-xs font-semibold w-5 ${t.text}`}>{minMentions}</span>
        </div>
      </div>

      {/* ─── Scatter Plot ─── */}
      <div className={`relative rounded-xl border overflow-hidden ${dark ? "border-slate-800" : "border-gray-200"} ${t.bg} scatter-container`} style={{ height: 380 }}>
        {/* Quadrant labels */}
        <span className={`absolute top-3 left-4 text-[10px] italic ${t.textFaint}`}>High volume, narrow focus</span>
        <span className={`absolute top-3 right-4 text-[10px] italic ${t.textFaint}`}>High volume, wide spread</span>
        <span className={`absolute bottom-3 left-4 text-[10px] italic ${t.textFaint}`}>Low volume, narrow focus</span>
        <span className={`absolute bottom-3 right-4 text-[10px] italic font-medium ${dark ? "text-emerald-700" : "text-emerald-400"}`}>Low volume, wide spread</span>

        {/* Axis labels */}
        <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] ${t.textFaint}`}>Category spread &rarr;</span>
        <span className={`absolute top-1/2 left-1 -translate-y-1/2 text-[10px] ${t.textFaint}`} style={{ writingMode: "vertical-rl", transform: "rotate(180deg) translateY(50%)" }}>&larr; Mention count</span>

        {/* SVG edges */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
          {edges.map((edge, i) => {
            const fromPos = entityPositions.get(edge.from);
            const toPos = entityPositions.get(edge.to);
            if (!fromPos || !toPos) return null;

            const isHighlighted = hoveredEntity === edge.from || hoveredEntity === edge.to;
            const opacity = hoveredEntity
              ? isHighlighted ? 0.8 : 0.05
              : edge.novel ? 0.7 : 0.3;
            const strokeWidth = edge.novel ? 1.5 : Math.max(0.5, Math.min(3, Math.sqrt(edge.count) * 0.5));
            const stroke = edge.novel
              ? (dark ? "#2dd4bf" : "#0d9488")
              : (dark ? "rgba(148,163,184,0.4)" : "rgba(107,114,128,0.4)");

            return (
              <line
                key={i}
                x1={`${fromPos.x}%`}
                y1={`${fromPos.y}%`}
                x2={`${toPos.x}%`}
                y2={`${toPos.y}%`}
                stroke={stroke}
                strokeWidth={strokeWidth}
                opacity={opacity}
              />
            );
          })}
        </svg>

        {/* Entity dots */}
        {filteredEntities.map((entity) => {
          const pos = entityPositions.get(entity.name);
          if (!pos) return null;
          const color = getDotColor(entity, dark);
          const isHovered = hoveredEntity === entity.name;
          const dimmed = hoveredEntity && !isHovered;

          return (
            <div
              key={entity.name}
              className="absolute cursor-pointer transition-all duration-150"
              style={{
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                width: pos.size,
                height: pos.size,
                marginLeft: -pos.size / 2,
                marginTop: -pos.size / 2,
                borderRadius: "50%",
                backgroundColor: color,
                opacity: dimmed ? 0.2 : 1,
                transform: isHovered ? "scale(1.3)" : "scale(1)",
                zIndex: isHovered ? 20 : 2,
                boxShadow: isHovered ? `0 0 8px ${color}` : "none",
              }}
              onMouseEnter={(e) => handleDotHover(entity.name, e)}
              onMouseLeave={() => handleDotHover(null)}
              onClick={() => onEntityClick(entity.name)}
              title={entity.name}
            >
              {/* Label for larger dots or hovered */}
              {(pos.size >= 16 || isHovered) && (
                <span
                  className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold pointer-events-none ${t.text}`}
                  style={{ top: pos.size + 2 }}
                >
                  {entity.name}
                </span>
              )}
            </div>
          );
        })}

        {/* Tooltip */}
        {hoveredEntityData && (
          <div
            className={`absolute z-30 px-3 py-2 rounded-lg border text-xs pointer-events-none ${t.tooltipBg}`}
            style={{
              left: Math.min(tooltipPos.x + 12, (typeof window !== "undefined" ? window.innerWidth * 0.7 : 600)),
              top: tooltipPos.y - 10,
              maxWidth: 260,
            }}
          >
            <div className={`font-bold mb-1 ${t.text}`}>{hoveredEntityData.name}</div>
            <div className={t.textMuted}>
              {hoveredEntityData.mentions} mentions &middot; {hoveredEntityData.categorySpread} categories &middot; {hoveredEntityData.sourceCount} sources
            </div>
            {hoveredEntityData.noveltyReasons[0] && (
              <div className={`mt-1 ${dark ? "text-emerald-400" : "text-emerald-700"}`}>
                {hoveredEntityData.noveltyReasons[0].label}
              </div>
            )}
            {hoveredLatestArticle && (
              <div className={`mt-1 truncate ${t.textMuted}`}>
                {hoveredLatestArticle.title}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Legend ─── */}
      <div className={`flex flex-wrap items-center gap-4 mt-3 px-4 py-2 rounded-lg text-[10px] ${t.legendBg} ${t.textMuted}`}>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: dark ? TYPE_DOT_COLORS.novel_edge.dark : TYPE_DOT_COLORS.novel_edge.light }} />
          Novel Link
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: dark ? TYPE_DOT_COLORS.entity_emergence.dark : TYPE_DOT_COLORS.entity_emergence.light }} />
          New Entity
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: dark ? TYPE_DOT_COLORS.category_crossover.dark : TYPE_DOT_COLORS.category_crossover.light }} />
          Cross-Category
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: dark ? TYPE_DOT_COLORS.quiet_mover.dark : TYPE_DOT_COLORS.quiet_mover.light }} />
          Quiet Mover
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: dark ? TYPE_DOT_COLORS.baseline_surprise.dark : TYPE_DOT_COLORS.baseline_surprise.light }} />
          Spiking
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: dark ? TYPE_DOT_COLORS.default.dark : TYPE_DOT_COLORS.default.light }} />
          Established
        </span>
      </div>
    </div>
  );
}
