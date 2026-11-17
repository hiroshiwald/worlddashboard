// Entity map label placement, ported from docs/prototype/radar-sketch.html.
// Pure and deterministic: the same input always gives the same output.

export interface Point {
  x: number;
  y: number;
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
  const obstacles = items.map((it) => ({ x: it.x - it.r, y: it.y - it.r, w: 2 * it.r, h: 2 * it.r })).concat(extraObstacles);
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
