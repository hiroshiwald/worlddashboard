import { describe, expect, it } from "vitest";
import { DAY_MS, hiddenAt, nextReplay, replayLabel, replayStart } from "../replay";

describe("replay", () => {
  const now = Date.UTC(2026, 10, 17);
  it("starts `days` before now", () => {
    expect(replayStart(now, 14)).toBe(now - 14 * DAY_MS);
  });
  it("steps one day and ends at now", () => {
    expect(nextReplay(now - 3 * DAY_MS, now)).toBe(now - 2 * DAY_MS);
    expect(nextReplay(now - DAY_MS, now)).toBeNull();
    expect(nextReplay(now - DAY_MS / 2, now)).toBeNull();
  });
  it("hides only items first seen after the replay day", () => {
    expect(hiddenAt(100, null)).toBe(false);
    expect(hiddenAt(100, 99)).toBe(true);
    expect(hiddenAt(100, 100)).toBe(false);
    expect(hiddenAt(Number.NEGATIVE_INFINITY, 0)).toBe(false);
  });
  it("labels the day", () => {
    expect(replayLabel(now)).toBe("2026-11-17");
  });
});
