// Pure model for the Universe: new names grouped by the well-known entity they appear next to.
import { firstAnchorRank, type EmergingItem, type EmergingResponse } from "@/lib/emerging-types";

export const NO_ANCHOR_ID = "none";
export const NO_ANCHOR_LABEL = "Not near anything known";

export interface AnchorBubble {
  id: string;
  label: string;
  rank: number; // firstAnchorRank of its items
  items: EmergingItem[];
}

/** Throws unless `raw` has the GET /api/emerging shape this tab reads. */
export function parseEmerging(raw: unknown): EmergingResponse {
  const r = raw as Partial<EmergingResponse> | null;
  const wellFormed = (i: Partial<EmergingItem>) => Array.isArray(i.sampleTitles) && Array.isArray(i.links) && Array.isArray(i.anchors);
  if (!r || !Array.isArray(r.items) || typeof r.generatedAt !== "string" || !r.items.every(wellFormed)) {
    throw new Error("Unexpected response from /api/emerging");
  }
  return r as EmergingResponse;
}

/** One bubble per first anchor: people/companies, then other, then places, biggest first within a rank; items with no anchor share one bubble, last. */
export function groupByAnchor(items: EmergingItem[]): AnchorBubble[] {
  const buckets = new Map<string, AnchorBubble>();
  for (const item of items) {
    const first = item.anchors[0];
    const id = first === undefined ? NO_ANCHOR_ID : first.id;
    const label = first === undefined ? NO_ANCHOR_LABEL : first.name;
    const bubble = buckets.get(id) ?? { id, label, rank: firstAnchorRank(item.anchors), items: [] };
    bubble.items.push(item);
    buckets.set(id, bubble);
  }
  return [...buckets.values()].sort((a, b) => a.rank - b.rank || b.items.length - a.items.length || a.id.localeCompare(b.id));
}

/** Names next to a known entity: people/companies anchors first, places last, then most mentioned. */
export function nearKnown(items: EmergingItem[], limit: number = 10): EmergingItem[] {
  return items
    .filter((i) => i.anchors.length > 0)
    .sort((a, b) => firstAnchorRank(a.anchors) - firstAnchorRank(b.anchors) || b.mentions - a.mentions || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function bubbleRadius(count: number): number {
  return 20 + Math.min(40, Math.sqrt(count) * 5);
}

export type NameAction = "track" | "ignore";

export interface NameRequest {
  method: "POST" | "PATCH";
  url: string;
  body: Record<string, string>;
}

/** The Newsfeed's own calls: POST /api/candidates for a candidate, PATCH /api/entities/:id for an entity. */
export function nameRequest(item: EmergingItem, action: NameAction): NameRequest {
  if (item.kind === "entity") {
    const status = action === "track" ? "tracked" : "dismissed";
    return { method: "PATCH", url: `/api/entities/${encodeURIComponent(item.key)}`, body: { status } };
  }
  const nameNorm = item.key.replace(/^cand:/, "");
  if (action === "track") return { method: "POST", url: "/api/candidates", body: { nameNorm, action: "accept", type: item.type } };
  return { method: "POST", url: "/api/candidates", body: { nameNorm, action: "dismiss" } };
}
