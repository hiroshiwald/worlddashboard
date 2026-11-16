"use client";

import { placeLabels, type LabelItem } from "@/lib/map-layout";
import type { EntityMapState } from "@/hooks/useEntityMap";
import { CONTEXT_ID, layoutEntity, type MapData } from "./model";
import { groupColor, labelText } from "./MapSvg";

const W = 900;

interface Props {
  dark: boolean;
  data: MapData;
  id: string;
  state: EntityMapState;
}

/** Entity level: the entity in the middle, its groups as bubbles, linked entities inside the bubbles. */
export default function EntityLevel({ dark, data, id, state }: Props) {
  const lay = layoutEntity(data, id, W);
  const center = data.byId.get(id)!;
  const ink = dark ? "#e2e8f0" : "#1e293b";
  const items: LabelItem[] = [{ key: id, x: lay.center.x, y: lay.center.y, r: 16, text: labelText(center), busy: 99 }];
  for (const b of lay.bubbles) {
    for (const m of b.members) {
      items.push({ key: m.id, x: m.x, y: m.y, r: 6, text: labelText(data.byId.get(m.id)!), busy: 1 });
    }
  }
  const labels = placeLabels(items, [], W);
  const halo = (growing: boolean, x: number, y: number, r: number) =>
    growing ? <circle cx={x} cy={y} r={r + 5} fill="#38bdf8" fillOpacity={0.35} /> : null;

  return (
    <svg viewBox={`0 0 ${W} ${lay.height}`} className="w-full select-none" role="group" aria-label={`Entity level: ${center.name}`}>
      {lay.bubbles.map((b) => {
        const color = b.gid === CONTEXT_ID ? "#64748b" : groupColor(data, b.gid);
        const open = b.gid !== CONTEXT_ID;
        return (
          <g key={b.gid}>
            {b.members.map((m) => (
              <line key={m.id} x1={lay.center.x} y1={lay.center.y} x2={m.x} y2={m.y} stroke={color} strokeOpacity={0.4} />
            ))}
            <circle cx={b.x} cy={b.y} r={b.r} fill={color} fillOpacity={0.1} stroke={color} strokeOpacity={0.6}
              data-testid={`bubble-${b.gid}`} role={open ? "button" : undefined} tabIndex={open ? 0 : undefined}
              aria-label={`${b.label}, open this group`} style={{ cursor: open ? "pointer" : "default" }}
              onClick={open ? () => state.goScope([b.gid]) : undefined}
              onKeyDown={open ? (e) => e.key === "Enter" && state.goScope([b.gid]) : undefined} />
            <text x={b.x} y={b.y - b.r - 6} textAnchor="middle" fontSize={12} fontWeight={600} fill={color} pointerEvents="none">
              {b.label}{b.more > 0 ? ` (+${b.more} more)` : ""}
            </text>
          </g>
        );
      })}
      {lay.bubbles.flatMap((b) => b.members).map((m) => {
        const n = data.byId.get(m.id)!;
        const color = n.role === "anchor" ? "#0f172a" : groupColor(data, data.groupOf.get(m.id) ?? "");
        return (
          <g key={m.id} data-testid={`member-${m.id}`} role="button" tabIndex={0} aria-label={`Go to ${n.name}`}
            style={{ cursor: "pointer" }} onClick={() => state.goEntity(m.id)}
            onKeyDown={(e) => e.key === "Enter" && state.goEntity(m.id)}>
            {halo(n.state === "New" || n.state === "Rising", m.x, m.y, 6)}
            <circle cx={m.x} cy={m.y} r={6} fill={color} stroke={dark ? "#94a3b8" : color} strokeWidth={2}
              strokeDasharray={n.status === "tracked" ? undefined : "3 2"} />
          </g>
        );
      })}
      <g data-testid="entity-center">
        {halo(center.state === "New" || center.state === "Rising", lay.center.x, lay.center.y, 16)}
        <circle cx={lay.center.x} cy={lay.center.y} r={16} fill={dark ? "#0f172a" : "#ffffff"} stroke="#0ea5e9" strokeWidth={4}
          strokeDasharray={center.status === "tracked" ? undefined : "4 3"} />
      </g>
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
