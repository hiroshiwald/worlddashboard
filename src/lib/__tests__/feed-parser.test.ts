import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseRssItems, parseAtomEntries, parseFeedXml } from "../feed-fetcher";
import { SourceMeta } from "../types";

const testSource: SourceMeta = {
  name: "TestSource",
  category: "conflict",
  tier: "Tier 1",
  url: "https://example.com/rss",
  type: "RSS",
};

describe("parseRssItems", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses basic RSS items", () => {
    const xml = `
      <rss><channel>
        <item>
          <title>Test Article</title>
          <link>https://example.com/article</link>
          <pubDate>Sat, 15 Jun 2024 10:00:00 GMT</pubDate>
          <description>Test description</description>
        </item>
      </channel></rss>
    `;
    const items = parseRssItems(xml, testSource);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Test Article");
    expect(items[0].link).toBe("https://example.com/article");
    expect(items[0].sourceName).toBe("TestSource");
    expect(items[0].sourceCategory).toBe("conflict");
  });

  it("filters items older than 7 days", () => {
    const xml = `
      <rss><channel>
        <item>
          <title>Old Article</title>
          <link>https://example.com/old</link>
          <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
          <description>Old content</description>
        </item>
      </channel></rss>
    `;
    const items = parseRssItems(xml, testSource);
    expect(items).toHaveLength(0);
  });

  it("filters ad content", () => {
    const xml = `
      <rss><channel>
        <item>
          <title>Best laptop deals of 2024</title>
          <link>https://example.com/deals/laptops</link>
          <pubDate>Sat, 15 Jun 2024 10:00:00 GMT</pubDate>
          <description>Great deals</description>
        </item>
      </channel></rss>
    `;
    const items = parseRssItems(xml, testSource);
    expect(items).toHaveLength(0);
  });

  it("caps at MAX_ITEMS_PER_FEED (15)", () => {
    const itemXml = Array.from({ length: 20 }, (_, i) => `
      <item>
        <title>Article ${i}</title>
        <link>https://example.com/${i}</link>
        <pubDate>Sat, 15 Jun 2024 ${String(i % 24).padStart(2, "0")}:00:00 GMT</pubDate>
        <description>Content ${i}</description>
      </item>
    `).join("");
    const xml = `<rss><channel>${itemXml}</channel></rss>`;
    const items = parseRssItems(xml, testSource);
    expect(items).toHaveLength(15);
  });

  it("skips dateless items when feed has dates", () => {
    const xml = `
      <rss><channel>
        <item>
          <title>Dated Article</title>
          <link>https://example.com/dated</link>
          <pubDate>Sat, 15 Jun 2024 10:00:00 GMT</pubDate>
          <description>Has date</description>
        </item>
        <item>
          <title>Undated Article</title>
          <link>https://example.com/undated</link>
          <description>No date</description>
        </item>
      </channel></rss>
    `;
    const items = parseRssItems(xml, testSource);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Dated Article");
  });

  it("strips HTML from descriptions", () => {
    const xml = `
      <rss><channel>
        <item>
          <title>Article</title>
          <link>https://example.com/a</link>
          <pubDate>Sat, 15 Jun 2024 10:00:00 GMT</pubDate>
          <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
        </item>
      </channel></rss>
    `;
    const items = parseRssItems(xml, testSource);
    expect(items[0].summary).toBe("Hello world");
  });

  it("handles CDATA in title", () => {
    const xml = `
      <rss><channel>
        <item>
          <title><![CDATA[Breaking: Major Event]]></title>
          <link>https://example.com/b</link>
          <pubDate>Sat, 15 Jun 2024 10:00:00 GMT</pubDate>
          <description>Details</description>
        </item>
      </channel></rss>
    `;
    const items = parseRssItems(xml, testSource);
    expect(items[0].title).toBe("Breaking: Major Event");
  });
});

describe("parseAtomEntries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses basic Atom entries", () => {
    const xml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Atom Article</title>
          <link href="https://example.com/atom-article" />
          <updated>2024-06-15T10:00:00Z</updated>
          <summary>Atom summary</summary>
        </entry>
      </feed>
    `;
    const items = parseAtomEntries(xml, testSource);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Atom Article");
    expect(items[0].link).toBe("https://example.com/atom-article");
  });

  it("filters old Atom entries", () => {
    const xml = `
      <feed><entry>
        <title>Old Entry</title>
        <link href="https://example.com/old" />
        <updated>2024-01-01T10:00:00Z</updated>
        <summary>Old</summary>
      </entry></feed>
    `;
    const items = parseAtomEntries(xml, testSource);
    expect(items).toHaveLength(0);
  });
});

describe("parseFeedXml", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects Atom format and uses Atom parser", () => {
    const xml = `
      <feed><entry>
        <title>Atom</title>
        <link href="https://example.com/a" />
        <updated>2024-06-15T10:00:00Z</updated>
        <summary>Test</summary>
      </entry></feed>
    `;
    const items = parseFeedXml(xml, testSource);
    expect(items).toHaveLength(1);
  });

  it("defaults to RSS parser", () => {
    const xml = `
      <rss><channel>
        <item>
          <title>RSS</title>
          <link>https://example.com/r</link>
          <pubDate>Sat, 15 Jun 2024 10:00:00 GMT</pubDate>
          <description>Test</description>
        </item>
      </channel></rss>
    `;
    const items = parseFeedXml(xml, testSource);
    expect(items).toHaveLength(1);
  });
});
