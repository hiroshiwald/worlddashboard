import { FeedItem, FeedDiagnostic, FeedErrorType, SourceMeta } from "./types";
import { stripHtml, extractTag, extractAttr } from "./xml-helpers";
import { isAdContent, isFinancialAd } from "./ad-filter";
import { extractImageUrl, getSourceImageUrl } from "./image-extractor";

// Max items to keep per individual feed
const MAX_ITEMS_PER_FEED = 15;

// --- RSS 2.0 parser ---
export function parseRssItems(xml: string, source: SourceMeta): FeedItem[] {
  const items: FeedItem[] = [];
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // Check if the feed has ANY pubDate at all (some feeds like CNN omit them entirely)
  const feedHasDates = /<pubDate>/i.test(xml) || /<dc:date>/i.test(xml);

  const rssItemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = rssItemRegex.exec(xml)) !== null) {
    if (items.length >= MAX_ITEMS_PER_FEED) break;

    const block = match[1];
    const title = stripHtml(extractTag(block, "title"));
    let link = extractTag(block, "link");
    if (!link) {
      const linkMatch = block.match(/<link[^>]*\/?\s*>\s*([^<\s]+)/i);
      if (linkMatch) link = linkMatch[1].trim();
    }
    const pubDate =
      extractTag(block, "pubDate") || extractTag(block, "dc:date");
    const description =
      extractTag(block, "description") ||
      extractTag(block, "content:encoded");

    const published = pubDate ? new Date(pubDate) : null;
    const hasValidDate = published && !isNaN(published.getTime());

    // If this feed generally has dates but THIS item doesn't, it's likely an injected ad
    if (feedHasDates && !hasValidDate) {
      continue;
    }

    // If item has a date, enforce the 7-day window
    if (hasValidDate && published!.getTime() < sevenDaysAgo) {
      continue;
    }

    // Standard ad filter
    if (isAdContent(title, stripHtml(description), link || "")) {
      continue;
    }

    // For dateless items (feeds where NO items have dates), apply strict financial ad filter
    if (!hasValidDate && isFinancialAd(title)) {
      continue;
    }

    const imageUrl =
      extractImageUrl(block) || getSourceImageUrl(link || "", source.url);

    if (title) {
      items.push({
        id: `${source.name}-${title.slice(0, 40)}-${pubDate || Math.random()}`,
        title,
        link: link || source.url,
        published: hasValidDate
          ? published!.toISOString()
          : new Date().toISOString(),
        summary: stripHtml(description).slice(0, 300),
        sourceName: source.name,
        sourceCategory: source.category,
        sourceTier: source.tier,
        imageUrl,
      });
    }
  }

  return items;
}

// --- Atom parser ---
export function parseAtomEntries(xml: string, source: SourceMeta): FeedItem[] {
  const items: FeedItem[] = [];
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const feedHasDates =
    /<updated>/i.test(xml) || /<published>/i.test(xml);

  const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    if (items.length >= MAX_ITEMS_PER_FEED) break;

    const block = match[1];
    const title = stripHtml(extractTag(block, "title"));
    let link = extractAttr(block, "link", "href");
    if (!link) link = extractTag(block, "link");
    const updated =
      extractTag(block, "updated") || extractTag(block, "published");
    const summary =
      extractTag(block, "summary") || extractTag(block, "content");

    const published = updated ? new Date(updated) : null;
    const hasValidDate = published && !isNaN(published.getTime());

    if (feedHasDates && !hasValidDate) {
      continue;
    }

    if (hasValidDate && published!.getTime() < sevenDaysAgo) {
      continue;
    }

    // Skip ads
    if (isAdContent(title, stripHtml(summary), link || "")) {
      continue;
    }

    if (!hasValidDate && isFinancialAd(title)) {
      continue;
    }

    const imageUrl =
      extractImageUrl(block) || getSourceImageUrl(link || "", source.url);

    if (title) {
      items.push({
        id: `${source.name}-${title.slice(0, 40)}-${updated || Math.random()}`,
        title,
        link: link || source.url,
        published: hasValidDate
          ? published!.toISOString()
          : new Date().toISOString(),
        summary: stripHtml(summary).slice(0, 300),
        sourceName: source.name,
        sourceCategory: source.category,
        sourceTier: source.tier,
        imageUrl,
      });
    }
  }

  return items;
}

export function parseFeedXml(xml: string, source: SourceMeta): FeedItem[] {
  if (xml.includes("<feed") && xml.includes("<entry")) {
    return parseAtomEntries(xml, source);
  }
  return parseRssItems(xml, source);
}

// ─── Fetch with relay fallback + caching ───

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/xml, text/xml, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

function getRelayUrl(): string {
  const raw = process.env.RELAY_URL || "";
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `https://${raw}`;
}
function getRelaySecret(): string {
  return process.env.RELAY_SECRET || "";
}

// ─── Error classification ───
function classifyError(
  error: unknown,
  response?: Response
): { errorType: FeedErrorType; message: string; httpStatus?: number } {
  if (response && !response.ok) {
    const status = response.status;
    return {
      errorType:
        status === 403 ? "http_403"
        : status === 404 ? "http_404"
        : status === 429 ? "http_429"
        : status >= 500 ? "http_5xx"
        : "http_other",
      message: `HTTP ${status}`,
      httpStatus: status,
    };
  }
  if (error instanceof Error) {
    if (error.name === "AbortError")
      return { errorType: "timeout", message: "Request timed out" };
    if (error.message.includes("ENOTFOUND") || error.message.includes("getaddrinfo"))
      return { errorType: "dns", message: `DNS lookup failed` };
    if (error.message.includes("ECONNREFUSED"))
      return { errorType: "connection_refused", message: error.message };
    return { errorType: "unknown", message: error.message };
  }
  return { errorType: "unknown", message: String(error) };
}

// ─── In-memory feed cache ───
interface CacheEntry {
  items: FeedItem[];
  diagnostic: FeedDiagnostic;
  timestamp: number;
}

const feedCache = new Map<string, CacheEntry>();
const CACHE_FRESH_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_STALE_MAX_MS = 30 * 60 * 1000; // 30 minutes

interface SingleFeedResult {
  items: FeedItem[];
  diagnostic: FeedDiagnostic;
}

// ─── Core fetch for a single feed ───
async function fetchSingleFeed(source: SourceMeta): Promise<SingleFeedResult> {
  // Check cache first
  const cached = feedCache.get(source.url);
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_FRESH_MS) {
    return {
      items: cached.items,
      diagnostic: { ...cached.diagnostic, fromCache: true, durationMs: 0 },
    };
  }

  const result = await doFetchSingleFeed(source);

  // On success, update cache
  if (result.items.length > 0) {
    feedCache.set(source.url, {
      items: result.items,
      diagnostic: result.diagnostic,
      timestamp: now,
    });
    return result;
  }

  // On failure, serve stale cache if available (up to 30 min)
  if (cached && now - cached.timestamp < CACHE_STALE_MAX_MS) {
    return {
      items: cached.items,
      diagnostic: { ...cached.diagnostic, fromCache: true, durationMs: result.diagnostic.durationMs },
    };
  }

  return result;
}

async function doFetchSingleFeed(source: SourceMeta): Promise<SingleFeedResult> {
  const start = Date.now();
  let lastError = "";
  let lastErrorType: FeedErrorType | undefined;
  let lastHttpStatus: number | undefined;

  // Phase 1: Direct fetch with single retry on transient failures — 5s timeout each.
  for (let attempt = 0; attempt < 2; attempt++) {
    const dc = new AbortController();
    const dt = setTimeout(() => dc.abort(), 5000);
    try {
      const res = await fetch(source.url, {
        signal: dc.signal,
        headers: FETCH_HEADERS,
        cache: 'no-store',
      });
      if (res.ok) {
        const text = await res.text();
        const items = parseFeedXml(text, source);
        if (items.length > 0) {
          return {
            items,
            diagnostic: { sourceName: source.name, sourceUrl: source.url, phase: "direct", durationMs: Date.now() - start },
          };
        }
        break; // Got response but no items — don't retry
      } else {
        const classified = classifyError(null, res);
        lastError = classified.message;
        lastErrorType = classified.errorType;
        lastHttpStatus = classified.httpStatus;
        if (attempt === 0 && classified.errorType === "http_5xx") {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        break;
      }
    } catch (e) {
      const classified = classifyError(e);
      lastError = classified.message;
      lastErrorType = classified.errorType;
      if (attempt === 0 && classified.errorType === "timeout") {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      break;
    } finally {
      clearTimeout(dt);
    }
  }

  // Phase 2: Relay fallback — 10s timeout.
  const relayUrl = getRelayUrl();
  if (relayUrl) {
    const relaySecret = getRelaySecret();
    const rc = new AbortController();
    const rt = setTimeout(() => rc.abort(), 10000);
    try {
      const headers: Record<string, string> = {};
      if (relaySecret) headers["x-relay-key"] = relaySecret;
      const res = await fetch(
        `${relayUrl}/rss?url=${encodeURIComponent(source.url)}`,
        { signal: rc.signal, headers, cache: 'no-store' }
      );
      if (res.ok) {
        const text = await res.text();
        if (text.includes("<rss") || text.includes("<feed") || text.includes("<channel")) {
          const items = parseFeedXml(text, source);
          if (items.length > 0) {
            return {
              items,
              diagnostic: { sourceName: source.name, sourceUrl: source.url, phase: "relay", durationMs: Date.now() - start },
            };
          }
        }
      } else {
        const classified = classifyError(null, res);
        lastError = classified.message;
        lastErrorType = classified.errorType;
        lastHttpStatus = classified.httpStatus;
      }
    } catch (e) {
      const classified = classifyError(e);
      lastError = classified.message;
      lastErrorType = classified.errorType;
    } finally {
      clearTimeout(rt);
    }
  }

  // Phase 3: altUrl fallback (RSSHub mirror) — 5s timeout.
  if (source.altUrl) {
    const ac = new AbortController();
    const at = setTimeout(() => ac.abort(), 5000);
    try {
      const res = await fetch(source.altUrl, {
        signal: ac.signal,
        headers: FETCH_HEADERS,
        cache: 'no-store',
      });
      if (res.ok) {
        const text = await res.text();
        const items = parseFeedXml(text, source);
        if (items.length > 0) {
          return {
            items,
            diagnostic: { sourceName: source.name, sourceUrl: source.url, phase: "altUrl", durationMs: Date.now() - start },
          };
        }
      } else {
        const classified = classifyError(null, res);
        lastError = classified.message;
        lastErrorType = classified.errorType;
        lastHttpStatus = classified.httpStatus;
      }
    } catch (e) {
      const classified = classifyError(e);
      lastError = classified.message;
      lastErrorType = classified.errorType;
    } finally {
      clearTimeout(at);
    }
  }

  return {
    items: [],
    diagnostic: {
      sourceName: source.name,
      sourceUrl: source.url,
      phase: "failed",
      durationMs: Date.now() - start,
      error: lastError || "All phases returned no items",
      errorType: lastErrorType,
      httpStatus: lastHttpStatus,
    },
  };
}

// ─── Request deduplication ───
interface FetchAllResult {
  items: FeedItem[];
  feedsAttempted: number;
  feedsSucceeded: number;
  relayConfigured: boolean;
  feedDiagnostics: FeedDiagnostic[];
}

let inFlightFetch: Promise<FetchAllResult> | null = null;

export function fetchAllFeeds(sources: SourceMeta[]): Promise<FetchAllResult> {
  if (inFlightFetch) return inFlightFetch;

  inFlightFetch = doFetchAllFeeds(sources).finally(() => {
    inFlightFetch = null;
  });

  return inFlightFetch;
}

async function doFetchAllFeeds(sources: SourceMeta[]): Promise<FetchAllResult> {
  const rssFeeds = sources.filter(
    (s) =>
      (s.type.includes("RSS") || s.type.includes("Atom")) &&
      s.url.startsWith("http")
  );

  const results = await Promise.allSettled(
    rssFeeds.map((source) => fetchSingleFeed(source))
  );

  const allItems: FeedItem[] = [];
  const diagnostics: FeedDiagnostic[] = [];
  let succeeded = 0;

  for (const result of results) {
    if (result.status === "fulfilled") {
      diagnostics.push(result.value.diagnostic);
      if (result.value.items.length > 0) {
        succeeded++;
        allItems.push(...result.value.items);
      }
    }
  }

  // Sort newest first
  allItems.sort(
    (a, b) =>
      new Date(b.published).getTime() - new Date(a.published).getTime()
  );

  return {
    items: allItems,
    feedsAttempted: rssFeeds.length,
    feedsSucceeded: succeeded,
    relayConfigured: !!getRelayUrl(),
    feedDiagnostics: diagnostics,
  };
}
