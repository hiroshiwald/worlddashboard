// Shared client-side DTO shapes for the Entities tab — mirrors
// entity-admin.ts's EntityAdminJson/EntityListItemJson/EntityStats server-side.

export const ENTITY_ROLES = ["anchor", "famous", "satellite"] as const;
export type EntityRole = (typeof ENTITY_ROLES)[number];

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
  lastSeenAt: string | null;
  mentions7d: number;
  sources7d: number;
  role: EntityRole;
  roleReasons: string[];
}

// The PATCH endpoint (src/app/api/entities/[id]/route.ts) returns
// toEntityAdminJson's shape only — it never recomputes the list-only
// activity/role columns above. Named locally (not imported from
// src/lib/server/entity-admin.ts) to keep this client module independent of
// the server boundary; see useEntitiesTab.ts's applyServerUpdate for how a
// row is merged rather than replaced wholesale on a PATCH response.
export type EntityAdminPatchResponse = Omit<EntityRowData, "lastSeenAt" | "mentions7d" | "sources7d" | "role" | "roleReasons">;

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

// The fame-checked stat-tile filter (Parked/Never checked live on this axis;
// "all" means unfiltered — see StatsStrip's Never-checked tile).
export const FAME_CHECKED_FILTERS = ["all", "never", "checked"] as const;
export type FameCheckedFilter = (typeof FAME_CHECKED_FILTERS)[number];

// Same display mapping ControlsRow's fame dropdown and EntityPanel's Fame
// block both use for the three real verdicts (excludes "all", which only
// the dropdown has).
export const FAME_VERDICT_LABELS: Record<"famous" | "not_famous" | "unknown", string> = {
  famous: "Established",
  not_famous: "Emerging",
  unknown: "Unchecked",
};

// Sort headers on the tracked table — mirrors entity-admin.ts's EntitySort
// exactly (name asc; the rest desc, no direction toggle).
export const ENTITY_SORTS = ["name", "first_seen", "last_seen", "activity"] as const;
export type EntitySort = (typeof ENTITY_SORTS)[number];
export const DEFAULT_ENTITY_SORT: EntitySort = "last_seen";

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

// EM-2b: candidate triage (absorbs ReviewTab.tsx) — mirrors /api/candidates'
// GET row shape byte-for-byte.
export interface CandidateRowData {
  nameNorm: string;
  displayName: string;
  typeHint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  mentionCount: number;
  sourceNames: string[];
  sourceCount: number;
  dayCount: number;
  sampleTitles: string[];
  contexts: string[];
  coEntities: string[];
}

export interface BulkItemResult {
  nameNorm: string;
  ok: boolean;
  error?: string;
}

// Consequence narration: a success confirmation with an optional one-level
// undo (the inverse call, from a pre-action snapshot — no history stack).
export interface ToastState {
  message: string;
  onUndo?: () => void;
}

export const PAGE_SIZE_OPTIONS = [50, 100, 250] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];
