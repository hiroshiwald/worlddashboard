import { EnrichedEntity, FeedItem } from "@/lib/types";
import { EdgeData, DiscoveryTabTheme } from "@/hooks/useDiscoveryTab";
import { getDotColor } from "./utils";

interface ScatterPlotProps {
  filteredEntities: EnrichedEntity[];
  entityPositions: Map<string, { x: number; y: number; size: number }>;
  edges: EdgeData[];
  hoveredEntity: string | null;
  hoveredEntityData: EnrichedEntity | null;
  hoveredLatestArticle: FeedItem | null;
  tooltipPos: { x: number; y: number };
  handleDotHover: (name: string | null, e?: React.MouseEvent) => void;
  onEntityClick: (name: string) => void;
  dark: boolean;
  t: DiscoveryTabTheme;
}

function ScatterEdges({ edges, entityPositions, hoveredEntity, dark }: {
  edges: EdgeData[];
  entityPositions: Map<string, { x: number; y: number; size: number }>;
  hoveredEntity: string | null;
  dark: boolean;
}) {
  return (
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
            x1={`${fromPos.x}%`} y1={`${fromPos.y}%`}
            x2={`${toPos.x}%`} y2={`${toPos.y}%`}
            stroke={stroke} strokeWidth={strokeWidth} opacity={opacity}
          />
        );
      })}
    </svg>
  );
}

function EntityTooltip({ entity, latestArticle, pos, dark, t }: {
  entity: EnrichedEntity;
  latestArticle: FeedItem | null;
  pos: { x: number; y: number };
  dark: boolean;
  t: DiscoveryTabTheme;
}) {
  return (
    <div
      className={`absolute z-30 px-3 py-2 rounded-lg border text-xs pointer-events-none ${t.tooltipBg}`}
      style={{
        left: Math.min(pos.x + 12, (typeof window !== "undefined" ? window.innerWidth * 0.7 : 600)),
        top: pos.y - 10,
        maxWidth: 260,
      }}
    >
      <div className={`font-bold mb-1 ${t.text}`}>{entity.name}</div>
      <div className={t.textMuted}>
        {entity.mentions} mentions &middot; {entity.categorySpread} categories &middot; {entity.sourceCount} sources
      </div>
      {entity.noveltyReasons[0] && (
        <div className={`mt-1 ${dark ? "text-emerald-400" : "text-emerald-700"}`}>
          {entity.noveltyReasons[0].label}
        </div>
      )}
      {latestArticle && (
        <div className={`mt-1 truncate ${t.textMuted}`}>{latestArticle.title}</div>
      )}
    </div>
  );
}

export default function ScatterPlot({
  filteredEntities, entityPositions, edges, hoveredEntity,
  hoveredEntityData, hoveredLatestArticle, tooltipPos,
  handleDotHover, onEntityClick, dark, t,
}: ScatterPlotProps) {
  return (
    <div className={`relative rounded-xl border overflow-hidden ${dark ? "border-slate-800" : "border-gray-200"} ${t.bg} scatter-container`} style={{ height: 380 }}>
      <span className={`absolute top-3 left-4 text-[10px] italic ${t.textFaint}`}>High volume, narrow focus</span>
      <span className={`absolute top-3 right-4 text-[10px] italic ${t.textFaint}`}>High volume, wide spread</span>
      <span className={`absolute bottom-3 left-4 text-[10px] italic ${t.textFaint}`}>Low volume, narrow focus</span>
      <span className={`absolute bottom-3 right-4 text-[10px] italic font-medium ${dark ? "text-emerald-700" : "text-emerald-400"}`}>Low volume, wide spread</span>

      <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] ${t.textFaint}`}>Category spread &rarr;</span>
      <span className={`absolute top-1/2 left-1 -translate-y-1/2 text-[10px] ${t.textFaint}`} style={{ writingMode: "vertical-rl", transform: "rotate(180deg) translateY(50%)" }}>&larr; Mention count</span>

      <ScatterEdges edges={edges} entityPositions={entityPositions} hoveredEntity={hoveredEntity} dark={dark} />

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
              left: `${pos.x}%`, top: `${pos.y}%`,
              width: pos.size, height: pos.size,
              marginLeft: -pos.size / 2, marginTop: -pos.size / 2,
              borderRadius: "50%", backgroundColor: color,
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

      {hoveredEntityData && (
        <EntityTooltip entity={hoveredEntityData} latestArticle={hoveredLatestArticle} pos={tooltipPos} dark={dark} t={t} />
      )}
    </div>
  );
}
