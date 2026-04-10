# Codebase Audit: CLAUDE.md Compliance

**Date:** 2026-04-10
**Scope:** All source files in `src/` audited against CLAUDE.md coding rules
**Status:** Immutable reference — do not modify this file

---

## Top 5 Violations Ranked by Severity

| Rank | Violation | Location | Risk |
|------|-----------|----------|------|
| 1 | 6 swallowed errors (empty catch blocks) | `signal-storage.ts` | Silent data loss across detection pipeline |
| 2 | 4 functions 240–450 lines (limit: 50) | DashboardTable, SignalsTab, DiscoveryTab, IntelTab | Unmanageable change blast radius |
| 3 | Unvalidated RSS input (links, images, dates) | `feed-fetcher.ts` parseRssItems/parseAtomEntries | XSS via malicious feed, unbounded data |
| 4 | Shared mutable module state (cache + dedup) | `feed-fetcher.ts` feedCache, inFlightFetch | Race conditions, wrong data served |
| 5 | No schema validation on API response | `useSources.ts` line 34 | Full dashboard crash on malformed response |

---

## Violation 1: Swallowed Errors in `signal-storage.ts` (6 instances)

**Rule violated:** *Fail fast and loud. No empty catch blocks. No swallowed errors. No silent fallbacks masking broken state.*

Every function in this module has a bare `catch {}` that silently returns an empty `Map` or `Set`, or does nothing on write failure:

| Function | Lines | Silent return |
|----------|-------|---------------|
| `loadMutedEntities` | 6–15 | `new Map()` |
| `loadPreviousEntityNames` | 25–35 | `new Set()` |
| `loadEdgeHistory` | 56–72 | `new Map()` |
| `saveEdgeHistory` | 74–104 | `void` (comment-only catch) |
| `loadEntityBaselines` | 116–125 | `new Map()` |
| `updateEntityBaselines` | 127–158 | `void` (comment-only catch) |

**Risk:** These functions form the persistence layer for the entire anomaly detection pipeline — muted signals, edge history, entity baselines, emergence snapshots. When localStorage is corrupted, full, or shaped wrong, callers silently get empty state. Signals get un-muted without notice, novelty baselines reset invisibly, edge history vanishes. The system continues operating on hollow data with zero indication anything is wrong.

**Example — `saveEdgeHistory` (lines 74–104):**
```typescript
export function saveEdgeHistory(
  currentEdges: Map<string, number>
): void {
  try {
    const existing = loadEdgeHistory();
    // ... merge and prune logic ...
    localStorage.setItem(EDGE_HISTORY_KEY, JSON.stringify({ edges, lastUpdated: now }));
  } catch {
    // localStorage full or unavailable — degrade gracefully
  }
}
```
The comment "degrade gracefully" does not excuse swallowing the error. Callers cannot know if their data was persisted.

**Example — `loadPreviousEntityNames` (lines 25–35):**
```typescript
export function loadPreviousEntityNames(): Set<string> {
  try {
    const raw = localStorage.getItem("wd-entity-snapshot");
    if (!raw) return new Set();
    const { names, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > 2 * 60 * 60 * 1000) return new Set();
    return new Set(names);
  } catch {
    return new Set();
  }
}
```
If localStorage contains `{"other":"data"}`, destructuring yields `names = undefined`, and `new Set(undefined)` throws a `TypeError` — caught and silently replaced with an empty Set, corrupting emergence detection.

---

## Violation 2: Massive Component Functions (4 components, each 4–8x over limit)

**Rule violated:** *Max 50 lines per function. If longer, extract.*

| Component | File | Lines | Code lines | Over limit |
|-----------|------|-------|------------|------------|
| `DashboardTable` | `src/components/DashboardTable.tsx` | 56–507 | ~450 | **9x** |
| `SignalsTab` | `src/components/SignalsTab.tsx` | 138–511 | ~370 | **7x** |
| `DiscoveryTab` | `src/components/DiscoveryTab.tsx` | 39–358 | ~310 | **6x** |
| `IntelTab` | `src/components/IntelTab.tsx` | 84–327 | ~240 | **5x** |

**Risk:** These are not slightly over — they are an order of magnitude beyond the limit. Each mixes state management, data transformation, event handlers, and hundreds of lines of JSX in a single function body.

**DashboardTable breakdown (56–507):**
- 9 state variables (lines 68–76)
- useEffect for theme load (lines 78–81)
- Theme toggle handler (lines 83–88)
- Sort handler (lines 90–96)
- Categories memoization (lines 98–101)
- Filtered items memoization (lines 103–133)
- Sorted items memoization (lines 135–151)
- Sort arrow helper (lines 153–156)
- Entity click handler (lines 160–163)
- Main JSX render (lines 165–506) — 342 lines of JSX alone

**SignalsTab breakdown (138–511):**
- Entity/enrichment setup (lines 139–141)
- Mute state management (lines 143–161)
- Entity name tracking refs (lines 163–176)
- Signal detection (lines 178–181)
- Active signals filtering (lines 184–192)
- Item and entity lookups (lines 199–221)
- Evidence articles function (lines 224–240)
- Top entities and sparkline computation (lines 243–274)
- Main JSX render (lines 302–511) — 210 lines of JSX

Every change to these components has a blast radius of hundreds of lines. Bugs are hard to isolate, and the components are effectively untestable as units.

---

## Violation 3: Unvalidated External Input from 147 RSS/Atom Feeds

**Rule violated:** *Treat all external inputs as untrusted: validate types, shapes, and bounds at module boundaries before processing.*

In `src/lib/feed-fetcher.ts`, `parseRssItems()` (lines 10–79) and `parseAtomEntries()` (lines 82–144) extract fields from untrusted XML and pass them straight through:

| Field | Validation | Gap |
|-------|-----------|-----|
| `link` | None | No URL validation, no protocol whitelist. `javascript:alert(1)` renders as clickable `<a href>` in DashboardTable (lines 373, 434). XSS vector. |
| `imageUrl` | None | Extracted via regex from `<media:content>`, `<enclosure>`, `<img src>`. No protocol check. `data:` or `javascript:` URIs could reach `<img src>`. |
| `pubDate` | `!isNaN(date.getTime())` | Accepts any string JavaScript's `Date()` constructor parses — extreme future/past dates, no bounds. |
| `title` | None | Unbounded string passed directly to rendering. |
| `summary` | `.slice(0, 300)` | Truncated but not sanitized before truncation. |

**Risk:** This is the system's primary external boundary — 147 sources controlled by third parties. A single compromised or malicious feed could inject harmful links into every user's dashboard. React's default escaping mitigates some XSS in text content but does not cover `href` attributes on `<a>` tags.

**Code path — `parseRssItems` (lines 10–79):**
```typescript
const link = extractTag(block, "link");          // no validation
const imageUrl = extractImageUrl(block, link);   // no protocol check
// ... these values flow directly into FeedItem objects
```

**Code path — rendering in `DashboardTable.tsx` (line 373):**
```typescript
<a href={item.link} target="_blank" rel="noopener noreferrer">
```
A `javascript:` link from a feed would be rendered as a clickable anchor.

---

## Violation 4: Shared Mutable Module State in `feed-fetcher.ts`

**Rule violated:** *No shared mutable state between modules. Data flows through arguments and return values.*

Two module-level mutable variables in `src/lib/feed-fetcher.ts`:

### `feedCache` (line 209)
```typescript
const feedCache = new Map<string, CacheEntry>();
```
A `Map<string, CacheEntry>` mutated by every call to `fetchSingleFeed()` (lines 234–238). Multiple concurrent `fetchAllFeeds()` invocations read and write the same map without synchronization.

### `inFlightFetch` (line 400)
```typescript
let inFlightFetch: Promise<FetchAllResult> | null = null;

export function fetchAllFeeds(sources: SourceMeta[]): Promise<FetchAllResult> {
  if (inFlightFetch) return inFlightFetch;  // caller B gets caller A's promise

  inFlightFetch = doFetchAllFeeds(sources).finally(() => {
    inFlightFetch = null;
  });

  return inFlightFetch;
}
```
If caller A triggers a fetch with source list X, and caller B calls with source list Y while A is in flight, B silently receives A's results for the wrong source list.

**Risk:** The cache creates non-deterministic behavior depending on call history. The dedup variable can serve stale or wrong data across callers. Both violate the data-flows-through-arguments principle and make testing unreliable.

### Also noted: `LOOKUP_MAP` in `entity-extractor.ts` (line 17)
```typescript
const LOOKUP_MAP = new Map<string, LookupEntry>();
```
Module-level Map initialized empty, then mutated via `addToLookup()` calls at module load time. Functions like `matchDictionary()` (line 63) read from this state without it being passed as a parameter. Lower severity since it is effectively write-once at init, but still violates the rule.

---

## Violation 5: No Schema Validation on API Response in `useSources.ts`

**Rule violated:** *Treat all external inputs as untrusted: validate types, shapes, and bounds at module boundaries before processing.*

At `src/hooks/useSources.ts` lines 32–40:
```typescript
const data = await res.json();                     // no validation
setItems(data.items);                              // if null → crash on .map()
setFeedsAttempted(data.feedsAttempted);            // if undefined → NaN in UI
setFeedsSucceeded(data.feedsSucceeded);
setTotalItems(data.count);
setFeedDiagnostics(data.feedDiagnostics || []);    // lone defensive check
```

The only validation is `res.ok`. The response shape is trusted completely.

| Failure mode | Consequence |
|-------------|-------------|
| `data.items` is `null` | `DashboardTable` crashes on `items.map()` at line 103 — unrecoverable |
| `data.items` contains objects missing `link` | Renders `<a href={undefined}>` — broken links |
| `data.feedsAttempted` is `undefined` | Header badge shows `NaN` |
| `data.items[n].imageUrl` contains `javascript:` URI | XSS via `<img src>` |

**Risk:** This is the single point of entry for all data into the frontend. A malformed API response — from a server bug, proxy corruption, or CDN issue — takes down the entire dashboard with an unrecoverable runtime error. The `|| []` fallback on `feedDiagnostics` shows awareness of the problem but was applied to only one field.

### Also noted: localStorage reads in `signal-storage.ts`

All four load functions (`loadMutedEntities`, `loadPreviousEntityNames`, `loadEdgeHistory`, `loadEntityBaselines`) use `JSON.parse()` on localStorage data with type assertions but no runtime shape validation. If a user or extension modifies localStorage, the parsed data could have the wrong shape, causing TypeErrors or NaN comparisons downstream. This compounds with Violation 1 (the errors from these shape mismatches are silently swallowed).

---

## Additional Violations Noted (Lower Severity)

### Fire-and-forget promise in `useSources.ts` (line 49)
```typescript
useEffect(() => {
  fetchFeed();  // async function called without await
}, [fetchFeed]);
```
The `fetchFeed` function is async and its returned promise is not awaited or caught. While React useEffect cannot be async, the CLAUDE.md rule requires every async operation to be "explicitly detached with a comment stating why." No such comment exists.

### Silent fallbacks in image utilities
- `getDomainFromUrl` in `src/lib/image-extractor.ts` (lines 3–9): bare `catch {}` returns empty string
- `fallbackSourceImage` in `src/components/FeedItemImage.tsx` (lines 12–19): bare `catch {}` returns empty string

Both mask URL parsing errors, making broken image fallback logic impossible to debug.
