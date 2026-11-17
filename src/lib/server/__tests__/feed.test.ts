import { describe, it, expect } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  parseFeedParams,
  toFeedArticle,
  toFeedEntity,
  groupEntitiesByArticle,
  paginate,
  toFeedCandidate,
  matchArticleCandidates,
  buildTrackedMatcher,
  matchTrackedEntities,
  FeedParamError,
  type FeedParams,
} from "../feed";
import type { SqlRow } from "../db";
import { buildCandidateMatcher } from "../../candidate-match";

const ISO = "2026-03-01T12:00:00.000Z";

function parse(query: string) {
  return parseFeedParams(new URLSearchParams(query));
}

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

describe("cursor", () => {
  it("round-trips", () => {
    const cursor = { firstSeenAt: ISO, id: "42" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ["no separator", b64(ISO)],
    ["extra separator", b64(`${ISO}|1|2`)],
    ["bad date", b64("yesterday|1")],
    ["non-canonical date", b64("2026-03-01|1")],
    ["non-digit id", b64(`${ISO}|abc`)],
    ["sql in id", b64(`${ISO}|1; DROP`)],
    ["empty", ""],
  ])("rejects %s", (_label, raw) => {
    expect(() => decodeCursor(raw)).toThrow(FeedParamError);
  });
});

describe("parseFeedParams", () => {
  it("defaults to limit 50 and no cursors", () => {
    expect(parse("")).toEqual({ limit: 50, before: null, after: null });
  });

  it("accepts limit bounds", () => {
    expect(parse("limit=1").limit).toBe(1);
    expect(parse("limit=100").limit).toBe(100);
  });

  it.each(["0", "101", "-1", "1.5", "abc", ""])("rejects limit=%s", (value) => {
    expect(() => parse(`limit=${value}`)).toThrow(FeedParamError);
  });

  it("decodes before and after", () => {
    const cursor = encodeCursor({ firstSeenAt: ISO, id: "7" });
    expect(parse(`before=${cursor}`).before).toEqual({ firstSeenAt: ISO, id: "7" });
    expect(parse(`after=${cursor}`).after).toEqual({ firstSeenAt: ISO, id: "7" });
  });

  it("rejects before with after", () => {
    const cursor = encodeCursor({ firstSeenAt: ISO, id: "7" });
    expect(() => parse(`before=${cursor}&after=${cursor}`)).toThrow(FeedParamError);
  });

  it("rejects a bad cursor", () => {
    expect(() => parse("before=!!!")).toThrow(FeedParamError);
  });
});

describe("row shaping", () => {
  const articleRow: SqlRow = {
    id: 9,
    title: "Fictional Corp opens plant",
    link: "https://example.test/a",
    source_name: "Example Wire",
    source_category: "business",
    first_seen_at: new Date(ISO),
    published_at: null,
  };
  const entityRow: SqlRow = {
    article_id: 9,
    entity_id: 3,
    canonical_name: "Fictional Corp",
    type: "organization",
    status: "tracked",
    entity_first_seen_at: new Date(ISO),
  };

  it("shapes an article with string ids and ISO dates", () => {
    const entity = toFeedEntity(entityRow, "famous");
    expect(toFeedArticle(articleRow, [entity])).toEqual({
      id: "9",
      title: "Fictional Corp opens plant",
      link: "https://example.test/a",
      sourceName: "Example Wire",
      sourceCategory: "business",
      firstSeenAt: ISO,
      publishedAt: null,
      titleEn: null,
      entities: [
        { id: "3", name: "Fictional Corp", type: "organization", status: "tracked", role: "famous", firstSeenAt: ISO },
      ],
      candidates: [],
    });
  });

  it("maps title_en to titleEn", () => {
    expect(toFeedArticle({ ...articleRow, title_en: "Plant opens" }, []).titleEn).toBe("Plant opens");
  });

  it("converts a published_at value", () => {
    const article = toFeedArticle({ ...articleRow, published_at: "2026-02-28T00:00:00Z" }, []);
    expect(article.publishedAt).toBe("2026-02-28T00:00:00.000Z");
  });

  it("throws on an unknown entity status", () => {
    expect(() => toFeedEntity({ ...entityRow, status: "weird" }, "satellite")).toThrow();
  });

  it("groups entities by article and defaults a missing role to satellite", () => {
    const rows = [entityRow, { ...entityRow, entity_id: 4 }, { ...entityRow, article_id: 10 }];
    const grouped = groupEntitiesByArticle(rows, new Map([["3", "anchor"]]));
    expect(grouped.get("9")?.map((e) => e.role)).toEqual(["anchor", "satellite"]);
    expect(grouped.get("10")).toHaveLength(1);
  });
});

describe("paginate", () => {
  const rows: SqlRow[] = [3, 2, 1].map((id) => ({ id, first_seen_at: new Date(ISO) }));
  const base: FeedParams = { limit: 2, before: null, after: null };

  it("trims the probe row and emits a cursor at the last kept row", () => {
    const { pageRows, nextCursor } = paginate(rows, base);
    expect(pageRows.map((r) => r.id)).toEqual([3, 2]);
    expect(decodeCursor(nextCursor as string)).toEqual({ firstSeenAt: ISO, id: "2" });
  });

  it("has no cursor on the last page", () => {
    expect(paginate(rows.slice(0, 2), base).nextCursor).toBeNull();
  });

  it("has no cursor for after pages", () => {
    const after = { ...base, after: { firstSeenAt: ISO, id: "0" } };
    expect(paginate(rows, after).nextCursor).toBeNull();
  });
});

describe("candidate matching", () => {
  const candidateRow = { name_norm: "okonjo", display_name: "Okonjo", type_hint: "person", first_seen_at: ISO, mention_count: "4" };
  const tracked = { id: "3", name: "Fictional Corp", type: "organization", status: "tracked" as const, role: "satellite" as const, firstSeenAt: ISO };

  it("shapes a candidate row", () => {
    expect(toFeedCandidate(candidateRow)).toMatchObject({ nameNorm: "okonjo", name: "Okonjo", typeHint: "person", firstSeenAt: ISO, mentionCount: 4 });
  });

  it("matches names in title or summary and skips names already linked", () => {
    const matcher = buildCandidateMatcher([
      toFeedCandidate(candidateRow),
      toFeedCandidate({ ...candidateRow, name_norm: "fictional corp", display_name: "Fictional Corp" }),
      toFeedCandidate({ ...candidateRow, name_norm: "lagos", display_name: "Lagos" }),
    ]);
    const row = { title: "Fictional Corp hires Okonjo", summary: "Plant opens near Lagos." };
    const found = matchArticleCandidates(row, [tracked], matcher);
    expect(found.map((c) => c.name)).toEqual(["Okonjo", "Lagos"]);
    expect(found[0]).not.toHaveProperty("displayName");
  });

  it("skips the article's own source name", () => {
    const matcher = buildCandidateMatcher([toFeedCandidate({ ...candidateRow, name_norm: "bangkok post", display_name: "Bangkok Post" })]);
    const row = { title: "Bangkok Post staff vote", summary: null, source_name: "Bangkok Post" };
    expect(matchArticleCandidates(row, [], matcher)).toEqual([]);
  });

  it("handles a null summary", () => {
    const matcher = buildCandidateMatcher([toFeedCandidate(candidateRow)]);
    expect(matchArticleCandidates({ title: "No names here", summary: null }, [], matcher)).toEqual([]);
  });
});

describe("tracked entity matching", () => {
  const entityRow = (id: string, name: string, aliases: string[] = []) => ({
    entity_id: id, canonical_name: name, type: "person", status: "tracked", aliases, fame: "famous", entity_first_seen_at: ISO,
  });
  const ids = (title: string, rows: SqlRow[], extra: SqlRow = {}) =>
    matchTrackedEntities({ title, summary: null, source_name: "AP", ...extra }, buildTrackedMatcher(rows)).map((r) => r.entity_id);

  it("matches a single-word tracked name with a possessive", () => {
    expect(ids("Sen. Warren raises concerns over Trump's aide", [entityRow("1", "Trump")])).toEqual(["1"]);
  });

  it("matches a bare surname only through an alias, not from the full name", () => {
    expect(ids("Trump aide bets", [entityRow("1", "Donald Trump")])).toEqual([]);
    expect(ids("Trump aide bets", [entityRow("1", "Donald Trump", ["Trump"])])).toEqual(["1"]);
  });

  it("dedupes one entity matched by name and alias", () => {
    expect(ids("Donald Trump said Trump will go", [entityRow("1", "Donald Trump", ["Trump"])])).toEqual(["1"]);
  });

  it("requires own capitals for one-word names and ignores the publisher suffix", () => {
    expect(ids("Middle east talks", [entityRow("1", "East")])).toEqual([]);
    expect(ids("Talks resume - Reuters", [entityRow("1", "Reuters")])).toEqual([]);
  });

  it("matches in the summary", () => {
    expect(ids("Ethics concerns", [entityRow("1", "Merkley")], { summary: "Sen. Merkley said" })).toEqual(["1"]);
  });
});
