import { describe, it, expect } from "vitest";
import {
  isRecent,
  tryAcquireLock,
  selectFreshnessThreshold,
  FRESHNESS_THRESHOLD_MS,
  LOCK_THRESHOLD_MS,
  MANUAL_FRESHNESS_THRESHOLD_MS,
} from "../tick";
import type { Sql, SqlRow } from "../db";

const NOW = new Date("2026-07-16T12:00:00.000Z");

function minutesBefore(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

describe("isRecent", () => {
  it("treats null (no data yet) as never recent", () => {
    expect(isRecent(null, NOW, FRESHNESS_THRESHOLD_MS)).toBe(false);
  });

  it("freshness (15min): a timestamp just under 15 minutes old is recent", () => {
    const timestamp = minutesBefore(NOW, 14);
    expect(isRecent(timestamp, NOW, FRESHNESS_THRESHOLD_MS)).toBe(true);
  });

  it("freshness (15min): a timestamp exactly 15 minutes old is not recent", () => {
    const timestamp = minutesBefore(NOW, 15);
    expect(isRecent(timestamp, NOW, FRESHNESS_THRESHOLD_MS)).toBe(false);
  });

  it("freshness (15min): a timestamp just over 15 minutes old is not recent", () => {
    const timestamp = minutesBefore(NOW, 16);
    expect(isRecent(timestamp, NOW, FRESHNESS_THRESHOLD_MS)).toBe(false);
  });

  it("lock (10min): a lock just under 10 minutes old is recent (still locked)", () => {
    const timestamp = minutesBefore(NOW, 9);
    expect(isRecent(timestamp, NOW, LOCK_THRESHOLD_MS)).toBe(true);
  });

  it("lock (10min): a lock exactly 10 minutes old is not recent (stale)", () => {
    const timestamp = minutesBefore(NOW, 10);
    expect(isRecent(timestamp, NOW, LOCK_THRESHOLD_MS)).toBe(false);
  });

  it("lock (10min): a lock well over 10 minutes old is not recent (stale)", () => {
    const timestamp = minutesBefore(NOW, 30);
    expect(isRecent(timestamp, NOW, LOCK_THRESHOLD_MS)).toBe(false);
  });
});

describe("threshold constants", () => {
  it("LOCK_THRESHOLD_MS is a whole number of minutes (the SQL interval divides it exactly)", () => {
    expect(LOCK_THRESHOLD_MS % 60_000).toBe(0);
  });

  it("MANUAL_FRESHNESS_THRESHOLD_MS matches LOCK_THRESHOLD_MS (the lock is the real abuse ceiling)", () => {
    expect(MANUAL_FRESHNESS_THRESHOLD_MS).toBe(LOCK_THRESHOLD_MS);
  });
});

describe("selectFreshnessThreshold", () => {
  it("selects the 2h passive threshold when manual is false", () => {
    expect(selectFreshnessThreshold(false)).toBe(FRESHNESS_THRESHOLD_MS);
  });

  it("selects the 10min manual threshold when manual is true", () => {
    expect(selectFreshnessThreshold(true)).toBe(MANUAL_FRESHNESS_THRESHOLD_MS);
  });

  it("a timestamp stale under the manual threshold but fresh under the passive one resolves differently per mode", () => {
    const now = NOW;
    const timestamp = minutesBefore(now, 12);
    expect(isRecent(timestamp, now, selectFreshnessThreshold(true))).toBe(false);
    expect(isRecent(timestamp, now, selectFreshnessThreshold(false))).toBe(true);
  });
});

interface RecordedCall {
  query: string;
  values: unknown[];
}

function makeMockSql(rows: SqlRow[]): { sql: Sql; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join(" ? "), values });
    return rows;
  }) as Sql;
  return { sql, calls };
}

describe("tryAcquireLock", () => {
  it("issues an atomic INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING against settings.tick_lock", async () => {
    const { sql, calls } = makeMockSql([]);
    await tryAcquireLock(sql);

    expect(calls).toHaveLength(1);
    const { query, values } = calls[0];
    expect(query).toContain("INSERT INTO settings");
    expect(query).toContain("'tick_lock'");
    expect(query).toContain("ON CONFLICT (key) DO UPDATE");
    expect(query).toContain("WHERE");
    expect(query).toContain("RETURNING");
    expect(query).toContain("make_interval(mins =>");
    expect(values).toContain(10);
  });

  it("returns true (winner) when the upsert returns a row", async () => {
    const { sql } = makeMockSql([{ key: "tick_lock" }]);
    expect(await tryAcquireLock(sql)).toBe(true);
  });

  it("returns false (loser) when the upsert returns no row", async () => {
    const { sql } = makeMockSql([]);
    expect(await tryAcquireLock(sql)).toBe(false);
  });
});
