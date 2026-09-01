// Pure formatter: plain-word mapping for the anchor/famous/satellite role
// classification entity-admin.ts computes server-side (see DEVLOG "Phase 3a
// follow-up: role classification") — shared by the tracked table's Role
// column chip/tooltip and EntityPanel's role line, so the two surfaces never
// describe the same roleReasons differently.

import { EntityRole } from "./types";

const ROLE_LABELS: Record<EntityRole, string> = {
  anchor: "Anchor",
  famous: "Context",
  satellite: "Satellite",
};

const REASON_LABELS: Record<string, string> = {
  country_or_region_type: "country/region type",
  high_baseline: "high mention baseline",
  famous_stored: "Wikipedia-verified famous",
  famous_dictionary: "seeded dictionary name",
  famous_breadth: "wide lifetime source breadth",
  famous_volume: "top-quartile mention volume",
};

const SATELLITE_TOOLTIP = "Eligible to headline development cards.";

export function roleLabel(role: EntityRole): string {
  return ROLE_LABELS[role];
}

/** An unrecognized reason code falls back to itself rather than vanishing —
 * a reason this UI hasn't been taught yet still shows something instead of
 * silently dropping evidence. */
function describeReasons(roleReasons: string[]): string {
  return roleReasons.map((r) => REASON_LABELS[r] ?? r).join(", ");
}

/** anchor/famous: the reasons that actually fired, plain-worded. satellite
 * carries no reasons (it's the absence of the other two gates), so it gets
 * its own fixed sentence instead of an empty string. */
export function roleTooltip(role: EntityRole, roleReasons: string[]): string {
  if (role === "satellite") return SATELLITE_TOOLTIP;
  return describeReasons(roleReasons);
}

/** "{Label} — {reasons}" for EntityPanel's role line — same tooltip text the
 * table uses, just inline instead of on hover. */
export function roleDescription(role: EntityRole, roleReasons: string[]): string {
  return `${roleLabel(role)} — ${roleTooltip(role, roleReasons)}`;
}
