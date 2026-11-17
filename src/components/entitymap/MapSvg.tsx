"use client";

import { useEffect, useMemo, useState } from "react";
import { placeLabels, type LabelItem, type Rect } from "@/lib/map-layout";
import type { EntityMapState } from "@/hooks/useEntityMap";
import type { EmergingState } from "@/hooks/useEmerging";
import { labelFits, packCircles, type Circle } from "./pack";
import { bubbleRadius, groupByAnchor, NO_ANCHOR_ID, type AnchorBubble } from "./universe";

const W = 900;
const PALETTE = ["#2563eb", "#d97706", "#059669", "#db2777", "#7c3aed", "#0891b2", "#65a30d", "#dc2626"];
const GREY = "#64748b";

// Fade and scale in once mounted; hover and selection lift. Transform only, so nothing around a bubble moves.
const BUBBLE_CSS = `
.ub { opacity: 0; transform: scale(0.85); transform-box: fill-box; transform-origin: center; cursor: pointer;
  transition: opacity 250ms ease-out, transform 200ms ease-out; }
.ub.in { opacity: 1; transform: none; }
.ub.in:hover, .ub.in.sel, .ub.in:focus-visible { transform: scale(1.06); outline: none; }
.ub:not(.sel):not(:hover) circle { transition: stroke-width 200ms; }
@media (prefers-reduced-motion: reduce) { .ub { transition: none; transform: none; } .ub.in:hover, .ub.in.sel { transform: none; } }
`;

interface Props {
  dark: boolean;
  emerging: EmergingState;
  state: EntityMapState;
}

function bubbleColor(b: AnchorBubble, index: number): string {
  return b.id === NO_ANCHOR_ID ? GREY : PALETTE[index % PALETTE.length];
}

function countText(n: number): string {
  return `${n} new ${n === 1 ? "name" : "names"}`;
}

/** Universe: one bubble per well-known entity that has new names near it, sized by how many. */
export default function MapSvg({ dark, emerging, state }: Props) {
  const muted = dark ? "text-slate-400" : "text-gray-500";
  const { load } = emerging;
  if (load.status === "loading") return <p className={`p-4 text-sm ${muted}`} role="status">Loading new names...</p>;
  if (load.status === "error") {
    return (
      <div className="p-4 text-sm" role="alert" data-testid="universe-error">
        <p>New names could not be loaded. {load.message}</p>
        <button type="button" className="mt-2 rounded border px-2 py-1" onClick={emerging.reload}>Try again</button>
      </div>
    );
  }
  if (emerging.visible.length === 0) {
    return <p className={`p-4 text-sm ${muted}`} data-testid="universe-empty">No new names in the last {load.data.days} days.</p>;
  }
  return <Bubbles dark={dark} bubbles={groupByAnchor(emerging.visible)} state={state} />;
}

function useEntered(): boolean {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return entered;
}

function Bubbles({ dark, bubbles, state }: { dark: boolean; bubbles: AnchorBubble[]; state: EntityMapState }) {
  const entered = useEntered();
  const packed = useMemo(() => packCircles(bubbles.map((b) => ({ key: b.id, r: bubbleRadius(b.items.length) })), W), [bubbles]);
  const byId = new Map(packed.circles.map((c) => [c.key, c]));
  return (
    <svg viewBox={`0 0 ${W} ${packed.height}`} className="w-full select-none" role="group" aria-label="New names by known entity">
      <style>{BUBBLE_CSS}</style>
      {bubbles.map((b, i) => (
        <Bubble key={b.id} bubble={b} circle={byId.get(b.id)!} color={bubbleColor(b, i)} entered={entered}
          selected={state.bubble === b.id} onPick={() => state.selectBubble(b.id)} />
      ))}
      <OutsideLabels dark={dark} bubbles={bubbles} circles={packed.circles} />
    </svg>
  );
}

interface BubbleProps {
  bubble: AnchorBubble;
  circle: Circle;
  color: string;
  entered: boolean;
  selected: boolean;
  onPick: () => void;
}

function Bubble({ bubble, circle, color, entered, selected, onPick }: BubbleProps) {
  const { x, y, r } = circle;
  const inside = labelFits(bubble.label, r);
  const className = `ub${entered ? " in" : ""}${selected ? " sel" : ""}`;
  return (
    <g className={className} data-testid={`bubble-${bubble.id}`} role="button" tabIndex={0} aria-pressed={selected}
      aria-label={`${bubble.label}, ${countText(bubble.items.length)}`} onClick={onPick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick()}>
      <circle cx={x} cy={y} r={r} fill={color} fillOpacity={selected ? 1 : 0.85} stroke={selected ? "#0ea5e9" : color} strokeWidth={selected ? 4 : 1} />
      {inside && <text x={x} y={y - 1} textAnchor="middle" fontSize={12} fontWeight={600} fill="#ffffff" pointerEvents="none">{bubble.label}</text>}
      <text x={x} y={inside ? y + 14 : y + 5} textAnchor="middle" fontSize={inside ? 11 : 14} fontWeight={700} fill="#ffffff" pointerEvents="none">
        {bubble.items.length}
      </text>
    </g>
  );
}

/** Labels that do not fit inside their bubble sit beside it, clear of the other bubbles. */
function OutsideLabels({ dark, bubbles, circles }: { dark: boolean; bubbles: AnchorBubble[]; circles: Circle[] }) {
  const byId = new Map(circles.map((c) => [c.key, c]));
  const outside = bubbles.filter((b) => !labelFits(b.label, byId.get(b.id)!.r));
  const items: LabelItem[] = outside.map((b) => {
    const c = byId.get(b.id)!;
    return { key: b.id, x: c.x, y: c.y, r: c.r, text: b.label, busy: b.items.length };
  });
  const obstacles: Rect[] = circles.map((c) => ({ x: c.x - c.r, y: c.y - c.r, w: 2 * c.r, h: 2 * c.r }));
  const labels = placeLabels(items, obstacles, W);
  return (
    <g pointerEvents="none">
      {items.map((it) => {
        const p = labels[it.key];
        return (
          <text key={it.key} x={it.x + p.dx} y={it.y + p.dy} textAnchor={p.anchor} fontSize={11} fill={dark ? "#e2e8f0" : "#1e293b"}
            paintOrder="stroke" stroke={dark ? "#0f172a" : "#ffffff"} strokeWidth={3}>{it.text}</text>
        );
      })}
    </g>
  );
}
