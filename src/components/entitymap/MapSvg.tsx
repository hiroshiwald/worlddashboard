"use client";

import { useEffect, useMemo, useState } from "react";
import type { EntityMapState } from "@/hooks/useEntityMap";
import type { EmergingState } from "@/hooks/useEmerging";
import { insideLabel, packCircles, type Circle } from "./pack";
import { bubbleRadius, groupByAnchor, type AnchorBubble } from "./universe";

const W = 900;
const MAX_BUBBLES = 30;
// Colour says what kind of known entity the bubble is (anchorRank order).
const RANK_COLORS = ["#2563eb", "#0d9488", "#94a3b8", "#cbd5e1"];
const RANK_LABELS = ["Person or company", "Other", "Place", "Not near anything known"];

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

function bubbleColor(b: AnchorBubble): string {
  return RANK_COLORS[Math.min(b.rank, RANK_COLORS.length - 1)];
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
  const all = groupByAnchor(emerging.visible);
  return (
    <div>
      <Legend muted={muted} shown={Math.min(all.length, MAX_BUBBLES)} total={all.length} />
      <Bubbles bubbles={all.slice(0, MAX_BUBBLES)} state={state} />
    </div>
  );
}

function Legend({ muted, shown, total }: { muted: string; shown: number; total: number }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pt-3 text-xs ${muted}`}>
      {RANK_LABELS.map((label, i) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: RANK_COLORS[i] }} />
          {label}
        </span>
      ))}
      {shown < total && <span>Showing {shown} of {total} groups, people and companies first.</span>}
    </div>
  );
}

function useEntered(): boolean {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return entered;
}

function Bubbles({ bubbles, state }: { bubbles: AnchorBubble[]; state: EntityMapState }) {
  const entered = useEntered();
  const packed = useMemo(() => packCircles(bubbles.map((b) => ({ key: b.id, r: bubbleRadius(b.items.length) })), W), [bubbles]);
  const byId = new Map(packed.circles.map((c) => [c.key, c]));
  return (
    <svg viewBox={`0 0 ${W} ${packed.height}`} className="w-full select-none" role="group" aria-label="New names by known entity">
      <style>{BUBBLE_CSS}</style>
      {bubbles.map((b) => (
        <Bubble key={b.id} bubble={b} circle={byId.get(b.id)!} color={bubbleColor(b)} entered={entered}
          selected={state.bubble === b.id} onPick={() => state.selectBubble(b.id)} />
      ))}
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
  const label = insideLabel(bubble.label, r);
  const ink = bubble.rank >= 2 ? "#0f172a" : "#ffffff";
  const className = `ub${entered ? " in" : ""}${selected ? " sel" : ""}`;
  return (
    <g className={className} data-testid={`bubble-${bubble.id}`} role="button" tabIndex={0} aria-pressed={selected}
      aria-label={`${bubble.label}, ${countText(bubble.items.length)}`} onClick={onPick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick()}>
      <circle cx={x} cy={y} r={r} fill={color} fillOpacity={selected ? 1 : 0.85} stroke={selected ? "#0ea5e9" : color} strokeWidth={selected ? 4 : 1} />
      <title>{`${bubble.label}: ${countText(bubble.items.length)}`}</title>
      <text x={x} y={y - 1} textAnchor="middle" fontSize={label.size} fontWeight={600} fill={ink} pointerEvents="none">{label.text}</text>
      <text x={x} y={y + label.size} textAnchor="middle" fontSize={11} fill={ink} fillOpacity={0.85} pointerEvents="none">
        {bubble.items.length}
      </text>
    </g>
  );
}
