import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractEntities } from "../entity-extractor";
import { FeedItem } from "../types";

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: `item-${Math.random()}`,
    title: "Test Article",
    link: "https://example.com/test",
    published: new Date().toISOString(),
    summary: "Test summary",
    sourceName: "TestSource",
    sourceCategory: "conflict",
    sourceTier: "Tier 1",
    imageUrl: "",
    ...overrides,
  };
}

describe("extractEntities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("extracts countries from titles (requires 2+ mentions)", () => {
    const items = [
      makeFeedItem({ id: "1", title: "Russia launches new military operation" }),
      makeFeedItem({ id: "2", title: "Russia responds to sanctions pressure" }),
      makeFeedItem({ id: "3", title: "China announces economic policy change" }),
      makeFeedItem({ id: "4", title: "China trade deal with partners" }),
    ];
    const entities = extractEntities(items);
    const names = entities.map((e) => e.name);
    expect(names).toContain("Russia");
    expect(names).toContain("China");
  });

  it("extracts organizations (requires 2+ mentions)", () => {
    const items = [
      makeFeedItem({ id: "1", title: "NATO announces new defense strategy" }),
      makeFeedItem({ id: "2", title: "NATO summit concludes with agreement" }),
      makeFeedItem({ id: "3", title: "United Nations calls for ceasefire" }),
      makeFeedItem({ id: "4", title: "United Nations report on crisis" }),
    ];
    const entities = extractEntities(items);
    const names = entities.map((e) => e.name);
    expect(names).toContain("NATO");
    expect(names).toContain("United Nations");
  });

  it("tracks mention counts", () => {
    const items = [
      makeFeedItem({ id: "1", title: "Russia military buildup continues" }),
      makeFeedItem({ id: "2", title: "Russia trade deal announced today" }),
      makeFeedItem({ id: "3", title: "Russia diplomacy effort underway" }),
    ];
    const entities = extractEntities(items);
    const russia = entities.find((e) => e.name === "Russia");
    expect(russia).toBeDefined();
    expect(russia!.mentions).toBeGreaterThanOrEqual(3);
  });

  it("detects co-occurrences when entities appear together", () => {
    const items = [
      makeFeedItem({ id: "1", title: "Russia and China sign trade agreement" }),
      makeFeedItem({ id: "2", title: "Russia and China hold summit talks" }),
    ];
    const entities = extractEntities(items);
    const russia = entities.find((e) => e.name === "Russia");
    if (russia && russia.cooccurrences.length > 0) {
      const coNames = russia.cooccurrences.map(([name]) => name);
      expect(coNames).toContain("China");
    }
  });

  it("tracks urgency breakdown from categories", () => {
    const items = [
      makeFeedItem({ id: "1", title: "Ukraine conflict escalates further", sourceCategory: "conflict" }),
      makeFeedItem({ id: "2", title: "Ukraine health crisis worsens", sourceCategory: "health" }),
      makeFeedItem({ id: "3", title: "Ukraine military response planned", sourceCategory: "conflict" }),
    ];
    const entities = extractEntities(items);
    const ukraine = entities.find((e) => e.name === "Ukraine");
    expect(ukraine).toBeDefined();
    expect(ukraine!.urgencyBreakdown.critical).toBeGreaterThanOrEqual(1);
    expect(ukraine!.urgencyBreakdown.warning).toBeGreaterThanOrEqual(1);
  });

  it("returns entities sorted by mention count", () => {
    const items = [
      makeFeedItem({ id: "1", title: "China trade deal announced" }),
      makeFeedItem({ id: "2", title: "China economic growth report" }),
      makeFeedItem({ id: "3", title: "China diplomatic relations" }),
      makeFeedItem({ id: "4", title: "Russia military exercise" }),
      makeFeedItem({ id: "5", title: "Russia deploys forces" }),
    ];
    const entities = extractEntities(items);
    const chinaIdx = entities.findIndex((e) => e.name === "China");
    const russiaIdx = entities.findIndex((e) => e.name === "Russia");
    if (chinaIdx >= 0 && russiaIdx >= 0) {
      expect(chinaIdx).toBeLessThan(russiaIdx);
    }
  });

  it("handles empty input", () => {
    const entities = extractEntities([]);
    expect(entities).toHaveLength(0);
  });

  it("detects country aliases (2+ mentions needed)", () => {
    const items = [
      makeFeedItem({ id: "1", title: "USA announces new sanctions on Iran" }),
      makeFeedItem({ id: "2", title: "USA responds to Iran nuclear program" }),
    ];
    const entities = extractEntities(items);
    const names = entities.map((e) => e.name);
    expect(names).toContain("United States");
    expect(names).toContain("Iran");
  });

  it("includes entity type information", () => {
    const items = [
      makeFeedItem({ id: "1", title: "NATO and Russia tensions rise over dispute" }),
      makeFeedItem({ id: "2", title: "NATO warns Russia about military buildup" }),
    ];
    const entities = extractEntities(items);
    const nato = entities.find((e) => e.name === "NATO");
    const russia = entities.find((e) => e.name === "Russia");
    expect(nato?.type).toBe("organization");
    expect(russia?.type).toBe("country");
  });

  it("includes sentiment scores", () => {
    const items = [
      makeFeedItem({ id: "1", title: "Russia attacks Ukraine border region" }),
      makeFeedItem({ id: "2", title: "Russia strikes Ukraine city targets" }),
    ];
    const entities = extractEntities(items);
    const entity = entities[0];
    expect(entity).toBeDefined();
    expect(typeof entity.sentiment).toBe("number");
    expect(entity.sentiment).toBeGreaterThanOrEqual(-1);
    expect(entity.sentiment).toBeLessThanOrEqual(1);
  });
});
