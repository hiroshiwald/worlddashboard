// Pure model for new names: parsing /api/emerging, the near-known list, Track/Ignore requests.
import { firstAnchorRank, type EmergingItem, type EmergingResponse } from "@/lib/emerging-types";

export const NO_ANCHOR_LABEL = "Not near anything known";

/** Throws unless `raw` has the GET /api/emerging shape this tab reads. */
export function parseEmerging(raw: unknown): EmergingResponse {
  const r = raw as Partial<EmergingResponse> | null;
  const wellFormed = (i: Partial<EmergingItem>) => Array.isArray(i.sampleTitles) && Array.isArray(i.links) && Array.isArray(i.anchors);
  if (!r || !Array.isArray(r.items) || typeof r.generatedAt !== "string" || !r.items.every(wellFormed)) {
    throw new Error("Unexpected response from /api/emerging");
  }
  return r as EmergingResponse;
}

/** Names next to a known entity: people/companies anchors first, places last, then most mentioned. */
export function nearKnown(items: EmergingItem[], limit: number = 10): EmergingItem[] {
  return items
    .filter((i) => i.anchors.length > 0)
    .sort((a, b) => firstAnchorRank(a.anchors) - firstAnchorRank(b.anchors) || b.mentions - a.mentions || a.name.localeCompare(b.name))
    .slice(0, limit);
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
