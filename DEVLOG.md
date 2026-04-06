# World Dashboard Development Log

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
