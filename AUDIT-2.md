# Codebase Audit: CLAUDE.md Compliance Review

**Date:** 2026-04-10
**Scope:** Follow-up review — verify AUDIT.md fixes, fresh scan of all `src/` files
**Status:** Immutable reference — do not modify this file

---

## Part 1: Original Audit Fix Verification

| # | Violation | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Swallowed errors in `signal-storage.ts` | **FIXED** | All 6 catch blocks now log via `console.error` with function name, error object, and fallback description |
| 2 | Massive component functions | **PARTIAL** | `DashboardTable` reduced from ~450 to 80 lines via hook extraction and sub-components. `SignalsTab` (374 lines), `DiscoveryTab` (319 lines), `IntelTab` (243 lines) — also cited in audit — remain untouched |
| 3 | Unvalidated RSS input | **FIXED** | `sanitizeUrl()` enforces http/https protocol; title capped at 500 chars; date bounds reject >48h future and pre-2000; summary cap raised to 1000 chars |
| 4 | Shared mutable module state | **FIXED** | `feedCache` now passed as parameter; `inFlightFetch` removed. Lower-severity `LOOKUP_MAP` in `entity-extractor.ts` noted but not addressed |
| 5 | No schema validation on API response | **FIXED** | `validateApiResponse()` in `useSources.ts` validates `items`, `feedsAttempted`, `feedsSucceeded`, `count`, `feedDiagnostics`, `fetchedAt` with typed defaults and console warnings |

### Violation 2 — Detail

The AUDIT.md fix targeted `DashboardTable` specifically. Six new files were created:

| File | Purpose | Lines |
|------|---------|-------|
| `src/hooks/useDashboardTable.ts` | State, memos, effects, handlers | 152 |
| `src/components/dashboard/EntityFilterBanner.tsx` | Filter notification bar | 45 |
| `src/components/dashboard/FeedTable.tsx` | Desktop sortable table | 95 |
| `src/components/dashboard/FeedCardList.tsx` | Mobile card layout | 64 |
| `src/components/dashboard/TabContent.tsx` | Lazy tab switcher | 67 |
| `src/components/dashboard/index.ts` | Barrel export | 4 |

`DashboardTable.tsx` is now 80 lines — a thin composition shell. The three tab components listed in AUDIT.md Violation #2 were not decomposed and carry forward as Violation V2-1 below.

---

## Part 2: Fresh Compliance Scan

### Top 4 Violations Ranked by Severity

| Rank | Violation | Instances | Rule |
|------|-----------|-----------|------|
| V2-1 | Functions exceeding 50-line limit | 7 | Max 50 lines per function |
| V2-2 | Silent catch blocks in URL helpers | 3 | Fail fast and loud |
| V2-3 | Fire-and-forget async without comment | 1 | Async discipline |
| V2-4 | Write-once mutable module state | 1 | No shared mutable state |

---

## V2-1: Functions Exceeding 50-Line Limit (7 instances)

**Rule violated:** *Max 50 lines per function. If longer, extract.*

| Function | File | Lines | Size | Over limit |
|----------|------|-------|------|------------|
| `SignalsTab` | `src/components/SignalsTab.tsx` | 138–512 | 374 | **7x** |
| `DiscoveryTab` | `src/components/DiscoveryTab.tsx` | 39–358 | 319 | **6x** |
| `IntelTab` | `src/components/IntelTab.tsx` | 84–327 | 243 | **5x** |
| `buildSituations` | `src/lib/situation-builder.ts` | 12–231 | 219 | **4x** |
| `extractEntities` | `src/lib/entity-extractor.ts` | 249–422 | 173 | **3x** |
| `doFetchSingleFeed` | `src/lib/feed-fetcher.ts` | 277–413 | 136 | **3x** |
| `useDashboardTable` | `src/hooks/useDashboardTable.ts` | 9–152 | ~100 | **2x** |

**Risk:** These functions mix multiple concerns — data transformation, state management, side effects, and rendering — making isolated testing and safe modification difficult.

**`doFetchSingleFeed` (136 lines) — representative example:**

Three sequential fetch phases (direct, relay, altUrl) with per-phase timeout setup, error classification, and retry logic in a single function body:

```typescript
async function doFetchSingleFeed(source: SourceMeta): Promise<SingleFeedResult> {
  // Phase 1: Direct fetch with retry — lines 283–326 (43 lines)
  // Phase 2: Relay fallback          — lines 328–365 (37 lines)
  // Phase 3: altUrl fallback         — lines 367–399 (32 lines)
  // Error return                     — lines 401–413 (12 lines)
}
```

Each phase could be an `attemptFetch(url, timeout, headers)` call.

**`buildSituations` (219 lines):**

Single exported function performing: item-entity mapping, pair discovery, greedy cluster merging, situation conversion, metadata computation, and sorting. Should decompose into `buildPairArticles()`, `mergeClusters()`, `convertToSituation()`.

**Three tab components (243–374 lines each):**

Carried forward from AUDIT.md Violation #2. Each mixes state management, data transformation, and hundreds of lines of JSX in one function body.

---

## V2-2: Silent Catch Blocks in URL Helpers (3 instances)

**Rule violated:** *Fail fast and loud. No empty catch blocks. No swallowed errors. No silent fallbacks masking broken state.*

| Function | File | Line | Silent return |
|----------|------|------|---------------|
| `sanitizeUrl` | `src/lib/feed-fetcher.ts` | 14 | `""` |
| `getDomainFromUrl` | `src/lib/image-extractor.ts` | 6 | `""` |
| `fallbackSourceImage` | `src/components/FeedItemImage.tsx` | 16 | `""` |

All three wrap `new URL()` in bare `catch {}` blocks, returning empty string on malformed URLs without logging.

**`sanitizeUrl` in feed-fetcher.ts (lines 10–17):**
```typescript
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : "";
  } catch {
    return "";
  }
}
```

**`getDomainFromUrl` in image-extractor.ts (lines 3–8):**
```typescript
export function getDomainFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}
```

**`fallbackSourceImage` in FeedItemImage.tsx (lines 12–18):**
```typescript
function fallbackSourceImage(link: string): string {
  try {
    const domain = new URL(link).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  } catch {
    return "";
  }
}
```

**Risk:** Low individually — these are pure URL-parsing helpers and malformed URLs are expected from untrusted RSS feeds. However, silent failures make debugging broken image/link fallbacks impossible. The `getDomainFromUrl` and `fallbackSourceImage` catches were previously noted as lower-severity items in AUDIT.md but not addressed. The `sanitizeUrl` catch was introduced by the Violation #3 fix.

---

## V2-3: Fire-and-Forget Async Without Comment (1 instance)

**Rule violated:** *Async discipline: no fire-and-forget promises. Every async operation must be awaited, caught, or explicitly detached with a comment stating why.*

**`useSources.ts` lines 102–104:**
```typescript
useEffect(() => {
  fetchFeed();
}, [fetchFeed]);
```

`fetchFeed` is an async function whose returned promise is discarded. React's `useEffect` cannot return a promise, so this pattern is correct — but the CLAUDE.md rule requires an explicit comment stating why the detachment is intentional. No such comment exists.

**Risk:** Low. This was noted as a lower-severity item in AUDIT.md but not addressed during the fixes. The pattern itself is standard React; the violation is the missing documentation.

---

## V2-4: Write-Once Mutable Module State (1 instance)

**Rule violated:** *No shared mutable state between modules. Data flows through arguments and return values.*

**`entity-extractor.ts` lines 17–36:**
```typescript
const LOOKUP_MAP = new Map<string, LookupEntry>();

function addToLookup(entries: DictEntry[]) {
  for (const entry of entries) {
    LOOKUP_MAP.set(entry.name.toLowerCase(), { name: entry.name, type: entry.type });
    for (const alias of entry.aliases) {
      LOOKUP_MAP.set(alias.toLowerCase(), { name: entry.name, type: entry.type });
    }
  }
}

addToLookup(COUNTRY_DICT);
addToLookup(ORG_DICT);
addToLookup(REGION_DICT);
```

`LOOKUP_MAP` is populated at module load time and never mutated afterward. Functions like `matchDictionary()` read from it without it being passed as a parameter.

**Risk:** Low. The Map is effectively frozen after initialization. It was noted in AUDIT.md Violation #4 as lower severity but not addressed. A `Object.freeze()` or conversion to a build-time constant would close this gap.

---

## Files Scanned — No Violations Found

| File | Lines | Notes |
|------|-------|-------|
| `src/app/page.tsx` | 9 | Clean |
| `src/app/layout.tsx` | 26 | Clean |
| `src/app/api/sources/route.ts` | 41 | `feedCache` Map at module scope is owned state, not shared — acceptable |
| `src/components/DashboardTable.tsx` | 80 | Clean (post-refactor) |
| `src/components/HeaderBar.tsx` | ~190 | Largest function ~40 lines — within limit |
| `src/components/NetworkTab.tsx` | ~120 | Clean |
| `src/components/MapTab.tsx` | ~140 | Clean |
| `src/components/dashboard/*.tsx` | 45–95 | All within limits |
| `src/hooks/useSources.ts` | 117 | V2-3 only |
| `src/lib/ad-filter.ts` | ~110 | Clean |
| `src/lib/xml-helpers.ts` | ~40 | Clean |
| `src/lib/urgency.ts` | ~50 | Clean |
| `src/lib/date-utils.ts` | ~30 | Clean |
| `src/lib/theme.ts` | ~40 | Clean |
| `src/lib/geo-coordinates.ts` | ~120 | Data file — clean |
| `src/lib/cascade-graph.ts` | ~100 | Clean |
| `src/lib/novelty-scorer.ts` | ~155 | Largest function ~50 lines — at limit edge |
| `src/lib/signal-storage.ts` | ~165 | Clean (post-fix) |
| `src/lib/entity-dictionaries.ts` | ~600 | Data file — clean |
