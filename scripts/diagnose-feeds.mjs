#!/usr/bin/env node
/**
 * Feed Diagnostic Script
 * Tests each RSS/Atom feed independently and reports why feeds fail.
 *
 * Usage: node scripts/diagnose-feeds.mjs
 */

import { readFileSync, writeFileSync } from "fs";

const TIMEOUT_MS = 10000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

// --- Ad filter patterns (must match feed-fetcher.ts exactly) ---
const AD_TITLE_PATTERNS = [
  /^ad:/i, /^sponsored/i, /^promoted/i, /^advertisement/i, /^underscored/i,
  /cnn underscored/i, /best .{0,30} deals/i, /best .{0,30} to buy/i,
  /best .{0,30} for 20\d\d/i, /best .{0,30} we'?ve tested/i,
  /our favorite .{0,40} of 20\d\d/i, /top \d+ .{0,30} (deals|products|gifts)/i,
  /shop .{0,30} sale/i, /\d+% off .{0,30}/i, /coupon code/i, /promo code/i,
  /gift guide/i, /deals of the day/i, /sale alert/i, /save \$?\d+/i,
  /discount code/i, /black friday/i, /cyber monday/i, /prime day/i,
  /where to buy/i, /buying guide/i, /price drop/i,
  /cash ?back card/i, /home equity (loan|line|into cash)/i, /home equity$/i,
  /into cash you can use/i, /cash out of your home/i, /credit card interest/i,
  /avoid .{0,20}credit card/i, /intro apr/i, /\d+% apr/i,
  /0% .{0,15}(apr|interest|intro)/i, /balance transfer/i,
  /best .{0,20} card of/i, /best .{0,20} credit card/i,
  /best .{0,20} rewards card/i, /best .{0,20} travel card/i,
  /best .{0,20} savings (account|rate)/i, /high.yield savings/i,
  /refinanc(e|ing) (your|a|the)/i, /mortgage rate/i,
  /insurance (rate|quote|plan)/i, /personal loan/i,
  /debt (consolidat|relief|pay)/i, /student loan (refin|forgiv|rate)/i,
  /experts:.{0,30}(card|loan|rate|account|insur)/i,
  /it'?s official:.{0,30}(card|credit|interest|rate|apr)/i,
  /dream big with/i, /rising .{0,15}equity/i,
  /turn your .{0,30}(equity|home)/i, /want cash .{0,20}(out|from) .{0,15}home/i,
  /\b(visa|mastercard|amex|discover)\b.{0,20}(card|offer|reward)/i,
  /subscribe (now|today|to)/i, /sign up for .{0,20} newsletter/i,
  /download our app/i, /^horoscope/i, /^daily horoscope/i,
  /^your .{0,15} horoscope/i, /^crossword/i, /^wordle/i, /^today.s puzzle/i,
];

const AD_LINK_PATTERNS = [
  "/cnn-underscored", "/deals/", "/shopping/", "/ad/", "/sponsored/",
  "/partner-content/", "/brandcontent/", "/paid-partner/", "/commerce/",
  "/coupons/", "/product-reviews/", "affiliate", "/buy/", "/shop/",
];

const FINANCIAL_AD_PATTERNS = [
  /credit card/i, /cash ?back/i, /home equity/i, /\bapr\b/i, /\bloan\b/i,
  /\bmortgage\b/i, /\brefinanc/i, /\binsurance\b.{0,15}(rate|quote|plan|cost)/i,
  /\bsavings (account|rate)/i, /\binterest rate/i,
  /\bdebt (consolidat|relief|pay)/i, /your (home|money|credit|debt|rate|savings|equity)/i,
  /experts:.{0,5}(this|the|best)/i, /it'?s official/i, /dream big/i,
  /cash (out|you can)/i, /turn your/i, /\b(visa|mastercard|amex)\b/i,
  /\bintro (rate|apr|offer)/i, /\b0%.{0,10}(apr|interest|intro)/i,
  /best .{0,20}(card|rate|account)/i, /avoid .{0,15}(interest|fee|charge)/i,
  /high.yield/i, /\bCD rate/i, /balance transfer/i,
  /personal (loan|finance)/i, /student loan/i,
];

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&#x27;/g, "'").replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ").trim();
}

function extractTag(xml, tag) {
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i");
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(re);
  return match ? match[1].trim() : "";
}

function extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
  const match = xml.match(re);
  return match ? match[1].trim() : "";
}

function isAdContent(title, summary, link) {
  const linkLower = link.toLowerCase();
  for (const p of AD_LINK_PATTERNS) { if (linkLower.includes(p)) return true; }
  for (const p of AD_TITLE_PATTERNS) { if (p.test(title)) return true; }
  const text = `${title} ${summary}`.toLowerCase();
  if (/paid (content|partner|post|promotion)/i.test(text)) return true;
  if (/\baffiliate\b/i.test(text) && /\b(link|commission|earn)\b/i.test(text)) return true;
  return false;
}

function isFinancialAd(title) {
  for (const p of FINANCIAL_AD_PATTERNS) { if (p.test(title)) return true; }
  return false;
}

function parseItems(xml, isAtom) {
  const items = [];
  const sevenDaysAgo = Date.now() - SEVEN_DAYS;
  const feedHasDates = isAtom
    ? (/<updated>/i.test(xml) || /<published>/i.test(xml))
    : (/<pubDate>/i.test(xml) || /<dc:date>/i.test(xml));

  const regex = isAtom ? /<entry[\s>]([\s\S]*?)<\/entry>/gi : /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;
  let rawCount = 0;
  let datelessDropped = 0;
  let dateExpired = 0;
  let adFiltered = 0;
  let financialAdFiltered = 0;

  while ((match = regex.exec(xml)) !== null) {
    if (items.length >= 15) break;
    rawCount++;
    const block = match[1];
    const title = stripHtml(extractTag(block, "title"));

    let pubDate;
    if (isAtom) {
      pubDate = extractTag(block, "updated") || extractTag(block, "published");
    } else {
      pubDate = extractTag(block, "pubDate") || extractTag(block, "dc:date");
    }

    const published = pubDate ? new Date(pubDate) : null;
    const hasValidDate = published && !isNaN(published.getTime());

    if (feedHasDates && !hasValidDate) { datelessDropped++; continue; }
    if (hasValidDate && published.getTime() < sevenDaysAgo) { dateExpired++; continue; }

    const description = isAtom
      ? (extractTag(block, "summary") || extractTag(block, "content"))
      : (extractTag(block, "description") || extractTag(block, "content:encoded"));
    let link = isAtom ? extractAttr(block, "link", "href") : extractTag(block, "link");

    if (isAdContent(title, stripHtml(description), link || "")) { adFiltered++; continue; }
    if (!hasValidDate && isFinancialAd(title)) { financialAdFiltered++; continue; }

    if (title) items.push({ title, link });
  }

  return { items, rawCount, datelessDropped, dateExpired, adFiltered, financialAdFiltered };
}

async function testFeed(source) {
  const start = Date.now();
  const result = {
    name: source.name,
    category: source.category,
    type: source.type,
    url: source.url,
    status: "error",
    httpStatus: null,
    responseBytes: null,
    rawItems: null,
    afterFilter: null,
    datelessDropped: null,
    dateExpired: null,
    adFiltered: null,
    financialAdFiltered: null,
    durationMs: null,
    error: null,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "WorldDashboard-Diagnostic/1.0",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });

    clearTimeout(timeout);
    result.durationMs = Date.now() - start;
    result.httpStatus = res.status;

    if (!res.ok) {
      result.status = "http_error";
      result.error = `HTTP ${res.status}`;
      return result;
    }

    const text = await res.text();
    result.responseBytes = text.length;

    const isAtom = text.includes("<feed") && text.includes("<entry");
    const isRss = text.includes("<item");

    if (!isAtom && !isRss) {
      result.status = "parse_error";
      result.error = "No <item> or <entry> tags found (not RSS/Atom XML)";
      return result;
    }

    const parsed = parseItems(text, isAtom);
    result.rawItems = parsed.rawCount;
    result.afterFilter = parsed.items.length;
    result.datelessDropped = parsed.datelessDropped;
    result.dateExpired = parsed.dateExpired;
    result.adFiltered = parsed.adFiltered;
    result.financialAdFiltered = parsed.financialAdFiltered;

    if (parsed.rawCount === 0) {
      result.status = "parse_error";
      result.error = "Tags found but 0 items parsed";
    } else if (parsed.items.length === 0) {
      result.status = "empty_after_filter";
      const reasons = [];
      if (parsed.datelessDropped > 0) reasons.push(`${parsed.datelessDropped} dateless`);
      if (parsed.dateExpired > 0) reasons.push(`${parsed.dateExpired} expired`);
      if (parsed.adFiltered > 0) reasons.push(`${parsed.adFiltered} ad-filtered`);
      if (parsed.financialAdFiltered > 0) reasons.push(`${parsed.financialAdFiltered} financial-ad`);
      result.error = `All ${parsed.rawCount} items removed: ${reasons.join(", ")}`;
    } else {
      result.status = "success";
    }

    return result;
  } catch (err) {
    result.durationMs = Date.now() - start;
    if (err?.name === "AbortError") {
      result.status = "timeout";
      result.error = `Exceeded ${TIMEOUT_MS}ms`;
    } else {
      result.status = "error";
      result.error = err?.message || String(err);
    }
    return result;
  }
}

async function main() {
  const sources = JSON.parse(readFileSync("src/lib/sources-data.json", "utf-8"));
  const rssFeeds = sources.filter(
    (s) => (s.type.includes("RSS") || s.type.includes("Atom")) && s.url.startsWith("http")
  );

  console.log(`\nTesting ${rssFeeds.length} RSS/Atom feeds sequentially...\n`);
  console.log("─".repeat(100));

  const results = [];
  const summary = { success: 0, timeout: 0, http_error: 0, parse_error: 0, empty_after_filter: 0, error: 0 };

  for (let i = 0; i < rssFeeds.length; i++) {
    const feed = rssFeeds[i];
    const result = await testFeed(feed);
    results.push(result);
    summary[result.status]++;

    const icon = result.status === "success" ? "OK" : "FAIL";
    const items = result.afterFilter !== null ? `${result.afterFilter}/${result.rawItems} items` : "";
    const dur = result.durationMs ? `${result.durationMs}ms` : "";
    const err = result.error ? ` | ${result.error}` : "";
    console.log(
      `[${String(i + 1).padStart(2)}] ${icon.padEnd(4)} ${result.name.padEnd(40)} ${items.padEnd(14)} ${dur.padEnd(8)}${err}`
    );
  }

  console.log("\n" + "─".repeat(100));
  console.log("\nSUMMARY");
  console.log(`  Success:            ${summary.success}/${rssFeeds.length}`);
  console.log(`  Timeout:            ${summary.timeout}`);
  console.log(`  HTTP Error:         ${summary.http_error}`);
  console.log(`  Parse Error:        ${summary.parse_error}`);
  console.log(`  Empty After Filter: ${summary.empty_after_filter}`);
  console.log(`  Other Error:        ${summary.error}`);

  // Show failed feeds grouped by reason
  const failed = results.filter((r) => r.status !== "success");
  if (failed.length > 0) {
    console.log("\nFAILED FEEDS BY CATEGORY:");
    for (const status of ["timeout", "http_error", "parse_error", "empty_after_filter", "error"]) {
      const group = failed.filter((r) => r.status === status);
      if (group.length > 0) {
        console.log(`\n  ${status.toUpperCase()} (${group.length}):`);
        group.forEach((r) => console.log(`    - ${r.name}: ${r.error}`));
      }
    }
  }

  // Save JSON report
  writeFileSync("feed-diagnostic-report.json", JSON.stringify(results, null, 2));
  console.log("\nFull report saved to: feed-diagnostic-report.json\n");
}

main().catch(console.error);
