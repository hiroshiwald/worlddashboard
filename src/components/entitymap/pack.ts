// Packed-circle layout for the Universe: pure and deterministic.

export interface Circle {
  key: string;
  x: number;
  y: number;
  r: number;
}

export interface PackedCircles {
  circles: Circle[];
  height: number;
}

const GAP = 6;
const PAD = 28;
const MAX_SCALE = 2;
const LABEL_CHAR_W = 6.6;

function isFree(c: Circle, placed: Circle[]): boolean {
  return placed.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= p.r + c.r + GAP - 1e-6);
}

/** The two centres where a circle of radius r touches both a and b (with GAP); empty when they are too far apart or nested. */
function tangentSpots(a: Circle, b: Circle, r: number): Array<{ x: number; y: number }> {
  const da = a.r + r + GAP;
  const db = b.r + r + GAP;
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d === 0 || d > da + db || d < Math.abs(da - db)) return [];
  const t = (da * da - db * db + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, da * da - t * t));
  const ux = (b.x - a.x) / d;
  const uy = (b.y - a.y) / d;
  const mx = a.x + t * ux;
  const my = a.y + t * uy;
  return [{ x: mx + h * uy, y: my - h * ux }, { x: mx - h * uy, y: my + h * ux }];
}

/** The free spot touching two placed circles that is closest to the origin. */
function bestSpot(key: string, r: number, placed: Circle[]): Circle {
  let best: Circle | null = null;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      for (const spot of tangentSpots(placed[i], placed[j], r)) {
        const candidate = { key, r, ...spot };
        const closer = best === null || Math.hypot(spot.x, spot.y) < Math.hypot(best.x, best.y);
        if (closer && isFree(candidate, placed)) best = candidate;
      }
    }
  }
  if (best === null) throw new Error(`packCircles: no free spot for ${key}`);
  return best;
}

function packAroundOrigin(sorted: Array<{ key: string; r: number }>): Circle[] {
  const placed: Circle[] = [{ key: sorted[0].key, x: 0, y: 0, r: sorted[0].r }];
  if (sorted.length > 1) placed.push({ key: sorted[1].key, x: sorted[0].r + sorted[1].r + GAP, y: 0, r: sorted[1].r });
  for (const next of sorted.slice(2)) placed.push(bestSpot(next.key, next.r, placed));
  return placed;
}

/** Packed circles, largest nearest the middle, none overlapping, scaled to fill `width` (up to 2x). */
export function packCircles(input: Array<{ key: string; r: number }>, width: number): PackedCircles {
  if (!Number.isFinite(width) || width < 100) throw new Error(`packCircles: bad width ${width}`);
  if (input.some((c) => !Number.isFinite(c.r) || c.r <= 0)) throw new Error("packCircles: bad radius");
  if (input.length === 0) return { circles: [], height: 0 };
  const sorted = [...input].sort((a, b) => b.r - a.r || a.key.localeCompare(b.key));
  const packed = packAroundOrigin(sorted);
  const minX = Math.min(...packed.map((c) => c.x - c.r));
  const maxX = Math.max(...packed.map((c) => c.x + c.r));
  const minY = Math.min(...packed.map((c) => c.y - c.r));
  const maxY = Math.max(...packed.map((c) => c.y + c.r));
  const scale = Math.min(MAX_SCALE, (width - 2 * PAD) / (maxX - minX));
  const circles = packed.map((c) => ({ key: c.key, r: c.r * scale, x: PAD + (c.x - minX) * scale, y: PAD + (c.y - minY) * scale }));
  return { circles, height: (maxY - minY) * scale + 2 * PAD };
}

/** True when `text` fits across a circle of radius r at the Universe label size. */
export function labelFits(text: string, r: number): boolean {
  return text.length * LABEL_CHAR_W <= 2 * r * 0.85;
}
