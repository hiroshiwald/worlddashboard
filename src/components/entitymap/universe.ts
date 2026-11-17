// Pure model for the Universe: new names grouped by the well-known entity they appear next to.
import type { EmergingItem, EmergingResponse } from "@/lib/emerging-types";

export const NO_ANCHOR_ID = "none";
export const NO_ANCHOR_LABEL = "Not near anything known";

export interface AnchorBubble {
  id: string;
  label: string;
  items: EmergingItem[];
}

/** Throws unless `raw` has the GET /api/emerging shape this tab reads. */
export function parseEmerging(raw: unknown): EmergingResponse {
  const r = raw as Partial<EmergingResponse> | null;
  if (!r || !Array.isArray(r.items) || typeof r.generatedAt !== "string") {
    throw new Error("Unexpected response from /api/emerging");
  }
  return r as EmergingResponse;
}

/** One bubble per first anchor, biggest first; items with no anchor share one bubble. */
export function groupByAnchor(items: EmergingItem[]): AnchorBubble[] {
  const buckets = new Map<string, AnchorBubble>();
  for (const item of items) {
    const first = item.anchors[0];
    const id = first === undefined ? NO_ANCHOR_ID : first.id;
    const label = first === undefined ? NO_ANCHOR_LABEL : first.name;
    const bubble = buckets.get(id) ?? { id, label, items: [] };
    bubble.items.push(item);
    buckets.set(id, bubble);
  }
  return [...buckets.values()].sort((a, b) => b.items.length - a.items.length || a.id.localeCompare(b.id));
}

/** Names next to a known entity, most mentioned first. */
export function nearKnown(items: EmergingItem[], limit: number = 10): EmergingItem[] {
  return items
    .filter((i) => i.anchors.length > 0)
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function bubbleRadius(count: number): number {
  return 20 + Math.min(40, Math.sqrt(count) * 5);
}
