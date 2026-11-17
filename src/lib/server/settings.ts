import type { Sql } from "./db";

export interface Settings {
  surprise_k: number;
  dismiss_cooldown_hours: number;
  brief_max_blocks: number;
  warmup_days: number;
  llm_monthly_budget_usd: number;
  /** Operator off switch: 1 stops all background activity (see run-ingest.ts). */
  activity_paused: number;
  /** Epoch ms when activity_paused was last set to 1; 0 while running. */
  activity_paused_since: number;
}

export const DEFAULTS: Settings = {
  surprise_k: 3,
  dismiss_cooldown_hours: 72,
  brief_max_blocks: 10,
  warmup_days: 7,
  llm_monthly_budget_usd: 10,
  activity_paused: 0,
  activity_paused_since: 0,
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

/** Upserts the operator off switch (both keys in one statement). */
export async function setActivityPaused(sql: Sql, paused: boolean, now: Date): Promise<void> {
  const flag = paused ? 1 : 0;
  const since = paused ? now.getTime() : 0;
  await sql`
    INSERT INTO settings (key, value)
    VALUES ('activity_paused', to_jsonb(${flag}::numeric)),
           ('activity_paused_since', to_jsonb(${since}::numeric))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}
