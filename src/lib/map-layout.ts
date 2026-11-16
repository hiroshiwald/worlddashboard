// Entity map layout and label placement, ported from docs/prototype/radar-sketch.html.
// Pure and deterministic: the same input always gives the same output.

export interface LayoutUnit {
  key: string;
  kind: "t" | "e" | "n"; // collapsed topic, entity of an opened topic, context entity
  r: number;
  group?: string; // topic name; units of one group are pulled together
}

export interface LayoutEdge {
  a: string;
  b: string;
  weight: number; // article count
}

export interface Point {
  x: number;
  y: number;
}

export interface MapLayout {
  positions: Record<string, Point>;
  width: number;
  height: number;
}

export interface LabelItem {
  key: string;
  x: number;
  y: number;
  r: number;
  text: string;
  busy: number; // link count; busy nodes choose first
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelPlacement {
  dx: number;
  dy: number;
  anchor: "start" | "middle" | "end";
}

interface Body extends Point {
  dx: number;
  dy: number;
}

const GAP = 30;

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function validate(units: LayoutUnit[], edges: LayoutEdge[], width: number): void {
  if (!Number.isFinite(width) || width < 100) throw new Error(`layoutMap: bad width ${width}`);
  const keys = new Set<string>();
  for (const u of units) {
    if (keys.has(u.key)) throw new Error(`layoutMap: duplicate unit key ${u.key}`);
    if (!Number.isFinite(u.r) || u.r <= 0) throw new Error(`layoutMap: bad radius for ${u.key}`);
    keys.add(u.key);
  }
  for (const e of edges) {
    if (!keys.has(e.a) || !keys.has(e.b)) throw new Error(`layoutMap: edge ${e.a}-${e.b} names an unknown unit`);
  }
}

function connectedComponents(units: LayoutUnit[], edges: LayoutEdge[]): string[][] {
  const adj = new Map<string, string[]>();
  units.forEach((u) => adj.set(u.key, []));
  edges.forEach((e) => {
    adj.get(e.a)!.push(e.b);
    adj.get(e.b)!.push(e.a);
  });
  const seen = new Set<string>();
  const comps: string[][] = [];
  for (const u of units) {
    if (seen.has(u.key)) continue;
    const comp: string[] = [];
    const queue = [u.key];
    seen.add(u.key);
    while (queue.length) {
      const x = queue.shift()!;
      comp.push(x);
      for (const y of adj.get(x)!) {
        if (!seen.has(y)) {
          seen.add(y);
          queue.push(y);
        }
      }
    }
    comps.push(comp);
  }
  return comps.sort((a, b) => b.length - a.length);
}

function initialBodies(us: LayoutUnit[], w: number, h: number, rand: () => number): Record<string, Body> {
  const bodies: Record<string, Body> = {};
  const ordered = us.slice().sort((a, b) => (a.group || "").localeCompare(b.group || "") || a.key.localeCompare(b.key));
  ordered.forEach((u, i) => {
    const a = (2 * Math.PI * i) / us.length;
    bodies[u.key] = {
      x: w / 2 + Math.cos(a) * w * 0.28 + (rand() - 0.5) * 14,
      y: h / 2 + Math.sin(a) * h * 0.28 + (rand() - 0.5) * 14,
      dx: 0,
      dy: 0,
    };
  });
  return bodies;
}

function applyRepulsion(us: LayoutUnit[], bodies: Record<string, Body>, k: number): void {
  for (let i = 0; i < us.length; i++) {
    for (let j = i + 1; j < us.length; j++) {
      const a = bodies[us[i].key];
      const b = bodies[us[j].key];
      const d = Math.max(0.01, Math.hypot(a.x - b.x, a.y - b.y));
      const f = (k * k) / d;
      const ux = (a.x - b.x) / d;
      const uy = (a.y - b.y) / d;
      a.dx += ux * f;
      a.dy += uy * f;
      b.dx -= ux * f;
      b.dy -= uy * f;
    }
  }
}

function applyAttraction(es: LayoutEdge[], bodies: Record<string, Body>, k: number): void {
  for (const e of es) {
    const a = bodies[e.a];
    const b = bodies[e.b];
    const d = Math.max(0.01, Math.hypot(a.x - b.x, a.y - b.y));
    const f = ((1 + Math.min(e.weight, 4) * 0.35) * d * d) / k;
    const ux = (a.x - b.x) / d;
    const uy = (a.y - b.y) / d;
    a.dx -= ux * f;
    a.dy -= uy * f;
    b.dx += ux * f;
    b.dy += uy * f;
  }
}

function applyGroupPull(groups: string[][], bodies: Record<string, Body>): void {
  for (const g of groups) {
    const cx = g.reduce((s, id) => s + bodies[id].x, 0) / g.length;
    const cy = g.reduce((s, id) => s + bodies[id].y, 0) / g.length;
    for (const id of g) {
      bodies[id].dx += (cx - bodies[id].x) * 0.04;
      bodies[id].dy += (cy - bodies[id].y) * 0.04;
    }
  }
}

// Room on the right keeps entity labels inside the box; topic circles carry their label inside.
function clampToBox(us: LayoutUnit[], bodies: Record<string, Body>, w: number, h: number): void {
  for (const u of us) {
    const p = bodies[u.key];
    const room = u.kind === "t" ? 0 : 110;
    p.x = Math.max(u.r + 14, Math.min(w - u.r - 14 - room, p.x));
    p.y = Math.max(u.r + 22, Math.min(h - u.r - 22, p.y));
  }
}

function minDistance(a: LayoutUnit, b: LayoutUnit): number {
  let pad = 48;
  if (a.kind === "t" || b.kind === "t") pad = 50;
  else if (a.group && a.group === b.group) pad = 28;
  return a.r + b.r + pad;
}

function separateOverlaps(us: LayoutUnit[], bodies: Record<string, Body>, w: number, h: number): void {
  for (let pass = 0; pass < 80; pass++) {
    for (let i = 0; i < us.length; i++) {
      for (let j = i + 1; j < us.length; j++) {
        const a = bodies[us[i].key];
        const b = bodies[us[j].key];
        const d = Math.max(0.01, Math.hypot(a.x - b.x, a.y - b.y));
        const min = minDistance(us[i], us[j]);
        if (d >= min) continue;
        const push = (min - d) / 2;
        const ux = (a.x - b.x) / d;
        const uy = (a.y - b.y) / d;
        a.x += ux * push;
        a.y += uy * push;
        b.x -= ux * push;
        b.y -= uy * push;
      }
    }
    clampToBox(us, bodies, w, h);
  }
}

function groupsOf(us: LayoutUnit[]): string[][] {
  const byGroup = new Map<string, string[]>();
  us.filter((u) => u.kind === "e" && u.group).forEach((u) => {
    byGroup.set(u.group!, (byGroup.get(u.group!) || []).concat(u.key));
  });
  return [...byGroup.values()].filter((g) => g.length > 1);
}

// Force layout for one connected group, inside a w by h box.
function forceLayout(us: LayoutUnit[], es: LayoutEdge[], w: number, h: number, seed: string): Record<string, Point> {
  const k = Math.sqrt((w * h) / us.length) * 0.62;
  const bodies = initialBodies(us, w, h, seeded(seed));
  const groups = groupsOf(us);
  const steps = 360;
  for (let it = 0; it < steps; it++) {
    const cap = (1 - it / steps) * w * 0.05 + 0.5;
    us.forEach((u) => {
      bodies[u.key].dx = 0;
      bodies[u.key].dy = 0;
    });
    applyRepulsion(us, bodies, k);
    applyAttraction(es, bodies, k);
    applyGroupPull(groups, bodies);
    for (const u of us) {
      const p = bodies[u.key];
      p.dx += (w / 2 - p.x) * 0.08;
      p.dy += (h / 2 - p.y) * 0.08;
      const d = Math.max(0.01, Math.hypot(p.dx, p.dy));
      const step = Math.min(d, cap);
      p.x += (p.dx / d) * step;
      p.y += (p.dy / d) * step;
    }
  }
  separateOverlaps(us, bodies, w, h);
  const out: Record<string, Point> = {};
  us.forEach((u) => {
    out[u.key] = { x: bodies[u.key].x, y: bodies[u.key].y };
  });
  return out;
}

interface Box {
  keys: string[];
  w: number;
  h: number;
  x: number;
  y: number;
}

function unitArea(u: LayoutUnit): number {
  return u.kind === "t" ? Math.pow(2 * u.r + 80, 2) : 16000;
}

// Boxes fill rows left to right; returns the y below the last row.
function packBoxes(boxes: Box[], width: number): number {
  const rows: Box[][] = [];
  let row: Box[] = [];
  let used = 0;
  for (const b of boxes) {
    if (row.length && used + b.w + GAP > width - 20) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(b);
    used += b.w + GAP;
  }
  if (row.length) rows.push(row);
  let y = 12;
  for (const r of rows) {
    const rowH = Math.max(...r.map((b) => b.h));
    let x = (width - (r.reduce((s, b) => s + b.w + GAP, 0) - GAP)) / 2;
    for (const b of r) {
      b.x = x;
      b.y = y;
      x += b.w + GAP;
    }
    y += rowH + GAP;
  }
  return y;
}

// Unconnected units sit in a band below the boxes. Returns the total height.
function placeSingles(singles: LayoutUnit[], width: number, top: number, out: Record<string, Point>): number {
  let sx = 30;
  let sy = top + 34;
  let rowH = 0;
  for (const u of singles) {
    const isTopic = u.kind === "t";
    const wu = isTopic ? 2 * u.r + 50 : 190;
    if (sx + wu > width - 20) {
      sx = 30;
      sy += rowH + 36;
      rowH = 0;
    }
    out[u.key] = { x: sx + (isTopic ? u.r : 10), y: sy + (isTopic ? u.r : 10) };
    sx += wu;
    rowH = Math.max(rowH, isTopic ? 2 * u.r + 14 : 24);
  }
  return sy + rowH + 40;
}

/** Lay out units in the browser: one force layout per connected group, groups packed in rows, unconnected units in a band below. */
export function layoutMap(units: LayoutUnit[], edges: LayoutEdge[], width: number): MapLayout {
  validate(units, edges, width);
  if (units.length === 0) return { positions: {}, width, height: 0 };
  const byKey = new Map(units.map((u) => [u.key, u]));
  const real = edges.filter((e) => e.a !== e.b);
  const comps = connectedComponents(units, real);
  const boxes: Box[] = comps
    .filter((c) => c.length > 1)
    .map((keys) => {
      const area = keys.reduce((s, k) => s + unitArea(byKey.get(k)!), 0);
      const w = Math.min(width - 40, Math.max(340, Math.sqrt(area) * 1.9));
      return { keys, w, h: Math.max(300, Math.round((area * 1.25) / w)), x: 0, y: 0 };
    });
  const singles = comps.filter((c) => c.length === 1).map((c) => byKey.get(c[0])!);
  const top = packBoxes(boxes, width);
  const positions: Record<string, Point> = {};
  for (const b of boxes) {
    const members = new Set(b.keys);
    const local = forceLayout(
      b.keys.map((k) => byKey.get(k)!),
      real.filter((e) => members.has(e.a)),
      b.w,
      b.h,
      b.keys.slice().sort()[0],
    );
    b.keys.forEach((k) => {
      positions[k] = { x: b.x + local[k].x, y: b.y + local[k].y };
    });
  }
  const height = singles.length ? placeSingles(singles, width, top, positions) : top;
  return { positions, width, height };
}

function overlap(a: Rect, b: Rect): number {
  const ow = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return Math.max(0, ow) * Math.max(0, oh);
}

/** Label offset for a node at angle `a` (radians) around a center; `below` forces the label under the node. */
export function sideLabel(a: number, r: number, below: boolean): LabelPlacement {
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  if (below) return { dx: 0, dy: r + 14, anchor: "middle" };
  if (cs > 0.3) return { dx: r + 6, dy: 4, anchor: "start" };
  if (cs < -0.3) return { dx: -(r + 6), dy: 4, anchor: "end" };
  if (sn < 0) return { dx: 0, dy: -(r + 6), anchor: "middle" };
  return { dx: 0, dy: r + 14, anchor: "middle" };
}

const LABEL_H = 13;
const CHAR_W = 6.4;

function labelCandidates(it: LabelItem): Array<{ p: LabelPlacement; rect: Rect }> {
  const r = it.r;
  const w = it.text.length * CHAR_W + 4;
  return [
    { p: { dx: r + 5, dy: 4, anchor: "start" }, rect: { x: it.x + r + 5, y: it.y - 9, w, h: LABEL_H } },
    { p: { dx: -(r + 5), dy: 4, anchor: "end" }, rect: { x: it.x - r - 5 - w, y: it.y - 9, w, h: LABEL_H } },
    { p: { dx: 0, dy: -(r + 6), anchor: "middle" }, rect: { x: it.x - w / 2, y: it.y - r - 16, w, h: LABEL_H } },
    { p: { dx: 0, dy: r + 15, anchor: "middle" }, rect: { x: it.x - w / 2, y: it.y + r + 3, w, h: LABEL_H } },
  ];
}

/** Try right, left, above, below for each label; keep the least-overlapping side. Busy nodes choose first. Keyed by item key. */
export function placeLabels(items: LabelItem[], extraObstacles: Rect[], width: number): Record<string, LabelPlacement> {
  const obstacles = items.map((it) => ({ x: it.x - 9, y: it.y - 9, w: 18, h: 18 })).concat(extraObstacles);
  const placed: Rect[] = [];
  const result: Record<string, LabelPlacement> = {};
  const order = items.slice().sort((a, b) => b.busy - a.busy || a.key.localeCompare(b.key));
  for (const it of order) {
    const candidates = labelCandidates(it);
    let best = candidates[0];
    let bestScore = Infinity;
    for (const c of candidates) {
      let score = 0;
      placed.forEach((q) => (score += overlap(c.rect, q)));
      obstacles.forEach((q) => (score += overlap(c.rect, q) * 2));
      if (c.rect.x < 4 || c.rect.x + c.rect.w > width - 4) score += 400;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    placed.push(best.rect);
    result[it.key] = best.p;
  }
  return result;
}
