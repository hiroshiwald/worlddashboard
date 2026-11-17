import { describe, it, expect } from "vitest";
import { estimateBackfillUsd, getBackfillStatus, BACKFILL_MAX_PER_RUN } from "../backfill";
import type { Sql, SqlRow } from "../db";

describe("estimateBackfillUsd", () => {
  it("prices 300 input + 200 output batch tokens per article", () => {
    // 1000 articles: 300k in * $0.5/M + 200k out * $2.5/M = 0.15 + 0.50
    expect(estimateBackfillUsd(1000)).toBeCloseTo(0.65, 6);
    expect(estimateBackfillUsd(0)).toBe(0);
  });
});

describe("getBackfillStatus", () => {
  it("returns the topic-less head count with its estimate", async () => {
    const queries: string[] = [];
    const sql = (async (strings: TemplateStringsArray) => {
      queries.push(strings.join(" ? "));
      return [{ remaining_heads: "2000" }] as SqlRow[];
    }) as Sql;

    const status = await getBackfillStatus(sql);

    expect(status.remaining).toBe(2000);
    expect(status.estimatedUsd).toBeCloseTo(1.3, 6);
    expect(queries[0]).toContain("topic IS NULL");
    expect(queries[0]).toContain("dup_group_id IS NULL");
  });
});

describe("BACKFILL_MAX_PER_RUN", () => {
  it("is a whole number of 25-article chunks", () => {
    expect(BACKFILL_MAX_PER_RUN).toBe(400);
  });
});
