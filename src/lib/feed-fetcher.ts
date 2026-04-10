import { FeedItem, FeedDiagnostic, FeedErrorType, SourceMeta } from "./types";
import { stripHtml, extractTag, extractAttr } from "./xml-helpers";
import { isAdContent, isFinancialAd } from "./ad-filter";
import { extractImageUrl, getSourceImageUrl } from "./image-extractor";

// --- Input validation helpers ---
const MIN_DATE_MS = new Date("2000-01-01T00:00:00Z").getTime();
const FUTURE_TOLERANCE_MS = 48 * 60 * 60 * 1000;

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : "";
  } catch {
    return "";
  }
}

function isDateInBounds(date: Date): boolean {
  const t = date.getTime();
  return t >= MIN_DATE_MS && t <= Date.now() + FUTURE_TOLERANCE_MS;
}

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
    const title = stripHtml(extractTag(block, "title")).slice(0, 500);
    let link = extractTag(block, "link");
    if (!link) {
      const linkMatch = block.match(/<link[^>]*\/?\s*>\s*([^<\s]+)/i);
      if (linkMatch) link = linkMatch[1].trim();
    }
    link = sanitizeUrl(link);
    const pubDate =
      extractTag(block, "pubDate") || extractTag(block, "dc:date");
    const description =
      extractTag(block, "description") ||
      extractTag(block, "content:encoded");

    const published = pubDate ? new Date(pubDate) : null;
    const hasValidDate = published && !isNaN(published.getTime());
    const isDateBounded = hasValidDate && isDateInBounds(published!);

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
      sanitizeUrl(extractImageUrl(block)) || getSourceImageUrl(link || "", source.url);

    if (title) {
      items.push({
        id: `${source.name}-${title.slice(0, 40)}-${pubDate || Math.random()}`,
        title,
        link: link || source.url,
        published: isDateBounded
          ? published!.toISOString()
          : new Date().toISOString(),
        summary: stripHtml(description).slice(0, 1000),
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
    const title = stripHtml(extractTag(block, "title")).slice(0, 500);
    let link = extractAttr(block, "link", "href");
    if (!link) link = extractTag(block, "link");
    link = sanitizeUrl(link);
    const updated =
      extractTag(block, "updated") || extractTag(block, "published");
    const summary =
      extractTag(block, "summary") || extractTag(block, "content");

    const published = updated ? new Date(updated) : null;
    const hasValidDate = published && !isNaN(published.getTime());
    const isDateBounded = hasValidDate && isDateInBounds(published!);

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
      sanitizeUrl(extractImageUrl(block)) || getSourceImageUrl(link || "", source.url);

    if (title) {
      items.push({
        id: `${source.name}-${title.slice(0, 40)}-${updated || Math.random()}`,
        title,
        link: link || source.url,
        published: isDateBounded
          ? published!.toISOString()
          : new Date().toISOString(),
        summary: stripHtml(summary).slice(0, 1000),
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
export interface CacheEntry {
  items: FeedItem[];
  diagnostic: FeedDiagnostic;
  timestamp: number;
}

const CACHE_FRESH_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_STALE_MAX_MS = 30 * 60 * 1000; // 30 minutes

interface SingleFeedResult {
  items: FeedItem[];
  diagnostic: FeedDiagnostic;
}

// ─── Core fetch for a single feed ───
async function fetchSingleFeed(
  source: SourceMeta,
  cache: Map<string, CacheEntry>,
): Promise<SingleFeedResult> {
  // Check cache first
  const cached = cache.get(source.url);
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
    cache.set(source.url, {
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

// ─── Phase outcome type for fetch decomposition ───
type PhaseOutcome =
  | { ok: true; items: FeedItem[] }
  | { ok: false; error?: string; errorType?: FeedErrorType; httpStatus?: number };

// Phase 1: Direct fetch with single retry on 5xx/timeout — 5s timeout each.
async function fetchDirect(source: SourceMeta): Promise<PhaseOutcome> {
  let error: string | undefined;
  let errorType: FeedErrorType | undefined;
  let httpStatus: number | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    try {
      const res = await fetch(source.url, {
        signal: ac.signal, headers: FETCH_HEADERS, cache: 'no-store',
      });
      if (res.ok) {
        const text = await res.text();
        const items = parseFeedXml(text, source);
        if (items.length > 0) return { ok: true, items };
        break; // 200 OK but no items — don't retry
      }
      const classified = classifyError(null, res);
      error = classified.message;
      errorType = classified.errorType;
      httpStatus = classified.httpStatus;
      if (attempt === 0 && classified.errorType === "http_5xx") {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      break;
    } catch (e) {
      const classified = classifyError(e);
      error = classified.message;
      errorType = classified.errorType;
      if (attempt === 0 && classified.errorType === "timeout") {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error, errorType, httpStatus };
}

// Phase 2: Relay proxy fallback — 10s timeout.
async function fetchViaRelay(
  source: SourceMeta,
  relayUrl: string,
): Promise<PhaseOutcome> {
  const relaySecret = getRelaySecret();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  try {
    const headers: Record<string, string> = {};
    if (relaySecret) headers["x-relay-key"] = relaySecret;
    const res = await fetch(
      `${relayUrl}/rss?url=${encodeURIComponent(source.url)}`,
      { signal: ac.signal, headers, cache: 'no-store' },
    );
    if (res.ok) {
      const text = await res.text();
      if (text.includes("<rss") || text.includes("<feed") || text.includes("<channel")) {
        const items = parseFeedXml(text, source);
        if (items.length > 0) return { ok: true, items };
      }
      return { ok: false };
    }
    const classified = classifyError(null, res);
    return { ok: false, error: classified.message, errorType: classified.errorType, httpStatus: classified.httpStatus };
  } catch (e) {
    const classified = classifyError(e);
    return { ok: false, error: classified.message, errorType: classified.errorType };
  } finally {
    clearTimeout(timer);
  }
}

// Phase 3: altUrl fallback (RSSHub mirror) — 5s timeout.
async function fetchFromAltUrl(source: SourceMeta): Promise<PhaseOutcome> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(source.altUrl!, {
      signal: ac.signal, headers: FETCH_HEADERS, cache: 'no-store',
    });
    if (res.ok) {
      const text = await res.text();
      const items = parseFeedXml(text, source);
      if (items.length > 0) return { ok: true, items };
      return { ok: false };
    }
    const classified = classifyError(null, res);
    return { ok: false, error: classified.message, errorType: classified.errorType, httpStatus: classified.httpStatus };
  } catch (e) {
    const classified = classifyError(e);
    return { ok: false, error: classified.message, errorType: classified.errorType };
  } finally {
    clearTimeout(timer);
  }
}

// Orchestrator: tries direct → relay → altUrl, returns first success.
async function doFetchSingleFeed(source: SourceMeta): Promise<SingleFeedResult> {
  const start = Date.now();
  let lastError = "";
  let lastErrorType: FeedErrorType | undefined;
  let lastHttpStatus: number | undefined;

  const makeDiag = (phase: FeedDiagnostic["phase"]): FeedDiagnostic => ({
    sourceName: source.name, sourceUrl: source.url, phase, durationMs: Date.now() - start,
  });

  const accumulate = (o: PhaseOutcome & { ok: false }) => {
    if (o.error) { lastError = o.error; lastErrorType = o.errorType; }
    if (o.httpStatus !== undefined) lastHttpStatus = o.httpStatus;
  };

  const direct = await fetchDirect(source);
  if (direct.ok) return { items: direct.items, diagnostic: makeDiag("direct") };
  accumulate(direct);

  const relayUrl = getRelayUrl();
  if (relayUrl) {
    const relay = await fetchViaRelay(source, relayUrl);
    if (relay.ok) return { items: relay.items, diagnostic: makeDiag("relay") };
    accumulate(relay);
  }

  if (source.altUrl) {
    const alt = await fetchFromAltUrl(source);
    if (alt.ok) return { items: alt.items, diagnostic: makeDiag("altUrl") };
    accumulate(alt);
  }

  return {
    items: [],
    diagnostic: {
      ...makeDiag("failed"),
      error: lastError || "All phases returned no items",
      errorType: lastErrorType,
      httpStatus: lastHttpStatus,
    },
  };
}

interface FetchAllResult {
  items: FeedItem[];
  feedsAttempted: number;
  feedsSucceeded: number;
  relayConfigured: boolean;
  feedDiagnostics: FeedDiagnostic[];
}

export async function fetchAllFeeds(
  sources: SourceMeta[],
  cache: Map<string, CacheEntry>,
): Promise<FetchAllResult> {
  const rssFeeds = sources.filter(
    (s) =>
      (s.type.includes("RSS") || s.type.includes("Atom")) &&
      s.url.startsWith("http")
  );

  const results = await Promise.allSettled(
    rssFeeds.map((source) => fetchSingleFeed(source, cache))
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
