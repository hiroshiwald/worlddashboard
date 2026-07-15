import type { Sql } from "./db";

export interface Settings {
  surprise_k: number;
  dismiss_cooldown_hours: number;
  brief_max_blocks: number;
  warmup_days: number;
}

export const DEFAULTS: Settings = {
  surprise_k: 3,
  dismiss_cooldown_hours: 72,
  brief_max_blocks: 10,
  warmup_days: 7,
};

function isValidOverride(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Overlays settings-table rows onto DEFAULTS. Unknown keys are ignored;
 * a row whose value isn't a finite number falls back to the default with a
 * console.warn — every current setting is a plain number, so this one check
 * covers all of them. */
export async function getSettings(sql: Sql): Promise<Settings> {
  const rows = await sql`SELECT key, value FROM settings`;
  const settings = { ...DEFAULTS };

  for (const row of rows) {
    const key = String(row.key);
    if (!(key in DEFAULTS)) continue;
    if (isValidOverride(row.value)) {
      settings[key as keyof Settings] = row.value;
    } else {
      console.warn(`getSettings: invalid value for "${key}", falling back to default`, row.value);
    }
  }

  return settings;
}
