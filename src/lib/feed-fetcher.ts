import { FeedItem, SourceMeta } from "./types";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(xml: string, tag: string): string {
  // Try CDATA first
  const cdataRe = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    "i"
  );
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  // Then normal tag content
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(re);
  return match ? match[1].trim() : "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
  const match = xml.match(re);
  return match ? match[1].trim() : "";
}

function parseRssItems(xml: string, source: SourceMeta): FeedItem[] {
  const items: FeedItem[] = [];
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // RSS 2.0: <item>...</item>
  const rssItemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = rssItemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = stripHtml(extractTag(block, "title"));
    let link = extractTag(block, "link");
    // Sometimes <link> is empty and URL is just text after tag
    if (!link) {
      const linkMatch = block.match(/<link[^>]*\/?\s*>\s*([^<\s]+)/i);
      if (linkMatch) link = linkMatch[1].trim();
    }
    const pubDate = extractTag(block, "pubDate") || extractTag(block, "dc:date");
    const description =
      extractTag(block, "description") || extractTag(block, "content:encoded");

    const published = pubDate ? new Date(pubDate) : null;
    if (published && !isNaN(published.getTime()) && published.getTime() < sevenDaysAgo) {
      continue;
    }

    if (title) {
      items.push({
        id: `${source.name}-${title.slice(0, 40)}-${pubDate || Math.random()}`,
        title,
        link: link || source.url,
        published: published ? published.toISOString() : new Date().toISOString(),
        summary: stripHtml(description).slice(0, 300),
        sourceName: source.name,
        sourceCategory: source.category,
        sourceTier: source.tier,
      });
    }
  }

  return items;
}

function parseAtomEntries(xml: string, source: SourceMeta): FeedItem[] {
  const items: FeedItem[] = [];
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = stripHtml(extractTag(block, "title"));
    let link = extractAttr(block, "link", "href");
    if (!link) link = extractTag(block, "link");
    const updated = extractTag(block, "updated") || extractTag(block, "published");
    const summary = extractTag(block, "summary") || extractTag(block, "content");

    const published = updated ? new Date(updated) : null;
    if (published && !isNaN(published.getTime()) && published.getTime() < sevenDaysAgo) {
      continue;
    }

    if (title) {
      items.push({
        id: `${source.name}-${title.slice(0, 40)}-${updated || Math.random()}`,
        title,
        link: link || source.url,
        published: published ? published.toISOString() : new Date().toISOString(),
        summary: stripHtml(summary).slice(0, 300),
        sourceName: source.name,
        sourceCategory: source.category,
        sourceTier: source.tier,
      });
    }
  }

  return items;
}

function parseFeedXml(xml: string, source: SourceMeta): FeedItem[] {
  // Detect if Atom or RSS
  if (xml.includes("<feed") && xml.includes("<entry")) {
    return parseAtomEntries(xml, source);
  }
  return parseRssItems(xml, source);
}

async function fetchSingleFeed(source: SourceMeta): Promise<FeedItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "WorldDashboard/1.0 (RSS Feed Reader)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });

    if (!res.ok) return [];
    const text = await res.text();
    return parseFeedXml(text, source);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAllFeeds(sources: SourceMeta[]): Promise<{
  items: FeedItem[];
  feedsAttempted: number;
  feedsSucceeded: number;
}> {
  // Filter to only RSS/Atom feeds with valid HTTP URLs
  const rssFeeds = sources.filter(
    (s) =>
      (s.type.includes("RSS") || s.type.includes("Atom")) &&
      s.url.startsWith("http")
  );

  const results = await Promise.allSettled(
    rssFeeds.map((source) => fetchSingleFeed(source))
  );

  const allItems: FeedItem[] = [];
  let succeeded = 0;

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.length > 0) {
      succeeded++;
      allItems.push(...result.value);
    }
  }

  // Sort by published date, newest first
  allItems.sort(
    (a, b) => new Date(b.published).getTime() - new Date(a.published).getTime()
  );

  return {
    items: allItems,
    feedsAttempted: rssFeeds.length,
    feedsSucceeded: succeeded,
  };
}
