import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectSignals } from "../signal-detector";
import { ExtractedEntity, FeedItem, UrgencyLevel } from "../types";

function makeEntity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    name: "TestEntity",
    type: "country",
    mentions: 10,
    itemIds: ["1", "2", "3"],
    urgencyBreakdown: {
      critical: 0,
      warning: 0,
      advisory: 0,
      monitoring: 0,
      system: 0,
      neutral: 10,
    },
    lastSeen: new Date().toISOString(),
    recentMentions: { hour: 5, sixHour: 8, day: 10 },
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

describe("detectSignals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an array of signals", () => {
    const entities = [makeEntity()];
    const items = [makeFeedItem()];
    const signals = detectSignals(entities, items, new Set());
    expect(Array.isArray(signals)).toBe(true);
  });

  it("detects surge signals for high-velocity entities", () => {
    const entity = makeEntity({
      name: "SurgeEntity",
      recentMentions: { hour: 15, sixHour: 20, day: 25 },
    });
    const items = Array.from({ length: 25 }, (_, i) =>
      makeFeedItem({ id: `item-${i}` })
    );
    const signals = detectSignals([entity], items, new Set());
    const surges = signals.filter((s) => s.type === "surge");
    expect(surges.length).toBeGreaterThanOrEqual(1);
  });

  it("detects sentiment deterioration", () => {
    const entity = makeEntity({
      name: "NegativeEntity",
      sentiment: -0.6,
      mentions: 8,
      recentMentions: { hour: 4, sixHour: 6, day: 8 },
    });
    const items = Array.from({ length: 10 }, (_, i) =>
      makeFeedItem({ id: `item-${i}` })
    );
    const signals = detectSignals([entity], items, new Set());
    const sentimentSignals = signals.filter(
      (s) => s.type === "sentiment_deterioration"
    );
    expect(sentimentSignals.length).toBeGreaterThanOrEqual(1);
  });

  it("detects novel emergence for new entities", () => {
    const entity = makeEntity({ name: "NewEntity" });
    const items = [makeFeedItem()];
    const previousNames = new Set(["OldEntity1", "OldEntity2"]);
    const signals = detectSignals([entity], items, previousNames);
    const novelSignals = signals.filter((s) => s.type === "novel_emergence");
    expect(novelSignals.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag existing entities as novel", () => {
    const entity = makeEntity({ name: "ExistingEntity" });
    const items = [makeFeedItem()];
    const previousNames = new Set(["ExistingEntity"]);
    const signals = detectSignals([entity], items, previousNames);
    const novelSignals = signals.filter(
      (s) => s.type === "novel_emergence" && s.entities.includes("ExistingEntity")
    );
    expect(novelSignals).toHaveLength(0);
  });

  it("handles empty entities", () => {
    const signals = detectSignals([], [], new Set());
    expect(signals).toHaveLength(0);
  });

  it("signals include required fields", () => {
    const entity = makeEntity({
      name: "TestEntity",
      recentMentions: { hour: 20, sixHour: 25, day: 30 },
    });
    const items = Array.from({ length: 30 }, (_, i) =>
      makeFeedItem({ id: `item-${i}` })
    );
    const signals = detectSignals([entity], items, new Set());
    if (signals.length > 0) {
      const signal = signals[0];
      expect(signal).toHaveProperty("id");
      expect(signal).toHaveProperty("type");
      expect(signal).toHaveProperty("severity");
      expect(signal).toHaveProperty("title");
      expect(signal).toHaveProperty("description");
      expect(signal).toHaveProperty("entities");
      expect(signal).toHaveProperty("confidence");
      expect(signal).toHaveProperty("detectedAt");
    }
  });

  it("sorts signals by severity", () => {
    const entities = [
      makeEntity({
        name: "CriticalEntity",
        recentMentions: { hour: 25, sixHour: 30, day: 35 },
        urgencyBreakdown: { critical: 10, warning: 0, advisory: 0, monitoring: 0, system: 0, neutral: 0 },
        sentiment: -0.8,
        mentions: 20,
      }),
      makeEntity({
        name: "MinorEntity",
        recentMentions: { hour: 3, sixHour: 5, day: 20 },
      }),
    ];
    const items = Array.from({ length: 35 }, (_, i) =>
      makeFeedItem({ id: `item-${i}` })
    );
    const signals = detectSignals(entities, items, new Set());
    if (signals.length >= 2) {
      const severityOrder = { critical: 0, warning: 1, advisory: 2 };
      for (let i = 1; i < signals.length; i++) {
        expect(
          severityOrder[signals[i - 1].severity]
        ).toBeLessThanOrEqual(severityOrder[signals[i].severity]);
      }
    }
  });
});
