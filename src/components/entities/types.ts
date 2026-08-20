// Shared client-side DTO shapes for the Entities tab — mirrors
// entity-admin.ts's EntityAdminJson/EntityStats server-side.

export interface EntityRowData {
  id: number;
  canonicalName: string;
  type: string;
  status: string;
  aliases: string[];
  fame: string;
  fameLocked: boolean;
  wikiTitle: string | null;
  wikiSitelinks: number | null;
  wikiPageviewsMonthly: number | null;
  fameCheckedAt: string | null;
  firstSeenAt: string;
}

export interface EntityStats {
  totalTracked: number;
  famousCount: number;
  notFamousCount: number;
  unknownCount: number;
  parkedCount: number;
  neverCheckedCount: number;
  lockedCount: number;
  oldestFameCheckedAt: string | null;
  newestFameCheckedAt: string | null;
}

export const STATUS_FILTERS = ["tracked", "dismissed", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const FAME_FILTERS = ["all", "famous", "not_famous", "unknown"] as const;
export type FameFilter = (typeof FAME_FILTERS)[number];

// Same 15-type ontology ReviewTab.tsx uses (entities_type_check).
export const ENTITY_TYPES = [
  "person", "company", "organization", "government_body", "armed_group",
  "political_party", "country", "region", "city", "product", "technology",
  "financial_asset", "disease", "infrastructure", "other",
];

export interface EntityPatch {
  type?: string;
  status?: string;
  fame?: string;
  fameLocked?: boolean;
}
