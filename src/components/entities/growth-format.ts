import { ratioText } from "@/lib/entity-growth";
import type { EntityRowData } from "./types";

type Growth = NonNullable<EntityRowData["growth"]>;

const ARROWS = { Rising: "▲", Falling: "▼", Steady: "●" } as const;

/** Chip text. WarmingUp gets no ratio: under 3 days of history it is not a claim. */
export function growthChipText(growth: Growth): string {
  if (growth.state === "WarmingUp") return "warming up";
  if (growth.state === "New") return "New";
  return `${ARROWS[growth.state]} ×${ratioText(growth.ratio)}`;
}

/** SVG polyline points for a series, scaled to width x height; flat series sit on the baseline. */
export function sparklinePoints(daily: number[], width: number, height: number): string {
  if (daily.length < 2) return "";
  const max = Math.max(...daily, 1);
  const step = width / (daily.length - 1);
  return daily
    .map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`)
    .join(" ");
}

/** Index after an arrow key, clamped to the list; other keys return null. */
export function nextRowIndex(current: number, key: string, length: number): number | null {
  if (length === 0) return null;
  if (key === "ArrowDown") return Math.min(length - 1, current + 1);
  if (key === "ArrowUp") return Math.max(0, current - 1);
  return null;
}
