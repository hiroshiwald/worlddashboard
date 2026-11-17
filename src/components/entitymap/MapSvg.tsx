"use client";

import { useMemo } from "react";
import { layoutMap, placeLabels, type LabelItem, type LayoutUnit } from "@/lib/map-layout";
import type { EntityMapState } from "@/hooks/useEntityMap";
import type { EmergingLoad } from "@/hooks/useEmerging";
import { bubbleRadius, groupByAnchor, NO_ANCHOR_ID, type AnchorBubble } from "./universe";

const W = 900;
const PALETTE = ["#2563eb", "#d97706", "#059669", "#db2777", "#7c3aed", "#0891b2", "#65a30d", "#dc2626"];
const GREY = "#64748b";

interface Props {
  dark: boolean;
  emerging: { load: EmergingLoad; reload: () => void };
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
  if (load.data.items.length === 0) {
    return <p className={`p-4 text-sm ${muted}`} data-testid="universe-empty">No new names in the last {load.data.days} days.</p>;
  }
  return <Bubbles dark={dark} bubbles={groupByAnchor(load.data.items)} state={state} />;
}

function Bubbles({ dark, bubbles, state }: { dark: boolean; bubbles: AnchorBubble[]; state: EntityMapState }) {
  const units: LayoutUnit[] = useMemo(
    () => bubbles.map((b) => ({ key: `t:${b.id}`, kind: "t", r: bubbleRadius(b.items.length) })),
    [bubbles],
  );
  const layout = useMemo(() => layoutMap(units, [], W), [units]);
  const items: LabelItem[] = units.map((u, i) => ({
    key: u.key, x: layout.positions[u.key].x, y: layout.positions[u.key].y, r: u.r, text: bubbles[i].label, busy: 0,
  }));
  const labels = placeLabels(items, [], W);
  const ink = dark ? "#e2e8f0" : "#1e293b";
  return (
    <svg viewBox={`0 0 ${W} ${layout.height}`} className="w-full select-none" role="group" aria-label="New names by known entity">
      {bubbles.map((b, i) => {
        const u = units[i];
        const { x, y } = layout.positions[u.key];
        const color = bubbleColor(b, i);
        const selected = state.bubble === b.id;
        const pick = () => state.setBubble(b.id);
        return (
          <g key={b.id} data-testid={`bubble-${b.id}`} role="button" tabIndex={0} aria-label={`${b.label}, ${countText(b.items.length)}`}
            style={{ cursor: "pointer" }} onClick={pick} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pick()}>
            <circle cx={x} cy={y} r={u.r} fill={color} fillOpacity={0.85} stroke={selected ? "#0ea5e9" : color} strokeWidth={selected ? 4 : 1} />
            <text x={x} y={y + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#ffffff" pointerEvents="none">{b.items.length}</text>
          </g>
        );
      })}
      <g pointerEvents="none">
        {items.map((it) => {
          const p = labels[it.key];
          return (
            <text key={it.key} x={it.x + p.dx} y={it.y + p.dy} textAnchor={p.anchor} fontSize={11} fill={ink}
              paintOrder="stroke" stroke={dark ? "#0f172a" : "#ffffff"} strokeWidth={3}>{it.text}</text>
          );
        })}
      </g>
    </svg>
  );
}
