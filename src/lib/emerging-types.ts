// Contract for GET /api/emerging: new names seen next to well-known entities.
// "Anchor" = a tracked entity with role famous or anchor (see graph roles).

export interface EmergingAnchor {
  id: string;
  name: string;
  articleCount: number; // articles naming both the new name and this anchor
}

export interface EmergingItem {
  key: string; // "cand:<name_norm>" for a candidate, entity id for an entity
  kind: "candidate" | "entity";
  name: string;
  type: string;
  firstSeenAt: string; // ISO
  mentions: number;
  anchors: EmergingAnchor[]; // top 3 by articleCount, descending; may be empty
  sampleTitles: string[]; // up to 3
}

export interface EmergingResponse {
  items: EmergingItem[];
  days: number;
  generatedAt: string; // ISO
}
