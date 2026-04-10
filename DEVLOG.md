# World Dashboard Development Log

## 2026-04-10 — Decompose DiscoveryTab.tsx (Audit Violation #2)
- Extracted all state, memos, and callbacks into `src/hooks/useDiscoveryTab.ts`
- Moved helper function (`getDotColor`) and shared constant (`TYPE_DOT_COLORS`) to `src/components/discovery/utils.ts`
- Created 3 sub-components in `src/components/discovery/`: `DiscoveryControls`, `ScatterPlot`, `DiscoveryLegend`
- Barrel export at `src/components/discovery/index.ts`
- `DiscoveryTab.tsx`: 359 → 53 lines (main component is a thin composition shell)
- Same pattern as DashboardTable and SignalsTab decompositions (hook + sub-components + barrel)
- No behavioral or visual changes. All 124 tests pass.

## 2026-04-10 — Decompose SignalsTab.tsx (Audit Violation #2)
- Extracted all state, refs, effects, memos, and callbacks into `src/hooks/useSignalsTab.ts`
- Moved helper functions (`SignalIcon`, `severityColor`, `timeAgo`, `SentimentBadge`) to `src/components/signals/utils.tsx`
- Created 5 sub-components in `src/components/signals/`: `SignalsSummaryStrip`, `SignalCard`, `SignalCardGrid`, `WatchlistCard`, `WatchlistSection`
- Barrel export at `src/components/signals/index.ts`
- `SignalsTab.tsx`: 512 → 57 lines (main component is a thin composition shell)
- Same pattern as DashboardTable decomposition (hook + sub-components + barrel)
- No behavioral or visual changes. All 124 tests pass; TypeScript compiles clean.

## 2026-04-10 — Fix: Validate API Response in useSources.ts (Audit Violation #5)
- Added `validateApiResponse` function to `src/hooks/useSources.ts` that validates the shape of the `/api/sources` JSON response at the module boundary
- `data.items`: validated as array, defaults to `[]` with console warning
- `data.feedsAttempted`, `data.feedsSucceeded`, `data.count`: validated as numbers, default to `0` with console warning
- `data.feedDiagnostics`: validated as array if present, defaults to `[]` with console warning
- `data.fetchedAt`: validated as string, defaults to `null`
- Malformed API responses now produce a degraded but functional dashboard (empty table, zeroed counters) instead of a crash
- Addresses AUDIT.md Violation #5: "No schema validation on API response"
- All 124 existing tests pass; TypeScript compiles clean

## 2026-04-10 — Fix: Eliminate Shared Mutable State in feed-fetcher.ts (Audit Violation #4)
- Removed two module-level mutable variables from `src/lib/feed-fetcher.ts`:
  - `feedCache` (Map): now passed as a `cache` parameter through `fetchAllFeeds` → `fetchSingleFeed`
  - `inFlightFetch` (Promise dedup): removed entirely — had a bug where caller B silently received caller A's results for a different source list. CDN layer already coalesces concurrent requests.
- `CacheEntry` interface exported so callers can type the cache they own
- **Caller updated:** `src/app/api/sources/route.ts` creates and owns the `feedCache` Map at module scope, passes it to `fetchAllFeeds`
- No return type changes. Caching behavior (5-min fresh, 30-min stale fallback) unchanged.
- All 124 existing tests pass; TypeScript compiles clean

## 2026-04-10 — Refactor: Decompose DashboardTable.tsx (Audit Violation #2)
- Decomposed `src/components/DashboardTable.tsx` from ~450 lines (9x over 50-line limit) to 79 lines
- Addresses AUDIT.md Violation #2: "Massive Component Functions"
- **New files created:**
  - `src/hooks/useDashboardTable.ts` — custom hook with all state, memos, effects, and handlers
  - `src/components/dashboard/EntityFilterBanner.tsx` — entity filter notification bar
  - `src/components/dashboard/FeedTable.tsx` — desktop sortable table with header and row sub-components
  - `src/components/dashboard/FeedCardList.tsx` — mobile card layout
  - `src/components/dashboard/TabContent.tsx` — lazy-loaded tab switcher (absorbs dynamic imports)
  - `src/components/dashboard/index.ts` — barrel export
- **DashboardTable.tsx** is now a thin composition shell: imports hook + sub-components, composes JSX
- No behavioral or visual changes — purely structural refactor
- All 124 existing tests pass; build succeeds

## 2026-04-10 — Fix: Swallowed Errors in signal-storage.ts (Audit Violation #1)
- Added `console.error` logging to all 6 empty catch blocks in `src/lib/signal-storage.ts`
- Functions fixed: `loadMutedEntities`, `loadPreviousEntityNames`, `loadEdgeHistory`, `saveEdgeHistory`, `loadEntityBaselines`, `updateEntityBaselines`
- Each catch now logs function name, the error object, and which fallback is returned
- Fallback behavior (empty Map/Set, void) unchanged — only the silence is removed
- All 124 existing tests pass

## 2026-04-10 — Fix: RSS Input Validation (Audit Violation #3)
- Added input validation to `parseRssItems()` and `parseAtomEntries()` in `src/lib/feed-fetcher.ts`
- URL protocol whitelist: `link` and `imageUrl` fields now only allow `https:` and `http:` (via `new URL()` constructor). Non-conforming URLs replaced with empty string, triggering existing fallbacks (`source.url` for links, favicon API for images).
- Title capped at 500 characters
- Date bounds: rejects dates >48h future or before 2000-01-01; uses current timestamp as fallback. Existing skip logic (`hasValidDate`) unchanged — bounds only affect the final `published` field.
- Summary cap raised from 300 to 1000 characters
- No function signature or return type changes. No other files modified.
- All 124 existing tests pass

## 2026-04-10
- Created AUDIT.md from codebase audit — 5 violations documented
- Initialized project governance files (CLAUDE.md, MANIFEST.md, DEVLOG.md)
- No code changes

## 2026-04-09 — Fix: Stale RSS Feeds Due to Next.js Data Cache

### Problem

RSS feeds returned articles 14+ hours old despite the `/api/sources` route handler running live (`x-vercel-cache: MISS`, fresh `fetchedAt` timestamps). The route reported 68/73 feeds succeeded, but all content was stale.

### Root Cause

Next.js 14 caches `fetch()` responses in its **Data Cache** by default. `export const dynamic = "force-dynamic"` prevents full-route static generation but does **not** disable the Data Cache for individual `fetch()` calls within route handlers.

During the PR #23 refactor (2026-04-06), `{ cache: 'no-store' }` was dropped from the client-side fetch in `useSources.ts`. The three server-side `fetch()` calls in `feed-fetcher.ts` (direct, relay, altUrl) never had it — so every outbound RSS request silently returned cached XML from hours ago.

### Fix

1. Added `cache: 'no-store'` to all three server-side `fetch()` calls in `src/lib/feed-fetcher.ts`
2. Restored `cache: 'no-store'` on the client-side fetch in `src/hooks/useSources.ts`
3. Added `export const fetchCache = 'force-no-store'` to `src/app/api/sources/route.ts` as defense-in-depth

### Caching Architecture (After Fix)

| Layer | Mechanism | TTL | Purpose |
|-------|-----------|-----|---------|
| Next.js Data Cache | `cache: 'no-store'` + `fetchCache: 'force-no-store'` | Disabled | Ensures fresh RSS XML on every invocation |
| In-memory `feedCache` | 5 min fresh / 30 min stale | 5 min | Deduplicates within a single serverless instance lifetime |
| CDN (Vercel Edge) | `s-maxage=60, stale-while-revalidate=300` | 60s fresh / 5 min stale | Coalesces concurrent client requests |
| Browser | `cache: 'no-store'` on client fetch | Disabled | Ensures client always hits CDN |

## 2026-04-06 — Major Refactoring: Module Extraction + Test Suite

### Summary

Refactored the three largest files in the codebase by extracting focused modules, added comprehensive unit test coverage with Vitest, and created project documentation.

### Problem

The codebase had three monolithic files that were difficult to maintain:
- `DashboardTable.tsx` (795 lines) — mixed UI, state, theme, and utility logic
- `feed-fetcher.ts` (722 lines) — ad filtering, XML parsing, image extraction, and fetch logic all in one file
- `SignalsTab.tsx` (775 lines) — localStorage helpers interleaved with UI

There were zero automated tests, no README, and no development log.

### Changes

#### Module Extraction from `feed-fetcher.ts`

| New File | Extracted From | Purpose |
|----------|---------------|---------|
| `src/lib/ad-filter.ts` | feed-fetcher.ts:4-112, 246-281 | Ad/spam detection with 50+ title patterns, 14 URL patterns, 28 financial patterns |
| `src/lib/xml-helpers.ts` | feed-fetcher.ts:114-151 | `stripHtml`, `extractTag`, `extractAttr` |
| `src/lib/image-extractor.ts` | feed-fetcher.ts:153-238 | 6-method image URL extraction hierarchy |

`feed-fetcher.ts` now imports from these modules and focuses on feed parsing + fetch logic.

#### Module Extraction from `DashboardTable.tsx`

| New File | Extracted From | Purpose |
|----------|---------------|---------|
| `src/lib/theme.ts` | DashboardTable.tsx:190-225 | `getThemeClasses()` function with `ThemeClasses` interface |
| `src/lib/date-utils.ts` | DashboardTable.tsx:43-76 | `timeAgo()` and `formatDate()` utilities |
| `src/components/HeaderBar.tsx` | DashboardTable.tsx:238-426 | Header bar with unified `SearchInput` component (eliminates desktop/mobile duplication) |
| `src/components/FeedItemImage.tsx` | DashboardTable.tsx:626-646, 700-720 | Shared image component with fallback logic (eliminates desktop/mobile duplication) |

#### Module Extraction from `SignalsTab.tsx`

| New File | Extracted From | Purpose |
|----------|---------------|---------|
| `src/lib/signal-storage.ts` | SignalsTab.tsx:15-55 | `loadMutedEntities`, `saveMutedEntities`, `loadPreviousEntityNames`, `saveEntitySnapshot` |

#### Test Suite

Added Vitest with 124 unit tests across 8 test files:

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `ad-filter.test.ts` | 25 | Ad title/link/financial pattern detection |
| `xml-helpers.test.ts` | 18 | HTML stripping, tag/attribute extraction, CDATA |
| `image-extractor.test.ts` | 10 | media:content, thumbnail, enclosure, img extraction |
| `urgency.test.ts` | 18 | Category-to-urgency mapping, row/badge classes |
| `date-utils.test.ts` | 10 | timeAgo, formatDate with mocked timers |
| `feed-parser.test.ts` | 10 | RSS 2.0, Atom, ad filtering, date window, CDATA |
| `entity-extractor.test.ts` | 10 | Country/org/alias detection, co-occurrence, sentiment |
| `signal-detector.test.ts` | 8 | Surge, sentiment deterioration, novel emergence |

Run: `npm test`

#### Documentation

- **README.md** — Project overview, features, tech stack, setup, architecture, testing
- **DEVLOG.md** — This file
- **HANDOFF.md** — Updated with new file structure

### File Size Changes

| File | Before | After | Change |
|------|--------|-------|--------|
| `feed-fetcher.ts` | 722 lines | ~320 lines | -56% |
| `DashboardTable.tsx` | 795 lines | ~370 lines | -53% |
| `SignalsTab.tsx` | 775 lines | ~720 lines | -7% |

### No Behavior Changes

All refactoring was purely structural. No UI changes, no functional changes, no API changes. The application behaves identically before and after this refactoring.
