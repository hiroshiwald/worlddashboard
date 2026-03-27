import { FeedItem, FeedDiagnostic, FeedErrorType, SourceMeta } from "./types";

// --- Ad / spam filter ---
const AD_TITLE_PATTERNS = [
  /^ad:/i,
  /^sponsored/i,
  /^promoted/i,
  /^advertisement/i,
  /^underscored/i,
  /cnn underscored/i,
  // Commerce / affiliate content
  /best .{0,30} deals/i,
  /best .{0,30} to buy/i,
  /best .{0,30} for 20\d\d/i,
  /best .{0,30} we'?ve tested/i,
  /our favorite .{0,40} of 20\d\d/i,
  /top \d+ .{0,30} (deals|products|gifts)/i,
  /shop .{0,30} sale/i,
  /\d+% off .{0,30}/i,
  /coupon code/i,
  /promo code/i,
  /gift guide/i,
  /deals of the day/i,
  /sale alert/i,
  /save \$?\d+/i,
  /discount code/i,
  /black friday/i,
  /cyber monday/i,
  /prime day/i,
  /where to buy/i,
  /buying guide/i,
  /price drop/i,
  // CNN financial product ads injected into RSS
  /cash ?back card/i,
  /home equity (loan|line|into cash)/i,
  /home equity$/i,
  /into cash you can use/i,
  /cash out of your home/i,
  /credit card interest/i,
  /avoid .{0,20}credit card/i,
  /intro apr/i,
  /\d+% apr/i,
  /0% .{0,15}(apr|interest|intro)/i,
  /balance transfer/i,
  /best .{0,20} card of/i,
  /best .{0,20} credit card/i,
  /best .{0,20} rewards card/i,
  /best .{0,20} travel card/i,
  /best .{0,20} savings (account|rate)/i,
  /high.yield savings/i,
  /refinanc(e|ing) (your|a|the)/i,
  /mortgage rate/i,
  /insurance (rate|quote|plan)/i,
  /personal loan/i,
  /debt (consolidat|relief|pay)/i,
  /student loan (refin|forgiv|rate)/i,
  /experts:.{0,30}(card|loan|rate|account|insur)/i,
  /it'?s official:.{0,30}(card|credit|interest|rate|apr)/i,
  /dream big with/i,
  /rising .{0,15}equity/i,
  /turn your .{0,30}(equity|home)/i,
  /want cash .{0,20}(out|from) .{0,15}home/i,
  /\b(visa|mastercard|amex|discover)\b.{0,20}(card|offer|reward)/i,
  // Newsletter / subscription nags
  /subscribe (now|today|to)/i,
  /sign up for .{0,20} newsletter/i,
  /download our app/i,
  // Horoscopes, lifestyle filler
  /^horoscope/i,
  /^daily horoscope/i,
  /^your .{0,15} horoscope/i,
  /^crossword/i,
  /^wordle/i,
  /^today.s puzzle/i,
];

const AD_LINK_PATTERNS = [
  "/cnn-underscored",
  "/deals/",
  "/shopping/",
  "/ad/",
  "/sponsored/",
  "/partner-content/",
  "/brandcontent/",
  "/paid-partner/",
  "/commerce/",
  "/coupons/",
  "/product-reviews/",
  "affiliate",
  "/buy/",
  "/shop/",
];

function isAdContent(title: string, summary: string, link: string): boolean {
  // Check link patterns
  const linkLower = link.toLowerCase();
  for (const pattern of AD_LINK_PATTERNS) {
    if (linkLower.includes(pattern)) return true;
  }

  // Check title patterns
  for (const pattern of AD_TITLE_PATTERNS) {
    if (pattern.test(title)) return true;
  }

  // Check combined text for paid content markers
  const text = `${title} ${summary}`.toLowerCase();
  if (/paid (content|partner|post|promotion)/i.test(text)) return true;
  if (/\baffiliate\b/i.test(text) && /\b(link|commission|earn)\b/i.test(text)) return true;

  return false;
}

// --- HTML / XML helpers ---
function stripHtml(html: string): string {
  let text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x[0-9a-fA-F]+;/g, "")
    .replace(/&#\d+;/g, "");
  // Second pass: strip any tags that were entity-encoded in the original
  text = text.replace(/<[^>]*>/g, "");
  return text.replace(/\s+/g, " ").trim();
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

// --- Image extraction ---
function extractImageUrl(block: string): string {
  // 1. <media:content url="...">
  const mediaContent = block.match(
    /<media:content[^>]+url="([^"]+\.(jpg|jpeg|png|webp|gif)[^"]*)"/i
  );
  if (mediaContent) return mediaContent[1];

  // 2. <media:thumbnail url="...">
  const mediaThumbnail = block.match(
    /<media:thumbnail[^>]+url="([^"]+)"/i
  );
  if (mediaThumbnail) return mediaThumbnail[1];

  // 3. <enclosure url="..." type="image/...">
  const enclosure = block.match(
    /<enclosure[^>]+url="([^"]+)"[^>]+type="image\/[^"]+"/i
  );
  if (enclosure) return enclosure[1];
  // Also try reversed attribute order
  const enclosure2 = block.match(
    /<enclosure[^>]+type="image\/[^"]+"[^>]+url="([^"]+)"/i
  );
  if (enclosure2) return enclosure2[1];

  // 4. <image><url>...</url></image>
  const imageTag = extractTag(block, "image");
  if (imageTag) {
    const imgUrl = extractTag(imageTag, "url");
    if (imgUrl && imgUrl.startsWith("http")) return imgUrl;
  }

  // 5. First <img src="..."> inside description/content
  const description =
    extractTag(block, "description") ||
    extractTag(block, "content:encoded") ||
    extractTag(block, "content") ||
    extractTag(block, "summary");
  const imgMatch = description.match(/<img[^>]+src="([^"]+)"/i);
  if (imgMatch && imgMatch[1].startsWith("http")) return imgMatch[1];

  return "";
}

// Max items to keep per individual feed
const MAX_ITEMS_PER_FEED = 15;

// Extra-strict filter for items without a publication date.
// Dateless items are suspicious — real news almost always has dates.
// Only allow them through if the title looks like genuine hard news.
const FINANCIAL_AD_PATTERNS = [
  /credit card/i,
  /cash ?back/i,
  /home equity/i,
  /\bapr\b/i,
  /\bloan\b/i,
  /\bmortgage\b/i,
  /\brefinanc/i,
  /\binsurance\b.{0,15}(rate|quote|plan|cost)/i,
  /\bsavings (account|rate)/i,
  /\binterest rate/i,
  /\bdebt (consolidat|relief|pay)/i,
  /your (home|money|credit|debt|rate|savings|equity)/i,
  /experts:.{0,5}(this|the|best)/i,
  /it'?s official/i,
  /dream big/i,
  /cash (out|you can)/i,
  /turn your/i,
  /\b(visa|mastercard|amex)\b/i,
  /\bintro (rate|apr|offer)/i,
  /\b0%.{0,10}(apr|interest|intro)/i,
  /best .{0,20}(card|rate|account)/i,
  /avoid .{0,15}(interest|fee|charge)/i,
  /high.yield/i,
  /\bCD rate/i,
  /balance transfer/i,
  /personal (loan|finance)/i,
  /student loan/i,
];

function isFinancialAd(title: string): boolean {
  for (const pattern of FINANCIAL_AD_PATTERNS) {
    if (pattern.test(title)) return true;
  }
  return false;
}

// --- RSS 2.0 parser ---
function parseRssItems(xml: string, source: SourceMeta): FeedItem[] {
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

    const imageUrl = extractImageUrl(block);

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
function parseAtomEntries(xml: string, source: SourceMeta): FeedItem[] {
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

    const imageUrl = extractImageUrl(block);

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

function parseFeedXml(xml: string, source: SourceMeta): FeedItem[] {
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
        { signal: rc.signal, headers }
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
