import { describe, it, expect } from "vitest";
import {
  headline,
  parseFeedResponse,
  cursorOf,
  worldNote,
  matchesFilter,
  timeLabel,
  isStale,
  applyEntityStatus,
  applyCandidateStatus,
  mergeNewer,
  rowEntities,
  type FeedArticle,
} from "../feed-logic";
import { encodeCursor } from "@/lib/server/feed";

const NOW = new Date("2026-11-16T12:00:00.000Z");

function article(over: Partial<FeedArticle> = {}): FeedArticle {
  return {
    id: "1",
    title: "T",
    link: "https://x.test/a",
    sourceName: "S",
    sourceCategory: "news",
    firstSeenAt: "2026-11-16T11:00:00.000Z",
    publishedAt: null,
    titleEn: null,
    entities: [
      { id: "1", name: "Acme", type: "company", status: "tracked", role: "satellite", firstSeenAt: "2026-01-01T00:00:00.000Z" },
      { id: "2", name: "Bolt", type: "company", status: "candidate", role: "satellite", firstSeenAt: "2026-01-01T00:00:00.000Z" },
      { id: "3", name: "Zed", type: "person", status: "dismissed", role: "famous", firstSeenAt: "2026-01-01T00:00:00.000Z" },
    ],
    candidates: [{ nameNorm: "cyan", name: "Cyan", typeHint: "company", firstSeenAt: "2026-11-16T08:00:00.000Z", mentionCount: 3 }],
    ...over,
  };
}

describe("parseFeedResponse", () => {
  it("accepts a valid body and nulls missing cursors", () => {
    const parsed = parseFeedResponse({ items: [article()] });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.nextCursor).toBeNull();
    expect(parsed.lastIngestAt).toBeNull();
  });
  it("throws on a bad shape", () => {
    expect(() => parseFeedResponse({})).toThrow();
    expect(() => parseFeedResponse({ items: [{ id: 1 }] })).toThrow();
  });
});

describe("cursorOf", () => {
  it("matches the server encoding", () => {
    const a = article();
    expect(cursorOf(a)).toBe(encodeCursor({ firstSeenAt: a.firstSeenAt, id: a.id }));
  });
});

describe("worldNote and rowEntities", () => {
  it("splits tracked from untracked and ignores dismissed", () => {
    expect(worldNote(article())).toEqual({ inWorld: ["Acme"], notTracked: ["Bolt", "Cyan"] });
  });
  it("orders tracked, untracked, dismissed", () => {
    expect(rowEntities(article()).map((r) => r.name)).toEqual(["Acme", "Bolt", "Cyan", "Zed"]);
  });
});

describe("matchesFilter", () => {
  it("applies each filter", () => {
    const plain = article({ entities: [], candidates: [] });
    expect(matchesFilter(plain, "all", NOW)).toBe(true);
    expect(matchesFilter(plain, "tracked", NOW)).toBe(false);
    expect(matchesFilter(plain, "untracked", NOW)).toBe(false);
    expect(matchesFilter(plain, "new", NOW)).toBe(false);
    expect(matchesFilter(article(), "tracked", NOW)).toBe(true);
    expect(matchesFilter(article(), "untracked", NOW)).toBe(true);
  });
  it("new means first seen within 24 hours", () => {
    expect(matchesFilter(article(), "new", NOW)).toBe(true); // candidate Cyan, 4 h old
    expect(matchesFilter(article({ candidates: [] }), "new", NOW)).toBe(false);
  });
});

describe("timeLabel", () => {
  it("hides publish time under 6 hours of lag", () => {
    const a = article({ publishedAt: "2026-11-16T06:00:00.000Z" });
    expect(timeLabel(a, NOW)).toBe("Arrived 1 h ago");
  });
  it("shows publish time at 6 hours of lag", () => {
    const a = article({ publishedAt: "2026-11-16T05:00:00.000Z" });
    expect(timeLabel(a, NOW)).toBe("Arrived 1 h ago · published 7 h ago");
  });
});

describe("freshness", () => {
  it("flags stale after 2 hours and when never ingested", () => {
    expect(isStale("2026-11-16T09:59:00.000Z", NOW)).toBe(true);
    expect(isStale("2026-11-16T10:30:00.000Z", NOW)).toBe(false);
    expect(isStale(null, NOW)).toBe(true);
  });
});

describe("state changes", () => {
  it("sets an entity status everywhere", () => {
    const out = applyEntityStatus([article()], { entityId: "2", status: "tracked" });
    expect(out[0].entities.find((e) => e.id === "2")?.status).toBe("tracked");
  });
  it("moves an accepted candidate into entities as tracked", () => {
    const a = article();
    const out = applyCandidateStatus([a], a.candidates[0], "tracked");
    expect(out[0].candidates).toHaveLength(0);
    expect(out[0].entities.at(-1)).toMatchObject({ name: "Cyan", status: "tracked", type: "company" });
  });
  it("moves an ignored candidate into entities as dismissed", () => {
    const a = article();
    const out = applyCandidateStatus([a], a.candidates[0], "dismissed");
    expect(out[0].candidates).toHaveLength(0);
    expect(out[0].entities.at(-1)).toMatchObject({ name: "Cyan", status: "dismissed" });
  });
  it("merges newer articles once, on top", () => {
    const merged = mergeNewer([article({ id: "1" })], [article({ id: "2" }), article({ id: "1" })]);
    expect(merged.map((a) => a.id)).toEqual(["2", "1"]);
  });
});

describe("headline", () => {
  it("uses the translation and keeps the original for hover", () => {
    expect(headline(article({ title: "Irán ataca - Diario", titleEn: "Iran attacks" }))).toEqual({ text: "Iran attacks", original: "Irán ataca - Diario" });
  });

  it("strips the publisher suffix when there is no translation", () => {
    expect(headline(article({ title: "Iran attacks - Wire", titleEn: null }))).toEqual({ text: "Iran attacks", original: null });
  });
});
