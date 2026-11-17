"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { centringForce, showLabel, type UniNode, type Universe } from "./forcegraph";

const NEW_COLOR = "#0ea5e9";

interface Props {
  dark: boolean;
  universe: Universe;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

// The library replaces link source/target ids with node objects once it runs.
function endId(end: unknown): string {
  return typeof end === "object" && end !== null ? (end as UniNode).id : String(end);
}

function useSize(): [React.RefObject<HTMLDivElement>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

/** The whole universe in one view: new names bright, known entities muted, zoom and pan on. */
export default function UniverseGraph({ dark, universe, selected, onSelect }: Props) {
  const [box, size] = useSize();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the library's ref type is not exported
  const graphRef = useRef<any>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // Fresh copies: the library mutates what it is given, and `universe` must stay pure.
  const graphData = useMemo(
    () => ({ nodes: universe.nodes.map((n) => ({ ...n })), links: universe.links.map((l) => ({ ...l })) }),
    [universe],
  );
  // Spread the dense core: stronger repulsion, longer links.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    g.d3Force("charge")?.strength(-60);
    g.d3Force("link")?.distance(40);
    g.d3Force("centring", centringForce(0.2));
  }, [graphData]);
  const lit = useMemo(() => {
    if (selected === null) return null;
    return new Set([selected, ...(universe.neighbours.get(selected) ?? [])]);
  }, [selected, universe]);

  const paintNode = useCallback((n: UniNode & { x: number; y: number }, ctx: CanvasRenderingContext2D, scale: number) => {
    const dim = lit !== null && !lit.has(n.id);
    ctx.globalAlpha = dim ? 0.15 : 1;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, 2 * Math.PI);
    ctx.fillStyle = n.isNew ? NEW_COLOR : dark ? "#64748b" : "#94a3b8";
    ctx.fill();
    if (n.isNew || n.id === selected) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius + 2.5, 0, 2 * Math.PI);
      ctx.strokeStyle = n.id === selected ? (dark ? "#f8fafc" : "#0f172a") : NEW_COLOR;
      ctx.lineWidth = 1.2 / scale;
      ctx.stroke();
    }
    if (showLabel(n, hovered, selected, universe.neighbours)) {
      ctx.font = `${n.isNew ? 600 : 400} ${11 / scale}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = n.isNew ? (dark ? "#7dd3fc" : "#0369a1") : dark ? "#cbd5e1" : "#475569";
      ctx.fillText(n.name, n.x, n.y + n.radius + 3);
    }
    ctx.globalAlpha = 1;
  }, [dark, hovered, selected, lit, universe.neighbours]);

  const paintPointer = useCallback((n: UniNode & { x: number; y: number }, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius + 3, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const linkColor = useCallback((l: { source: unknown; target: unknown }) => {
    const faint = dark ? "rgba(148,163,184,0.18)" : "rgba(100,116,139,0.22)";
    if (lit === null) return faint;
    const touches = lit.has(endId(l.source)) && lit.has(endId(l.target)) && (endId(l.source) === selected || endId(l.target) === selected);
    return touches ? NEW_COLOR : dark ? "rgba(148,163,184,0.05)" : "rgba(100,116,139,0.06)";
  }, [dark, lit, selected]);

  return (
    <div ref={box} className="h-[60vh] min-h-[320px] w-full lg:h-[calc(100vh-8rem)]" data-testid="universe-graph">
      <ForceGraph2D
        ref={graphRef}
        width={size.w}
        height={size.h}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={1}
        nodeCanvasObject={paintNode as never}
        nodePointerAreaPaint={paintPointer as never}
        nodeLabel={(n: object) => (n as UniNode).name}
        linkColor={linkColor as never}
        linkWidth={0.5}
        onNodeClick={(n: object) => onSelect((n as UniNode).id)}
        onNodeHover={(n: object | null) => setHovered(n === null ? null : (n as UniNode).id)}
        onBackgroundClick={() => onSelect(null)}
        cooldownTicks={150}
        onEngineStop={() => graphRef.current?.zoomToFit(400, 40)}
        d3VelocityDecay={0.3}
      />
    </div>
  );
}
