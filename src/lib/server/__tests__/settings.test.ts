import { describe, it, expect, vi, afterEach } from "vitest";
import { getSettings, DEFAULTS } from "../settings";
import type { Sql, SqlRow } from "../db";

function makeMockSql(rows: SqlRow[]): Sql {
  return (async () => rows) as Sql;
}

describe("getSettings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns DEFAULTS when the settings table is empty", async () => {
    const settings = await getSettings(makeMockSql([]));
    expect(settings).toEqual(DEFAULTS);
  });

  it("overlays a valid numeric override onto the defaults", async () => {
    const settings = await getSettings(makeMockSql([{ key: "surprise_k", value: 5 }]));
    expect(settings).toEqual({ ...DEFAULTS, surprise_k: 5 });
  });

  it("overlays multiple valid overrides", async () => {
    const settings = await getSettings(
      makeMockSql([
        { key: "surprise_k", value: 4 },
        { key: "dismiss_cooldown_hours", value: 48 },
        { key: "brief_max_blocks", value: 20 },
      ]),
    );
    expect(settings).toEqual({ surprise_k: 4, dismiss_cooldown_hours: 48, brief_max_blocks: 20 });
  });

  it("ignores unknown keys", async () => {
    const settings = await getSettings(makeMockSql([{ key: "not_a_real_setting", value: 99 }]));
    expect(settings).toEqual(DEFAULTS);
  });

  it("falls back to the default and warns on a non-numeric value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const settings = await getSettings(makeMockSql([{ key: "surprise_k", value: "five" }]));
    expect(settings.surprise_k).toBe(DEFAULTS.surprise_k);
    expect(warn).toHaveBeenCalled();
  });

  it("falls back to the default and warns on a non-finite value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const settings = await getSettings(makeMockSql([{ key: "brief_max_blocks", value: NaN }]));
    expect(settings.brief_max_blocks).toBe(DEFAULTS.brief_max_blocks);
    expect(warn).toHaveBeenCalled();
  });
});
