import { describe, it, expect } from "vitest";
import { normalizeTitle, titleSignature, clusterItems } from "../story-cluster";
import type { FeedItem } from "../types";

let nextId = 0;

function makeItem(overrides: Partial<FeedItem>): FeedItem {
  nextId += 1;
  return {
    id: `item-${nextId}`,
    title: "Untitled",
    link: `https://example.com/${nextId}`,
    published: "2026-07-10T00:00:00.000Z",
    summary: "",
    sourceName: "Test Source",
    sourceCategory: "world",
    sourceTier: "1",
    imageUrl: "",
    ...overrides,
  };
}

describe("normalizeTitle", () => {
  it("lowercases and decodes basic HTML entities", () => {
    expect(normalizeTitle("Bosnia &amp; Herzegovina")).toBe("bosnia herzegovina");
  });

  it("decodes lt, gt, quot, and #39 entities", () => {
    expect(normalizeTitle("A &lt;tag&gt; &quot;quote&quot; &#39;s&#39;")).toBe(
      "a tag quote s",
    );
  });

  it("strips punctuation and collapses whitespace", () => {
    expect(normalizeTitle("Wait -- what?!  Really...")).toBe("wait what really");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeTitle("  Hello World  ")).toBe("hello world");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeTitle("")).toBe("");
  });
});

describe("titleSignature", () => {
  it("drops stopwords and short tokens", () => {
    expect(titleSignature("The report on the new plan")).toBe("plan");
  });

  it("sorts tokens alphabetically", () => {
    expect(titleSignature("Zebra Apple Mango")).toBe("apple|mango|zebra");
  });

  it("caps at 6 tokens", () => {
    const sig = titleSignature("alpha bravo charlie delta echo foxtrot golf hotel");
    expect(sig.split("|")).toHaveLength(6);
    expect(sig).toBe("alpha|bravo|charlie|delta|echo|foxtrot");
  });

  it("dedupes repeated tokens", () => {
    expect(titleSignature("storm storm storm warning")).toBe("storm|warning");
  });

  it("falls back to normalized title when every token is a stopword", () => {
    expect(titleSignature("The Of To")).toBe("the of to");
  });

  it("returns empty string for a blank title", () => {
    expect(titleSignature("")).toBe("");
  });
});

describe("clusterItems", () => {
  it("returns [] for empty input", () => {
    expect(clusterItems([])).toEqual([]);
  });

  it("clusters paraphrased wire coverage of the same event", () => {
    const reuters = makeItem({
      title: "Israel strikes targets in southern Lebanon after rocket fire",
      sourceName: "Reuters",
      published: "2026-07-10T08:00:00.000Z",
    });
    const bbc = makeItem({
      title: "Rocket fire in southern Lebanon: Israel strikes targets",
      sourceName: "BBC",
      published: "2026-07-10T09:30:00.000Z",
    });

    const clusters = clusterItems([bbc, reuters]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].sourceCount).toBe(2);
    expect(clusters[0].head.sourceName).toBe("Reuters");
    expect(clusters[0].members.map((m) => m.sourceName)).toEqual(["BBC", "Reuters"]);
    expect(clusters[0].latestAt).toBe(bbc.published);
  });

  it("does not cluster distinct stories about the same country", () => {
    const riots = makeItem({
      title: "Ecuador declares state of emergency over prison riots",
      sourceName: "AP",
    });
    const trade = makeItem({
      title: "Ecuador signs trade agreement with EU",
      sourceName: "Reuters",
    });

    const clusters = clusterItems([riots, trade]);

    expect(clusters).toHaveLength(2);
  });

  it("splits identical-title items into separate clusters outside the time window", () => {
    const first = makeItem({
      title: "Typhoon makes landfall in the Philippines",
      sourceName: "Reuters",
      published: "2026-07-01T00:00:00.000Z",
    });
    const second = makeItem({
      title: "Typhoon makes landfall in the Philippines",
      sourceName: "AP",
      published: "2026-07-03T12:00:00.000Z", // 60h later
    });

    const clusters = clusterItems([first, second], 48);

    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.members.length === 1)).toBe(true);
  });

  it("keeps identical-title items in one cluster inside the time window", () => {
    const first = makeItem({
      title: "Typhoon makes landfall in the Philippines",
      sourceName: "Reuters",
      published: "2026-07-01T00:00:00.000Z",
    });
    const second = makeItem({
      title: "Typhoon makes landfall in the Philippines",
      sourceName: "AP",
      published: "2026-07-03T12:00:00.000Z", // 60h later
    });

    const clusters = clusterItems([first, second], 72);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].sourceCount).toBe(2);
  });

  it("treats a single item as its own singleton cluster", () => {
    const solo = makeItem({ title: "A quiet news day somewhere" });

    const clusters = clusterItems([solo]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toEqual([solo]);
    expect(clusters[0].sourceCount).toBe(1);
    expect(clusters[0].head).toBe(solo);
  });

  it("isolates items with unparseable published dates as singletons", () => {
    const good = makeItem({
      title: "Central bank raises interest rates sharply",
      published: "2026-07-10T00:00:00.000Z",
    });
    const bad = makeItem({
      title: "Central bank raises interest rates sharply",
      published: "not-a-date",
    });

    const clusters = clusterItems([good, bad]);

    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.members.length === 1)).toBe(true);
  });

  it("does not crash on empty or whitespace titles and does not merge them", () => {
    const blank = makeItem({ title: "", sourceName: "Source A" });
    const whitespace = makeItem({ title: "   ", sourceName: "Source B" });
    const punctuation = makeItem({ title: "!!!", sourceName: "Source C" });

    const clusters = clusterItems([blank, whitespace, punctuation]);

    expect(clusters).toHaveLength(3);
    expect(clusters.every((c) => c.members.length === 1)).toBe(true);
  });

  it("sorts clusters by latestAt descending", () => {
    const older = makeItem({
      title: "Central bank raises interest rates sharply",
      published: "2026-07-01T00:00:00.000Z",
    });
    const newer = makeItem({
      title: "Election results announced in tense vote",
      published: "2026-07-12T00:00:00.000Z",
    });

    const clusters = clusterItems([older, newer]);

    expect(clusters[0].latestAt).toBe(newer.published);
    expect(clusters[1].latestAt).toBe(older.published);
  });

  it("is deterministic across repeated calls", () => {
    const items = [
      makeItem({ title: "Storm warning issued for coastal region", published: "2026-07-05T00:00:00.000Z" }),
      makeItem({ title: "Coastal region under storm warning tonight", published: "2026-07-05T04:00:00.000Z" }),
      makeItem({ title: "Central bank raises interest rates sharply", published: "2026-07-06T00:00:00.000Z" }),
    ];

    const first = clusterItems(items);
    const second = clusterItems(items);

    expect(first).toEqual(second);
  });
});
