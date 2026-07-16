import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  processNewArticles,
  rollupHourlyMentions,
  rollupEntityEdges,
  rollupRelations,
  rollupCandidate,
  dedupeMentions,
  chunkArticles,
} from "../entity-ingest";
import { isLlmConfigured, extractEntitiesBatch } from "../llm-extract";
import type { Sql, SqlRow } from "../db";

// Only the "POISON" title throws; every other title delegates to the real
// extractCandidates, so this mock doesn't change behavior for other tests —
// it just gives FIX 5's per-article resilience test a deterministic trigger.
vi.mock("../extract-v2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../extract-v2")>();
  return {
    ...actual,
    extractCandidates: (title: string, summary: string) => {
      if (title.includes("POISON")) throw new Error("simulated extraction failure");
      return actual.extractCandidates(title, summary);
    },
  };
});

// Defaults every test in this file to the pre-LLM heuristic path (matching
// this suite's original behavior, since it never sets ANTHROPIC_API_KEY);
// the "LLM extraction path" describe block below overrides isLlmConfigured
// per test.
vi.mock("../llm-extract", () => ({
  isLlmConfigured: vi.fn(() => false),
  extractEntitiesBatch: vi.fn(),
  getLlmMonthStats: vi.fn(async () => ({ month: "2026-07", inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 })),
}));

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
  it("scopes cluster heads by the entities_processed_at marker, not NOT EXISTS", async () => {
    const { sql, calls } = makeMockSql(() => []);
    await processNewArticles(sql);

    const headsCall = calls[0];
    expect(headsCall.query).toContain("a.entities_processed_at IS NULL");
    expect(headsCall.query).not.toContain("NOT EXISTS");
    expect(headsCall.query).not.toContain("article_entities");
    expect(headsCall.query).toContain("a.dup_group_id IS NULL");
  });

  it("orders the entity registry by id ascending for deterministic alias resolution", async () => {
    const headRow = {
      id: "1", title: "Test", summary: "", published_at: "2026-07-15T09:00:00Z",
      first_seen_at: "2026-07-15T09:00:00Z", source_name: "Source A",
    };
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [headRow];
      return [];
    });
    await processNewArticles(sql);

    const registryCall = calls.find((c) => c.query.includes("SELECT id, canonical_name, type, aliases"));
    expect(registryCall!.query).toContain("ORDER BY id ASC");
  });

  it("returns zero stats and issues only the heads query when nothing is unprocessed", async () => {
    const { sql, calls } = makeMockSql(() => []);
    const stats = await processNewArticles(sql);

    expect(stats).toEqual({
      articlesProcessed: 0,
      mentionsWritten: 0,
      newEntities: 0,
      candidatesTouched: 0,
      llm: { used: false, articles: 0, monthCostUsd: 0 },
      entities: { autoAccepted: 0 },
      relations: { written: 0 },
    });
    expect(calls).toHaveLength(1);
  });
});

describe("rollupHourlyMentions", () => {
  it("aggregates mentions, distinct sources, and sentiment per entity+hour bucket", () => {
    const rows = rollupHourlyMentions([
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-15T09:12:00Z"), arrivalAt: new Date("2026-07-15T09:12:00Z"), sourceName: "A", sentiment: 0.5 },
      { articleId: 2, entityId: 10, effectiveAt: new Date("2026-07-15T09:47:00Z"), arrivalAt: new Date("2026-07-15T09:47:00Z"), sourceName: "B", sentiment: -0.5 },
      { articleId: 3, entityId: 10, effectiveAt: new Date("2026-07-15T09:59:00Z"), arrivalAt: new Date("2026-07-15T09:59:00Z"), sourceName: "A", sentiment: 1 },
      { articleId: 4, entityId: 20, effectiveAt: new Date("2026-07-15T10:05:00Z"), arrivalAt: new Date("2026-07-15T10:05:00Z"), sourceName: "C", sentiment: 0 },
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

  it("buckets on effectiveAt (publish date), ignoring arrivalAt entirely", () => {
    // Published a week ago, but all arriving today (a feed pre-load) — the
    // bucket must land on the publish date, not today.
    const rows = rollupHourlyMentions([
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-08T09:00:00Z"), arrivalAt: new Date("2026-07-15T18:00:00Z"), sourceName: "A", sentiment: 0 },
    ]);
    expect(rows).toEqual([{ entityId: 10, bucket: "2026-07-08T09:00:00.000Z", mentions: 1, sourceCount: 1, sentimentSum: 0 }]);
  });
});

describe("dedupeMentions", () => {
  it("collapses two mentions of the same entity from the same article into one", () => {
    const mentions = [
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-15T09:00:00Z"), arrivalAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0.5 },
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-15T09:00:00Z"), arrivalAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0.5 },
    ];
    expect(dedupeMentions(mentions)).toEqual([mentions[0]]);
  });

  it("keeps mentions of different entities, or the same entity from different articles", () => {
    const mentions = [
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-15T09:00:00Z"), arrivalAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0 },
      { articleId: 1, entityId: 20, effectiveAt: new Date("2026-07-15T09:00:00Z"), arrivalAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0 },
      { articleId: 2, entityId: 10, effectiveAt: new Date("2026-07-15T10:00:00Z"), arrivalAt: new Date("2026-07-15T10:00:00Z"), sourceName: "B", sentiment: 0 },
    ];
    expect(dedupeMentions(mentions)).toHaveLength(3);
  });
});

describe("rollupEntityEdges", () => {
  it("orders every pair entityA < entityB regardless of mention order", () => {
    const rows = rollupEntityEdges([
      { articleId: 1, entityId: 30, effectiveAt: new Date("2026-07-15T09:00:00Z"), arrivalAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0 },
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-15T09:00:00Z"), arrivalAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].entityA).toBe(10);
    expect(rows[0].entityB).toBe(30);
  });

  it("aggregates article_count across articles and tracks first/last seen", () => {
    const rows = rollupEntityEdges([
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-15T09:00:00Z"), arrivalAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0 },
      { articleId: 1, entityId: 20, effectiveAt: new Date("2026-07-15T09:00:00Z"), arrivalAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0 },
      { articleId: 2, entityId: 10, effectiveAt: new Date("2026-07-15T12:00:00Z"), arrivalAt: new Date("2026-07-15T12:00:00Z"), sourceName: "B", sentiment: 0 },
      { articleId: 2, entityId: 20, effectiveAt: new Date("2026-07-15T12:00:00Z"), arrivalAt: new Date("2026-07-15T12:00:00Z"), sourceName: "B", sentiment: 0 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].articleCount).toBe(2);
    expect(rows[0].firstSeenAt).toBe("2026-07-15T09:00:00.000Z");
    expect(rows[0].lastSeenAt).toBe("2026-07-15T12:00:00.000Z");
  });

  it("does not create an edge for an article with only one resolved entity", () => {
    const rows = rollupEntityEdges([
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-15T09:00:00Z"), arrivalAt: new Date("2026-07-15T09:00:00Z"), sourceName: "A", sentiment: 0 },
    ]);
    expect(rows).toHaveLength(0);
  });

  it("keys first/last seen on arrivalAt (watch time), ignoring effectiveAt (news time) entirely", () => {
    // Both articles published on the same (backdated) day, but arriving on two different days —
    // firstSeenAt/lastSeenAt must reflect the arrival spread, not collapse to the shared publish date.
    const rows = rollupEntityEdges([
      { articleId: 1, entityId: 10, effectiveAt: new Date("2026-07-01T09:00:00Z"), arrivalAt: new Date("2026-07-14T09:00:00Z"), sourceName: "A", sentiment: 0 },
      { articleId: 1, entityId: 20, effectiveAt: new Date("2026-07-01T09:00:00Z"), arrivalAt: new Date("2026-07-14T09:00:00Z"), sourceName: "A", sentiment: 0 },
      { articleId: 2, entityId: 10, effectiveAt: new Date("2026-07-01T09:00:00Z"), arrivalAt: new Date("2026-07-15T09:00:00Z"), sourceName: "B", sentiment: 0 },
      { articleId: 2, entityId: 20, effectiveAt: new Date("2026-07-01T09:00:00Z"), arrivalAt: new Date("2026-07-15T09:00:00Z"), sourceName: "B", sentiment: 0 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].firstSeenAt).toBe("2026-07-14T09:00:00.000Z");
    expect(rows[0].lastSeenAt).toBe("2026-07-15T09:00:00.000Z");
  });
});

describe("rollupRelations", () => {
  type Relation = "acquisition" | "investment";
  function occurrence(overrides: Partial<{ sourceId: number; targetId: number; relation: Relation; articleId: number; arrivalAt: Date }>) {
    return {
      sourceId: 10,
      targetId: 20,
      relation: "acquisition" as Relation,
      articleId: 1,
      arrivalAt: new Date("2026-07-15T09:00:00Z"),
      ...overrides,
    };
  }

  it("rolls up a single occurrence into one row with article_count 1", () => {
    const rows = rollupRelations([occurrence({})]);
    expect(rows).toEqual([{
      sourceId: 10, targetId: 20, relation: "acquisition",
      firstSeenAt: "2026-07-15T09:00:00.000Z", lastSeenAt: "2026-07-15T09:00:00.000Z",
      articleCount: 1, evidenceArticleId: 1,
    }]);
  });

  it("keeps direction distinct: A->B and B->A never merge even for the same relation type", () => {
    const rows = rollupRelations([
      occurrence({ sourceId: 10, targetId: 20 }),
      occurrence({ sourceId: 20, targetId: 10 }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("keeps distinct relation types between the same pair as separate rows", () => {
    const rows = rollupRelations([
      occurrence({ relation: "acquisition" }),
      occurrence({ relation: "investment" }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("aggregates article_count and tracks first/last seen across multiple occurrences", () => {
    const rows = rollupRelations([
      occurrence({ articleId: 1, arrivalAt: new Date("2026-07-15T09:00:00Z") }),
      occurrence({ articleId: 2, arrivalAt: new Date("2026-07-16T09:00:00Z") }),
      occurrence({ articleId: 3, arrivalAt: new Date("2026-07-14T09:00:00Z") }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].articleCount).toBe(3);
    expect(rows[0].firstSeenAt).toBe("2026-07-14T09:00:00.000Z");
    expect(rows[0].lastSeenAt).toBe("2026-07-16T09:00:00.000Z");
  });

  it("picks the latest-arriving article as evidence, regardless of input order", () => {
    const rows = rollupRelations([
      occurrence({ articleId: 1, arrivalAt: new Date("2026-07-16T09:00:00Z") }),
      occurrence({ articleId: 2, arrivalAt: new Date("2026-07-17T09:00:00Z") }), // latest
      occurrence({ articleId: 3, arrivalAt: new Date("2026-07-15T09:00:00Z") }),
    ]);
    expect(rows[0].evidenceArticleId).toBe(2);
  });

  it("returns an empty array for no occurrences", () => {
    expect(rollupRelations([])).toEqual([]);
  });
});

describe("rollupCandidate", () => {
  function sighting(overrides: Partial<{ effectiveAt: Date; sourceName: string; title: string; roleContext: string; coEntities: string[] }>) {
    return {
      norm: "kestrel basin",
      display: "Kestrel Basin",
      typeHint: "region" as const,
      effectiveAt: new Date("2026-07-15T09:00:00Z"),
      sourceName: "Source A",
      title: "Kestrel Basin sees new activity",
      coEntities: [] as string[],
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
      { nameNorm: "kestrel basin", displayName: "kestrel basin region", typeHint: "region", firstSeenAt: new Date("2026-07-14T00:00:00Z"), lastSeenAt: new Date("2026-07-14T00:00:00Z"), mentionCount: 1, sourceNames: [], dayCount: 1, sampleTitles: [], contexts: [], coEntities: [] },
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

  it("counts one mention, not two, when an article's text matches two aliases of the same entity", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) {
        return [{ ...headRow, title: "Kestrel Basin, also known as Kestrel Valley, saw new activity today.", summary: "" }];
      }
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) {
        return [{ id: "50", canonical_name: "Kestrel Basin", type: "region", aliases: ["kestrel valley", "Kestrel Valley"] }];
      }
      if (call.query.includes("INSERT INTO entities")) return [];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    const stats = await processNewArticles(sql);
    expect(stats.mentionsWritten).toBe(1);

    const articleEntitiesCall = findCall(calls, "INSERT INTO article_entities");
    expect(articleEntitiesCall!.values[0]).toEqual([1]);
    expect(articleEntitiesCall!.values[1]).toEqual([50]);

    const hourlyCall = findCall(calls, "INSERT INTO entity_mentions_hourly");
    const mentionsArray = hourlyCall!.values[2] as number[];
    expect(mentionsArray).toEqual([1]);
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

describe("review fix-pack: processed marker, last_seen_at bump, per-article resilience", () => {
  it("marks articles processed as the final statement of a successful run", async () => {
    const headRow = {
      id: "1", title: "Russia and China sign new trade deal.", summary: "",
      published_at: "2026-07-15T09:00:00Z", first_seen_at: "2026-07-15T09:00:00Z", source_name: "Source A",
    };
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [headRow];
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) return [];
      if (call.query.includes("INSERT INTO entities")) {
        return [{ id: "1", canonical_name: "Russia" }, { id: "2", canonical_name: "China" }];
      }
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    await processNewArticles(sql);

    const lastCall = calls[calls.length - 1];
    expect(lastCall.query).toContain("UPDATE articles SET entities_processed_at = now()");
    expect(lastCall.values[0]).toEqual([1]);
  });

  it("bumps last_seen_at once per entity, grouped to the max effective time across the batch", async () => {
    const article1 = {
      id: "1", title: "Russia announces new policy.", summary: "",
      published_at: "2026-07-15T09:00:00Z", first_seen_at: "2026-07-15T09:00:00Z", source_name: "Source A",
    };
    const article2 = {
      id: "2", title: "Russia responds to sanctions pressure.", summary: "",
      published_at: "2026-07-15T14:00:00Z", first_seen_at: "2026-07-15T14:00:00Z", source_name: "Source B",
    };
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [article1, article2];
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) {
        return [{ id: "7", canonical_name: "Russia", type: "country", aliases: [] }];
      }
      if (call.query.includes("INSERT INTO entities")) return [];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    await processNewArticles(sql);

    const bumpCall = calls.find((c) => c.query.includes("UPDATE entities SET last_seen_at"));
    expect(bumpCall).toBeDefined();
    expect(bumpCall!.values[0]).toEqual([7]);
    expect(bumpCall!.values[1]).toEqual(["2026-07-15T14:00:00.000Z"]);
  });

  it("skips an article whose extraction throws, while the rest of the batch still commits", async () => {
    const poisonArticle = {
      id: "1", title: "POISON pathological title.", summary: "",
      published_at: "2026-07-15T09:00:00Z", first_seen_at: "2026-07-15T09:00:00Z", source_name: "Source A",
    };
    const goodArticle = {
      id: "2", title: "Russia announces new policy.", summary: "",
      published_at: "2026-07-15T09:00:00Z", first_seen_at: "2026-07-15T09:00:00Z", source_name: "Source B",
    };
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [poisonArticle, goodArticle];
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) return [];
      if (call.query.includes("INSERT INTO entities")) return [{ id: "5", canonical_name: "Russia" }];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    const stats = await processNewArticles(sql);

    expect(stats.articlesProcessed).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("article 1"), expect.anything());

    const markCall = calls[calls.length - 1];
    expect(markCall.query).toContain("entities_processed_at = now()");
    expect(markCall.values[0]).toEqual([2]);

    consoleErrorSpy.mockRestore();
  });
});

describe("chunkArticles", () => {
  it("splits into chunks of the given size, with a smaller final chunk", () => {
    const items = Array.from({ length: 7 }, (_, i) => i);
    expect(chunkArticles(items, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  });

  it("returns a single chunk when every item fits within size", () => {
    expect(chunkArticles([1, 2], 25)).toEqual([[1, 2]]);
  });

  it("returns an empty array for an empty input", () => {
    expect(chunkArticles([], 25)).toEqual([]);
  });
});

describe("LLM extraction path (entity-ingest wiring)", () => {
  const headRow = {
    id: "1",
    title: "Firstname Lastname met officials in Iran today.",
    summary: "",
    published_at: "2026-07-15T09:00:00Z",
    first_seen_at: "2026-07-15T09:00:00Z",
    source_name: "Source A",
  };

  beforeEach(() => {
    vi.mocked(isLlmConfigured).mockReturnValue(true);
  });

  afterEach(() => {
    vi.mocked(isLlmConfigured).mockReturnValue(false);
    vi.mocked(extractEntitiesBatch).mockReset();
  });

  it("unions a successful LLM result with the dictionary layer only, threading roleContext into contexts and same-article resolutions into co_entities", async () => {
    vi.mocked(extractEntitiesBatch).mockResolvedValue({
      candidates: new Map([
        [
          0,
          [
            {
              display: "Firstname Lastname",
              norm: "firstname lastname",
              typeHint: "person" as const,
              layer: "llm" as const,
              roleContext: "former IRGC commander",
              prominence: "known" as const,
            },
          ],
        ],
      ]),
      relations: new Map(),
    });
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [headRow];
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) return [];
      if (call.query.includes("INSERT INTO entities")) return [{ id: "1", canonical_name: "Iran" }];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    const stats = await processNewArticles(sql);

    expect(stats.llm).toEqual({ used: true, articles: 1, monthCostUsd: 0 });
    expect(stats.newEntities).toBe(1); // Iran, via the dictionary layer union

    const candidatesUpsertCall = findCall(calls, "INSERT INTO entity_candidates");
    expect(candidatesUpsertCall).toBeDefined();
    const payload = JSON.parse(candidatesUpsertCall!.values[0] as string) as {
      name_norm: string;
      contexts: string[];
      co_entities: string[];
    }[];
    const person = payload.find((p) => p.name_norm === "firstname lastname");
    expect(person).toBeDefined();
    expect(person!.contexts).toEqual(["former IRGC commander"]);
    expect(person!.co_entities).toEqual(["Iran"]);
  });

  it("falls back to the full heuristic stack for an article whose batch returned null", async () => {
    vi.mocked(extractEntitiesBatch).mockResolvedValue(null);
    const russiaHead = { ...headRow, title: "Russia announces new policy." };
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [russiaHead];
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) return [];
      if (call.query.includes("INSERT INTO entities")) return [{ id: "5", canonical_name: "Russia" }];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    const stats = await processNewArticles(sql);

    expect(stats.newEntities).toBe(1); // Russia still resolves via the heuristic dictionary layer
    expect(stats.llm).toEqual({ used: false, articles: 0, monthCostUsd: 0 });
  });

  it("issues zero LLM-related queries when isLlmConfigured() is false", async () => {
    vi.mocked(isLlmConfigured).mockReturnValue(false);
    const russiaHead = { ...headRow, title: "Russia announces new policy." };
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [russiaHead];
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) return [];
      if (call.query.includes("INSERT INTO entities")) return [{ id: "5", canonical_name: "Russia" }];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    await processNewArticles(sql);

    expect(extractEntitiesBatch).not.toHaveBeenCalled();
    expect(calls.some((c) => c.query.includes("llm_usage"))).toBe(false);
    expect(calls.some((c) => c.query.includes("FROM settings"))).toBe(false);
  });
});

describe("famous-entity auto-accept and relations persistence (entity-ingest wiring)", () => {
  const headRow = {
    id: "1",
    title: "Hyundai announces new plans today.",
    summary: "",
    published_at: "2026-07-15T09:00:00Z",
    first_seen_at: "2026-07-15T09:00:00Z",
    source_name: "Source A",
  };

  beforeEach(() => {
    vi.mocked(isLlmConfigured).mockReturnValue(true);
  });

  afterEach(() => {
    vi.mocked(isLlmConfigured).mockReturnValue(false);
    vi.mocked(extractEntitiesBatch).mockReset();
  });

  it("auto-accepts an unresolved 'famous' LLM candidate straight into entities as tracked, skipping entity_candidates", async () => {
    vi.mocked(extractEntitiesBatch).mockResolvedValue({
      candidates: new Map([
        [0, [{ display: "Hyundai", norm: "hyundai", typeHint: "company" as const, layer: "llm" as const, prominence: "famous" as const }]],
      ]),
      relations: new Map(),
    });
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [headRow];
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) return [];
      if (call.query.includes("INSERT INTO entities")) return [{ id: "9", canonical_name: "Hyundai" }];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    const stats = await processNewArticles(sql);

    expect(stats.newEntities).toBe(1);
    expect(stats.entities.autoAccepted).toBe(1);
    expect(stats.candidatesTouched).toBe(0);

    const insertCall = findCall(calls, "INSERT INTO entities");
    expect(insertCall!.values[0]).toEqual(["Hyundai"]);
    expect(insertCall!.values[1]).toEqual(["company"]);
    expect(findCall(calls, "INSERT INTO entity_candidates")).toBeUndefined();
  });

  it("keeps a 'known' or 'obscure' LLM candidate in the review queue instead of auto-accepting it", async () => {
    vi.mocked(extractEntitiesBatch).mockResolvedValue({
      candidates: new Map([
        [0, [{ display: "Someone Regional", norm: "someone regional", typeHint: "person" as const, layer: "llm" as const, prominence: "obscure" as const }]],
      ]),
      relations: new Map(),
    });
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [headRow];
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) return [];
      if (call.query.includes("INSERT INTO entities")) return [];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    const stats = await processNewArticles(sql);

    expect(stats.entities.autoAccepted).toBe(0);
    expect(stats.newEntities).toBe(0);
    expect(stats.candidatesTouched).toBe(1);
    const payload = JSON.parse(findCall(calls, "INSERT INTO entity_candidates")!.values[0] as string);
    expect(payload.some((p: { name_norm: string }) => p.name_norm === "someone regional")).toBe(true);
  });

  it("persists a relation once both endpoints resolve in the same run, including same-run famous auto-accepts", async () => {
    vi.mocked(extractEntitiesBatch).mockResolvedValue({
      candidates: new Map([
        [0, [
          { display: "Hyundai", norm: "hyundai", typeHint: "company" as const, layer: "llm" as const, prominence: "famous" as const },
          { display: "Boston Dynamics", norm: "boston dynamics", typeHint: "company" as const, layer: "llm" as const, prominence: "famous" as const },
        ]],
      ]),
      relations: new Map([[0, [{ source: "Hyundai", target: "Boston Dynamics", relation: "acquisition" as const }]]]),
    });
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [headRow];
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) return [];
      if (call.query.includes("INSERT INTO entities")) {
        return [{ id: "9", canonical_name: "Hyundai" }, { id: "10", canonical_name: "Boston Dynamics" }];
      }
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    const stats = await processNewArticles(sql);

    expect(stats.entities.autoAccepted).toBe(2);
    expect(stats.relations.written).toBe(1);
    const relationsInsertCall = findCall(calls, "INSERT INTO entity_relations");
    expect(relationsInsertCall).toBeDefined();
    expect(relationsInsertCall!.values[0]).toEqual([9]);
    expect(relationsInsertCall!.values[1]).toEqual([10]);
    expect(relationsInsertCall!.values[2]).toEqual(["acquisition"]);
  });

  it("drops a relation this run when one endpoint doesn't resolve, but still auto-accepts the resolved endpoint", async () => {
    vi.mocked(extractEntitiesBatch).mockResolvedValue({
      candidates: new Map([
        [0, [
          { display: "Hyundai", norm: "hyundai", typeHint: "company" as const, layer: "llm" as const, prominence: "famous" as const },
          { display: "Boston Dynamics", norm: "boston dynamics", typeHint: "company" as const, layer: "llm" as const, prominence: "obscure" as const },
        ]],
      ]),
      relations: new Map([[0, [{ source: "Hyundai", target: "Boston Dynamics", relation: "acquisition" as const }]]]),
    });
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [headRow];
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) return [];
      if (call.query.includes("INSERT INTO entities")) return [{ id: "9", canonical_name: "Hyundai" }];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    const stats = await processNewArticles(sql);

    expect(stats.entities.autoAccepted).toBe(1);
    expect(stats.relations.written).toBe(0);
    expect(findCall(calls, "INSERT INTO entity_relations")).toBeUndefined();
  });

  it("drops a degenerate self-relation when both endpoints resolve to the same entity via alias overlap", async () => {
    vi.mocked(extractEntitiesBatch).mockResolvedValue({
      candidates: new Map([
        [0, [
          { display: "Hyundai", norm: "hyundai", typeHint: "company" as const, layer: "llm" as const, prominence: "known" as const },
          { display: "Hyundai Motor Group", norm: "hyundai motor group", typeHint: "company" as const, layer: "llm" as const, prominence: "known" as const },
        ]],
      ]),
      relations: new Map([[0, [{ source: "Hyundai", target: "Hyundai Motor Group", relation: "partnership" as const }]]]),
    });
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return [headRow];
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) {
        return [{ id: "50", canonical_name: "Hyundai Motor Group", type: "company", aliases: ["Hyundai"] }];
      }
      if (call.query.includes("INSERT INTO entities")) return [];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });

    const stats = await processNewArticles(sql);

    expect(stats.relations.written).toBe(0);
    expect(findCall(calls, "INSERT INTO entity_relations")).toBeUndefined();
  });
});

describe("LLM wave concurrency and wall-clock deadline (entity-ingest wiring)", () => {
  function makeHeads(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: String(i + 1),
      title: `Headline number ${i + 1}`,
      summary: "",
      published_at: "2026-07-15T09:00:00Z",
      first_seen_at: "2026-07-15T09:00:00Z",
      source_name: "Source A",
    }));
  }

  function makeSql(heads: ReturnType<typeof makeHeads>) {
    return makeMockSql((call) => {
      if (call.query.includes("FROM articles a")) return heads;
      if (call.query.includes("SELECT id, canonical_name, type, aliases")) return [];
      if (call.query.includes("INSERT INTO entities")) return [];
      if (call.query.includes("SELECT name_norm")) return [];
      return [];
    });
  }

  beforeEach(() => {
    vi.mocked(isLlmConfigured).mockReturnValue(true);
  });

  afterEach(() => {
    vi.mocked(isLlmConfigured).mockReturnValue(false);
    vi.mocked(extractEntitiesBatch).mockReset();
  });

  it("dispatches up to 3 batches per wave concurrently, not strictly sequentially", async () => {
    // 60 articles -> batches of [25, 25, 10] -> a single wave of 3 batches.
    const { sql } = makeSql(makeHeads(60));

    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(extractEntitiesBatch).mockImplementation(async (_sql, _budget, articles) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { candidates: new Map(articles.map((a) => [a.index, []])), relations: new Map() };
    });

    await processNewArticles(sql);

    expect(extractEntitiesBatch).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(3);
  });

  it("runs the first wave, skips the second once the deadline has passed, and still marks every article processed", async () => {
    // 76 articles -> batches of [25, 25, 25, 1] -> waves of [3 batches] then [1 batch].
    const heads = makeHeads(76);
    const { sql, calls } = makeSql(heads);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    const deadline = Date.now() + 20_000;
    vi.mocked(extractEntitiesBatch).mockImplementation(async (_sql, _budget, articles) => {
      // Simulate a wave slow enough to blow the wall-clock budget.
      vi.advanceTimersByTime(25_000);
      return { candidates: new Map(articles.map((a) => [a.index, []])), relations: new Map() };
    });

    const stats = await processNewArticles(sql, deadline);
    vi.useRealTimers();

    expect(extractEntitiesBatch).toHaveBeenCalledTimes(3); // only wave 1's 3 batches
    expect(stats.llm.articles).toBe(75); // wave 1: 3 batches x 25 articles
    expect(stats.articlesProcessed).toBe(76); // wave 2's 1 article still processed via heuristics
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("1 article(s) fell back"));

    const markCall = calls[calls.length - 1];
    expect(markCall.query).toContain("entities_processed_at = now()");
    expect(markCall.values[0]).toHaveLength(76);

    warnSpy.mockRestore();
  });
});
