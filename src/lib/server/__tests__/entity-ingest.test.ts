import { describe, it, expect } from "vitest";
import {
  processNewArticles,
  rollupHourlyMentions,
  rollupEntityEdges,
  rollupCandidate,
} from "../entity-ingest";
import type { Sql, SqlRow } from "../db";

interface RecordedCall {
  query: string;
  values: unknown[];
}

function makeMockSql(handler: (call: RecordedCall) => SqlRow[]) {
  const calls: RecordedCall[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call: RecordedCall = { query: strings.join(" ? "), values };
    calls.push(call);
    return handler(call);
  }) as Sql;
  return { sql, calls };
}

function findCall(calls: RecordedCall[], marker: string): RecordedCall | undefined {
  return calls.find((c) => c.query.includes(marker));
}

describe("selectUnprocessedHeads (via processNewArticles)", () => {
  it("issues a NOT EXISTS clause against article_entities scoped to cluster heads", async () => {
    const { sql, calls } = makeMockSql(() => []);
    await processNewArticles(sql);

    const headsCall = calls[0];
    expect(headsCall.query).toContain("NOT EXISTS");
    expect(headsCall.query).toContain("FROM article_entities ae");
    expect(headsCall.query).toContain("ae.article_id = a.id");
    expect(headsCall.query).toContain("a.dup_group_id IS NULL");
  });

  it("returns zero stats and issues only the heads query when nothing is unprocessed", async () => {
    const { sql, calls } = makeMockSql(() => []);
    const stats = await processNewArticles(sql);

    expect(stats).toEqual({ articlesProcessed: 0, mentionsWritten: 0, newEntities: 0, candidatesTouched: 0 });
    expect(calls).toHaveLength(1);
  });
});

describe("rollupHourlyMentions", () => {
  it("aggregates mentions, distinct sources, and sentiment per entity+hour bucket", () => {
    const rows = rollupHourlyMentions([
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-15T09:12:00Z"), sourceName: "A", sentiment: 0.5 },
      { articleId: 2, entityId: 10, effectiveAt: new Date("2026-07-15T09:47:00Z"), sourceName: "B", sentiment: -0.5 },
      { articleId: 3, entityId: 10, effectiveAt: new Date("2026-07-15T09:59:00Z"), sourceName: "A", sentiment: 1 },
      { articleId: 4, entityId: 20, effectiveAt: new Date("2026-07-15T10:05:00Z"), sourceName: "C", sentiment: 0 },
    ]);

    const bucket10 = rows.find((r) => r.entityId === 10);
    expect(bucket10).toEqual({
      entityId: 10,
      bucket: "2026-07-15T09:00:00.000Z",
      mentions: 3,
      sourceCount: 2,
      sentimentSum: 1,
    });

    const bucket20 = rows.find((r) => r.entityId === 20);
    expect(bucket20).toEqual({
      entityId: 20,
      bucket: "2026-07-15T10:00:00.000Z",
      mentions: 1,
      sourceCount: 1,
      sentimentSum: 0,
    });
  });
});

describe("rollupEntityEdges", () => {
  it("orders every pair entityA < entityB regardless of mention order", () => {
    const rows = rollupEntityEdges([
      { articleId: 1, entityId: 30, effectiveAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0 },
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].entityA).toBe(10);
    expect(rows[0].entityB).toBe(30);
  });

  it("aggregates article_count across articles and tracks first/last seen", () => {
    const rows = rollupEntityEdges([
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0 },
      { articleId: 1, entityId: 20, effectiveAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0 },
      { articleId: 2, entityId: 10, effectiveAt: new Date("2026-07-15T12:00:00Z"), sourceName: "B", sentiment: 0 },
      { articleId: 2, entityId: 20, effectiveAt: new Date("2026-07-15T12:00:00Z"), sourceName: "B", sentiment: 0 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].articleCount).toBe(2);
    expect(rows[0].firstSeenAt).toBe("2026-07-15T09:00:00.000Z");
    expect(rows[0].lastSeenAt).toBe("2026-07-15T12:00:00.000Z");
  });

  it("does not create an edge for an article with only one resolved entity", () => {
    const rows = rollupEntityEdges([
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0 },
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("rollupCandidate", () => {
  function sighting(overrides: Partial<{ effectiveAt: Date; sourceName: string; title: string }>) {
    return {
      norm: "kestrel basin",
      display: "Kestrel Basin",
      typeHint: "region" as const,
      effectiveAt: new Date("2026-07-15T09:00:00Z"),
      sourceName: "Source A",
      title: "Kestrel Basin sees new activity",
      ...overrides,
    };
  }

  it("starts day_count at 1 for a brand-new candidate", () => {
    const row = rollupCandidate("kestrel basin", [sighting({})], undefined);
    expect(row.dayCount).toBe(1);
    expect(row.mentionCount).toBe(1);
  });

  it("does not increment day_count for a second sighting on the same UTC day", () => {
    const existing = rollupCandidate("kestrel basin", [sighting({})], undefined);
    const row = rollupCandidate(
      "kestrel basin",
      [sighting({ effectiveAt: new Date("2026-07-15T18:00:00Z"), sourceName: "Source B" })],
      existing,
    );
    expect(row.dayCount).toBe(1);
    expect(row.mentionCount).toBe(2);
  });

  it("increments day_count when a sighting lands on a later UTC day", () => {
    const existing = rollupCandidate("kestrel basin", [sighting({})], undefined);
    const row = rollupCandidate(
      "kestrel basin",
      [sighting({ effectiveAt: new Date("2026-07-16T09:00:00Z"), sourceName: "Source B" })],
      existing,
    );
    expect(row.dayCount).toBe(2);
  });

  it("increments once per crossed day even across multiple days within one batch", () => {
    const row = rollupCandidate(
      "kestrel basin",
      [
        sighting({ effectiveAt: new Date("2026-07-15T09:00:00Z") }),
        sighting({ effectiveAt: new Date("2026-07-16T09:00:00Z"), sourceName: "Source B" }),
        sighting({ effectiveAt: new Date("2026-07-17T09:00:00Z"), sourceName: "Source C" }),
      ],
      undefined,
    );
    expect(row.dayCount).toBe(3);
  });

  it("caps source_names at 10 and sample_titles at 3, deduping repeats", () => {
    const sightings = Array.from({ length: 12 }, (_, i) =>
      sighting({ sourceName: `Source ${i}`, title: `Title ${i % 4}`, effectiveAt: new Date("2026-07-15T09:00:00Z") }),
    );
    const row = rollupCandidate("kestrel basin", sightings, undefined);
    expect(row.sourceNames).toHaveLength(10);
    expect(row.sampleTitles).toHaveLength(3);
  });

  it("keeps the longest display for a new row, but preserves an existing display_name", () => {
    const row = rollupCandidate(
      "kestrel basin",
      [sighting({}), sighting({ sourceName: "Source B" })],
      { nameNorm: "kestrel basin", displayName: "kestrel basin region", typeHint: "region", firstSeenAt: new Date("2026-07-14T00:00:00Z"), lastSeenAt: new Date("2026-07-14T00:00:00Z"), mentionCount: 1, sourceNames: [], dayCount: 1, sampleTitles: [] },
    );
    expect(row.displayName).toBe("kestrel basin region");
  });
});

describe("processNewArticles resolution order and idempotency", () => {
  const headRow = {
    id: "1",
    title: "Zebravik officials met near Kestrel Basin today.",
    summary: "",
    published_at: "2026-07-15T09:00:00Z",
    first_seen_at: "2026-07-15T09:00:00Z",
    source_name: "Source A",
  };

  it("resolves a dismissed registry entity as a normal mention and writes no candidate for it", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [headRow];
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) {
        return [{ id: "99", canonical_name: "Kestrel Basin", type: "region", aliases: [], status: "dismissed" }];
      }
      if (call.query.includes("INSERT INTO entities")) return [];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    const stats = await processNewArticles(sql);

    expect(stats.newEntities).toBe(0);
    expect(stats.mentionsWritten).toBeGreaterThan(0);

    const articleEntitiesCall = findCall(calls, "INSERT INTO article_entities");
    expect(articleEntitiesCall).toBeDefined();
    expect(articleEntitiesCall!.values[1]).toContain(99);

    const candidatesUpsertCall = findCall(calls, "INSERT INTO entity_candidates");
    if (candidatesUpsertCall) {
      const payload = JSON.parse(candidatesUpsertCall.values[0] as string);
      expect(payload.some((p: { name_norm: string }) => p.name_norm === "kestrel basin")).toBe(false);
    }
  });

  it("creates a new entity for a first-time dictionary hit and links article_entities to its returned id", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) {
        return [{ ...headRow, title: "Russia announces new policy.", summary: "" }];
      }
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) return [];
      if (call.query.includes("INSERT INTO entities")) {
        return [{ id: "5", canonical_name: "Russia" }];
      }
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    const stats = await processNewArticles(sql);
    expect(stats.newEntities).toBe(1);

    const articleEntitiesCall = findCall(calls, "INSERT INTO article_entities");
    expect(articleEntitiesCall!.values[1]).toContain(5);
  });

  it("accumulates an unresolved candidate that matches neither the registry nor a dictionary", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) {
        return [{ ...headRow, title: "Jonas Kestrel toured the facility today.", summary: "" }];
      }
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) return [];
      if (call.query.includes("INSERT INTO entities")) return [];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    const stats = await processNewArticles(sql);
    expect(stats.candidatesTouched).toBeGreaterThan(0);

    const candidatesUpsertCall = findCall(calls, "INSERT INTO entity_candidates");
    expect(candidatesUpsertCall).toBeDefined();
    const payload = JSON.parse(candidatesUpsertCall!.values[0] as string);
    expect(payload.some((p: { name_norm: string }) => p.name_norm === "jonas kestrel")).toBe(true);
  });
});
