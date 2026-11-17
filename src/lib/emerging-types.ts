// Contract for GET /api/emerging: new names seen next to well-known entities.
// "Anchor" = a tracked entity with role famous or anchor (see graph roles).

export interface EmergingAnchor {
  id: string;
  name: string;
  type: string;
  articleCount: number; // articles naming both the new name and this anchor
}

const PLACE_TYPES = new Set(["country", "region", "city"]);

/** Operator order: people and companies first, places last, everything else between. */
export function anchorRank(type: string): number {
  if (type === "person" || type === "company") return 0;
  if (PLACE_TYPES.has(type)) return 2;
  return 1;
}

/** Rank of an item's first anchor; items with no anchor go after all ranks. */
export function firstAnchorRank(anchors: EmergingAnchor[]): number {
  if (anchors.length === 0) return 3;
  return anchorRank(anchors[0].type);
}

export interface EmergingItem {
  key: string; // "cand:<name_norm>" for a candidate, entity id for an entity
  kind: "candidate" | "entity";
  name: string;
  type: string;
  firstSeenAt: string; // ISO
  mentions: number;
  anchors: EmergingAnchor[]; // top 3 by anchorRank, then articleCount descending; may be empty
  sampleTitles: string[]; // up to 3
}

export interface EmergingResponse {
  items: EmergingItem[];
  days: number;
  generatedAt: string; // ISO
}
