"use client";

import { useMemo, type KeyboardEvent, type MouseEvent } from "react";
import type { GraphNode } from "@/lib/server/graph";
import { ratioText } from "@/lib/entity-growth";
import { buildAdjacency, connectedGroups } from "@/lib/entity-paths";
import { layoutMap, placeLabels, type LabelItem, type Point } from "@/lib/map-layout";
import type { EntityMapState } from "@/hooks/useEntityMap";
import { contentBand, isContext, isGrowing, isNewLink, planUnits, type MapData } from "./model";
import { useDrag } from "./useDrag";

const W = 900;
const PALETTE = ["#2563eb", "#d97706", "#059669", "#db2777", "#7c3aed", "#0891b2", "#65a30d", "#dc2626"];
const GREY = "#64748b";
const HALO = "#38bdf8";
const NEW_LINK = "#2563eb";
const FRAME_PAD = 24;

interface Props {
  dark: boolean;
  data: MapData;
  generatedAt: string;
  state: EntityMapState;
}

export function groupColor(data: MapData, gid: string): string {
  const i = data.groups.findIndex((g) => g.id === gid);
  if (i < 0 || gid === "isolated") return GREY;
  return PALETTE[i % PALETTE.length];
}

export function labelText(n: GraphNode): string {
  return isGrowing(n) ? `${n.name} ▲ ×${ratioText(n.ratio)}` : n.name;
}

interface Box { x0: number; y0: number; x1: number; y1: number }

function boxOf(points: Point[], pad: number): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}

// One render function: layout, drag offsets and label placement share the same per-frame positions, so splitting would scatter them.
export default function MapSvg({ dark, data, generatedAt, state }: Props) {
  const { svgRef, suppress, onPointerDown } = useDrag(state.off, state.moveBy);
  const pathGroups = state.pathIds.map((id) => data.groupOf.get(id)).filter((g): g is string => g !== undefined);
  const pathHasContext = state.pathIds.some((id) => isContext(data.byId.get(id)!));
  const showContext = state.anchors || pathHasContext;
  const openKey = [...state.open, ...pathGroups].sort().join("|");
  const plan = useMemo(
    () => planUnits(data, { open: new Set(openKey === "" ? [] : openKey.split("|")), scope: state.scope, showContext }),
    [data, openKey, state.scope, showContext],
  );
  const layout = useMemo(() => layoutMap(plan.units, plan.edges, W), [plan]);

  const pos = (key: string): Point => {
    const base = layout.positions[key];
    const unit = plan.units.find((u) => u.key === key);
    const own = state.off[key] ?? { dx: 0, dy: 0 };
    const grp = unit?.kind === "e" ? (state.off[`o:${unit.group}`] ?? { dx: 0, dy: 0 }) : { dx: 0, dy: 0 };
    return { x: base.x + own.dx + grp.dx, y: base.y + own.dy + grp.dy };
  };
  const points = useMemo(
    () => Object.fromEntries(plan.units.map((u) => [u.key, pos(u.key)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, layout, state.off],
  );
  const pathUnits = new Set(state.pathIds.map((id) => plan.unitOf(id)));
  const tracing = state.pathIds.length > 0;
  const dimmed = (key: string) => tracing && !pathUnits.has(key);

  const labelItems: LabelItem[] = plan.units.map((u) => ({
    key: u.key,
    x: points[u.key].x,
    y: points[u.key].y,
    r: u.r,
    text: unitText(data, u.key),
    busy: plan.edges.filter((e) => e.a === u.key || e.b === u.key).length,
  }));
  const labels = placeLabels(labelItems, [], W);

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    if (suppress.current) return;
    const el = (e.target as Element).closest("[data-act]");
    if (el !== null) runAct(el as SVGElement, state, data);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = (e.target as Element).closest("[data-act]");
    if (el === null) return;
    e.preventDefault();
    runAct(el as SVGElement, state, data);
  };

  const ink = dark ? "#e2e8f0" : "#1e293b";
  const newKeys = newLinkKeys(data, plan.unitOf, generatedAt);
  const frames = islandFrames(plan, points);
  const band = contentBand(layout.positions);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 ${band.y} ${W} ${band.height}`}
      className="w-full max-h-[calc(100vh-11rem)] select-none"
      role="group"
      aria-label="Entity map"
      onPointerDown={onPointerDown}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {frames.map((b, i) => (
        <rect key={i} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx={16} fill="none" stroke={GREY} strokeDasharray="6 5" opacity={0.5} />
      ))}
      {data.groups.filter((g) => plan.units.some((u) => u.kind === "e" && u.group === g.id)).map((g) => {
        const box = boxOf(g.ids.map((id) => points[`e:${id}`]).filter(Boolean), 20);
        const color = groupColor(data, g.id);
        const closable = state.scope.length === 0;
        return (
          <g key={g.id} opacity={tracing && !pathGroups.includes(g.id) ? 0.25 : 1}>
            <rect data-drag={`o:${g.id}`} data-testid={`outline-${g.id}`} x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0}
              rx={14} fill={color} fillOpacity={0.08} stroke={color} strokeOpacity={0.6} style={{ touchAction: "none", cursor: "move" }} />
            <text
              x={box.x0 + 8} y={box.y0 + 14} fontSize={12} fontWeight={600} fill={color}
              data-act={closable ? "close" : undefined} data-id={g.id} data-testid={`close-${g.id}`}
              tabIndex={closable ? 0 : undefined} role={closable ? "button" : undefined}
              style={{ cursor: closable ? "pointer" : "default" }}
            >
              {g.label}{g.rising > 0 ? ` ▲${g.rising}` : ""}{closable ? " ×" : ""}
            </text>
          </g>
        );
      })}
      <g>
        {plan.edges.map((e) => (
          <EdgeLine key={`${e.a}|${e.b}`} ids={[e.a, e.b]} a={points[e.a]} b={points[e.b]} edge={e} fresh={newKeys.has(`${e.a}|${e.b}`)}
            dim={tracing && !(pathUnits.has(e.a) && pathUnits.has(e.b))} dark={dark} />
        ))}
      </g>
      <g>
        {plan.units.map((u) => (
          <UnitNode key={u.key} unit={u} at={points[u.key]} data={data} state={state} dim={dimmed(u.key)} dark={dark} />
        ))}
      </g>
      <g pointerEvents="none">
        {labelItems.map((it) => {
          const p = labels[it.key];
          return (
            <text key={it.key} x={it.x + p.dx} y={it.y + p.dy} textAnchor={p.anchor} fontSize={11} fill={ink}
              opacity={dimmed(it.key) ? 0.25 : 1} paintOrder="stroke" stroke={dark ? "#0f172a" : "#ffffff"} strokeWidth={3}>
              {it.text}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

function unitText(data: MapData, key: string): string {
  const id = key.slice(2);
  if (key.startsWith("g:")) {
    const g = data.groups.find((x) => x.id === id)!;
    return g.rising > 0 ? `${g.label} ▲${g.rising}` : g.label;
  }
  return labelText(data.byId.get(id)!);
}

function runAct(el: SVGElement, state: EntityMapState, data: MapData): void {
  const id = el.getAttribute("data-id") ?? "";
  const act = el.getAttribute("data-act");
  if (act === "g") {
    if (state.scope.length === 0) state.openGroup(id);
    state.setSel({ t: "g", id });
  } else if (act === "close") {
    state.closeGroup(id);
    state.setSel(null);
  } else if (act === "n" && data.byId.has(id)) {
    state.setSel({ t: "n", id });
  } else if (act === "e") {
    state.setSel({ t: "e", a: el.getAttribute("data-a") ?? "", b: el.getAttribute("data-b") ?? "" });
  }
}

function newLinkKeys(data: MapData, unitOf: (id: string) => string | null, generatedAt: string): Set<string> {
  const keys = new Set<string>();
  for (const e of data.edges) {
    const a = unitOf(e.a);
    const b = unitOf(e.b);
    if (a === null || b === null || a === b || !isNewLink(e, generatedAt)) continue;
    keys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return keys;
}

/** Dashed frames around each connected island, drawn only when there is more than one. Loose entities sit in the "Not connected to anything" group. */
function islandFrames(plan: ReturnType<typeof planUnits>, points: Record<string, Point>): Box[] {
  const keys = plan.units.map((u) => u.key);
  const adj = buildAdjacency(plan.edges.map((e) => ({ a: e.a, b: e.b, articleCount: e.weight })));
  const found = connectedGroups(adj, keys);
  const multi = found.filter((g) => g.length > 1);
  if (multi.length < 2) return [];
  return multi.map((g) => boxOf(g.map((k) => points[k]), FRAME_PAD));
}

function EdgeLine(p: { ids: [string, string]; a: Point; b: Point; edge: { weight: number }; fresh: boolean; dim: boolean; dark: boolean }) {
  const width = Math.min(6, 1 + Math.log2(p.edge.weight + 1) * 0.7);
  const base = p.dark ? "#64748b" : "#94a3b8";
  const single = p.ids.every((k) => !k.startsWith("g:"));
  const hit = single ? { "data-act": "e", "data-a": p.ids[0].slice(2), "data-b": p.ids[1].slice(2) } : {};
  return (
    <g>
      <line x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke={p.fresh ? NEW_LINK : base}
        strokeWidth={width} opacity={p.dim ? 0.1 : 0.65} strokeLinecap="round" />
      {single && <line {...hit} x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke="transparent" strokeWidth={10} style={{ cursor: "pointer" }} />}
    </g>
  );
}

interface NodeProps {
  unit: { key: string; kind: "t" | "e" | "n"; r: number; group?: string };
  at: Point;
  data: MapData;
  state: EntityMapState;
  dim: boolean;
  dark: boolean;
}

function UnitNode({ unit, at, data, state, dim, dark }: NodeProps) {
  const id = unit.key.slice(2);
  const common = { "data-drag": unit.key, "data-testid": unit.key, tabIndex: 0, role: "button", style: { cursor: "pointer", touchAction: "none" } } as const;
  const opacity = dim ? 0.2 : 1;
  const bg = dark ? "#0f172a" : "#ffffff";
  if (unit.kind === "t") {
    const g = data.groups.find((x) => x.id === id)!;
    const color = groupColor(data, id);
    const selected = state.sel?.t === "g" && state.sel.id === id;
    return (
      <g {...common} data-act="g" data-id={id} aria-label={`${g.label}, ${g.ids.length} ${g.ids.length === 1 ? "entity" : "entities"}`} opacity={opacity}>
        <circle cx={at.x} cy={at.y} r={unit.r} fill={color} fillOpacity={0.85} stroke={selected ? "#0ea5e9" : color} strokeWidth={selected ? 4 : 1} />
        <text x={at.x} y={at.y + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#ffffff" pointerEvents="none">{g.ids.length}</text>
      </g>
    );
  }
  const node = data.byId.get(id)!;
  const selected = state.sel?.t === "n" && state.sel.id === id;
  if (unit.kind === "n") {
    return (
      <g {...common} data-act="n" data-id={id} aria-label={`${node.name}, context entity`} opacity={opacity}>
        <circle cx={at.x} cy={at.y} r={unit.r} fill="#0f172a" stroke={selected ? "#0ea5e9" : "#94a3b8"} strokeWidth={selected ? 3 : 1} />
      </g>
    );
  }
  const color = groupColor(data, unit.group ?? "");
  const tracked = node.status === "tracked";
  return (
    <g {...common} data-act="n" data-id={id} aria-label={labelText(node)} opacity={opacity}>
      {isGrowing(node) && <circle cx={at.x} cy={at.y} r={unit.r + 5} fill={HALO} fillOpacity={0.35} />}
      <circle cx={at.x} cy={at.y} r={unit.r} fill={bg} stroke={selected ? "#0ea5e9" : color}
        strokeWidth={selected ? 4 : 2.5} strokeDasharray={tracked ? undefined : "3 2"} />
      <circle cx={at.x} cy={at.y} r={unit.r - 3} fill={color} fillOpacity={0.45} />
    </g>
  );
}
