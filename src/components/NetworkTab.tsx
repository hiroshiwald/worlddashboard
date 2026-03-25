"use client";

import { useMemo, useCallback, useRef, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { FeedItem, ExtractedEntity, EntityType, UrgencyLevel } from "@/lib/types";
import { extractEntities } from "@/lib/entity-extractor";

interface NetworkTabProps {
  items: FeedItem[];
  dark: boolean;
  onEntityClick?: (name: string) => void;
}

interface GraphNode {
  id: string;
  name: string;
  type: EntityType;
  mentions: number;
  maxUrgency: UrgencyLevel;
  val: number;
}

interface GraphLink {
  source: string;
  target: string;
  value: number;
}

const TYPE_COLORS: Record<EntityType, { dark: string; light: string }> = {
  country: { dark: "#34d399", light: "#059669" },
  organization: { dark: "#a78bfa", light: "#7c3aed" },
  region: { dark: "#22d3ee", light: "#0891b2" },
  person: { dark: "#fb923c", light: "#ea580c" },
};

const URGENCY_PRIORITY: UrgencyLevel[] = [
  "critical", "warning", "advisory", "monitoring", "system", "neutral",
];

export default function NetworkTab({ items, dark, onEntityClick }: NetworkTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ReturnType<typeof ForceGraph2D> extends React.ComponentType<infer P> ? any : any>(null);

  const entities = useMemo(() => extractEntities(items), [items]);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const entityMap = new Map<string, ExtractedEntity>();

    for (const e of entities) {
      entityMap.set(e.name, e);
    }

    for (const e of entities) {
      let maxUrgency: UrgencyLevel = "neutral";
      for (const level of URGENCY_PRIORITY) {
        if (e.urgencyBreakdown[level] > 0) {
          maxUrgency = level;
          break;
        }
      }

      nodes.push({
        id: e.name,
        name: e.name,
        type: e.type,
        mentions: e.mentions,
        maxUrgency,
        val: Math.sqrt(e.mentions) * 2,
      });
    }

    const linkSet = new Set<string>();
    for (const e of entities) {
      for (const [coName, count] of e.cooccurrences) {
        if (!entityMap.has(coName)) continue;
        const key = [e.name, coName].sort().join("|||");
        if (linkSet.has(key)) continue;
        linkSet.add(key);
        links.push({ source: e.name, target: coName, value: count });
      }
    }

    return { nodes, links };
  }, [entities]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (onEntityClick) onEntityClick(node.id);
    },
    [onEntityClick]
  );

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const label = node.name as string;
      const fontSize = Math.max(10 / globalScale, 2);
      const radius = Math.sqrt(node.mentions) * 1.5 + 3;
      const typeColor = TYPE_COLORS[node.type as EntityType];
      const color = dark ? typeColor.dark : typeColor.light;

      // Draw circle
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color + "88";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 / globalScale;
      ctx.stroke();

      // Draw label
      if (globalScale > 0.6 || node.mentions > 5) {
        ctx.font = `bold ${fontSize}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = dark ? "#e2e8f0" : "#1c1917";
        ctx.fillText(label.toUpperCase(), node.x!, node.y! + radius + 2);
      }
    },
    [dark]
  );

  const nodePointerAreaPaint = useCallback(
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      const radius = Math.sqrt(node.mentions) * 1.5 + 3;
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, radius + 4, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  // Fit to view after mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (graphRef.current) {
        graphRef.current.zoomToFit(400, 40);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [graphData]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={nodePointerAreaPaint}
        onNodeClick={handleNodeClick}
        linkColor={() => dark ? "rgba(148,163,184,0.15)" : "rgba(120,113,108,0.15)"}
        linkWidth={(link: any) => Math.max(0.5, Math.sqrt(link.value) * 0.5)}
        backgroundColor={dark ? "#020617" : "#fafaf9"}
        cooldownTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />
      {/* Legend */}
      <div className={`absolute bottom-3 left-3 flex flex-wrap gap-3 px-3 py-2 text-[10px] uppercase tracking-wide rounded ${
        dark ? "bg-slate-900/90 text-slate-400 border border-slate-700" : "bg-white/90 text-stone-500 border border-stone-200"
      }`}>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dark ? TYPE_COLORS.country.dark : TYPE_COLORS.country.light }} />
          COUNTRY
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dark ? TYPE_COLORS.organization.dark : TYPE_COLORS.organization.light }} />
          ORG
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dark ? TYPE_COLORS.person.dark : TYPE_COLORS.person.light }} />
          PERSON
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dark ? TYPE_COLORS.region.dark : TYPE_COLORS.region.light }} />
          REGION
        </span>
      </div>
    </div>
  );
}
