import { describe, it, expect } from "vitest";
import { enrichEntities } from "../novelty-scorer";
import { edgeKey, AnalysisStores } from "../signal-storage";
import { ExtractedEntity, FeedItem, EdgeHistoryEntry } from "../types";

function makeEntity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    name: "TestEntity",
    type: "country",
    mentions: 1,
    itemIds: ["1"],
    urgencyBreakdown: {
      critical: 0,
      warning: 0,
      advisory: 0,
      monitoring: 0,
      system: 0,
      neutral: 1,
    },
    lastSeen: new Date().toISOString(),
    recentMentions: { hour: 1, sixHour: 1, day: 1 },
    cooccurrences: [],
    sentiment: 0,
    ...overrides,
  };
}

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "item-1",
    title: "Test",
    link: "https://example.com",
    published: new Date().toISOString(),
    summary: "",
    sourceName: "Source",
    sourceCategory: "conflict",
    sourceTier: "Tier 1",
    imageUrl: "",
    ...overrides,
  };
}

function emptyStores(): AnalysisStores {
  return { edgeHistory: new Map(), baselines: new Map() };
}

describe("enrichEntities", () => {
  it("is deterministic: identical inputs and stores produce identical output", () => {
    const items = [makeFeedItem({ id: "1" }), makeFeedItem({ id: "2", sourceCategory: "economy" })];
    const entities = [
      makeEntity({ itemIds: ["1", "2"], mentions: 2, cooccurrences: [["Other", 2]] }),
    ];
    const stores = emptyStores();
    const first = enrichEntities(entities, items, stores);
    const second = enrichEntities(entities, items, stores);
    expect(second).toEqual(first);
  });

  it("scores lower when the co-occurring edge is already in edge history", () => {
    const items = [makeFeedItem({ id: "1" })];
    const entity = makeEntity({
      name: "Alpha",
      itemIds: ["1"],
      mentions: 1,
      cooccurrences: [["Beta", 3]],
    });
    const key = edgeKey("Alpha", "Beta");
    const knownEdge: EdgeHistoryEntry = {
      firstSeen: "2024-01-01T00:00:00.000Z",
      lastSeen: "2024-01-01T00:00:00.000Z",
      count: 3,
    };
    const withHistory = enrichEntities(
      [entity],
      items,
      { edgeHistory: new Map([[key, knownEdge]]), baselines: new Map() },
    );
    const withoutHistory = enrichEntities([entity], items, emptyStores());

    expect(withHistory[0].noveltyReasons.some((r) => r.type === "novel_edge")).toBe(false);
    expect(withoutHistory[0].noveltyReasons.some((r) => r.type === "novel_edge")).toBe(true);
    expect(withHistory[0].noveltyScore).toBeLessThan(withoutHistory[0].noveltyScore);
  });

  it("gives the flat first-appearance emergence score when baselines are empty", () => {
    const items = [makeFeedItem({ id: "1" })];
    const entity = makeEntity({ name: "Gamma", itemIds: ["1"], mentions: 2 });
    const [result] = enrichEntities([entity], items, emptyStores());
    const emergenceReason = result.noveltyReasons.find((r) => r.type === "entity_emergence");
    expect(emergenceReason?.score).toBe(10);
  });

  it("performs no localStorage I/O", () => {
    const original = (globalThis as { localStorage?: unknown }).localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("enrichEntities must not access localStorage");
      },
    });
    try {
      const items = [makeFeedItem({ id: "1" })];
      const entities = [makeEntity({ itemIds: ["1"] })];
      expect(() => enrichEntities(entities, items, emptyStores())).not.toThrow();
    } finally {
      if (original === undefined) {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          value: original,
        });
      }
    }
  });
});
