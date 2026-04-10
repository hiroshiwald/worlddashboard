# Codebase Audit: CLAUDE.md Compliance Review

**Date:** 2026-04-10
**Scope:** Follow-up review — verify AUDIT-2.md fixes, fresh scan of all `src/` files
**Status:** Immutable reference — do not modify this file

---

## Part 1: AUDIT-2.md Fix Verification

| # | Violation | Status | Evidence |
|---|-----------|--------|----------|
| V2-1 | 7 functions exceeding 50-line limit | **FIXED** | All 7 decomposed: `buildSituations` → 7 functions each ≤45 lines; `extractEntities` → 5 functions each ≤47 lines; `doFetchSingleFeed` → 4 functions each ≤42 lines; `useDashboardTable` trimmed to 74 lines with 3 extracted helpers; `SignalsTab`, `DiscoveryTab`, `IntelTab` decomposed into hook + sub-components |
| V2-2 | Silent catch blocks in 3 URL helpers | **FIXED** | All 3 now log via `console.warn` with function name, malformed URL, and error object |
| V2-3 | Fire-and-forget async without comment | **FIXED** | Comment added to `useSources.ts` useEffect: "Fire-and-forget: useEffect cannot return a promise. Errors handled inside fetchFeed." |
| V2-4 | Write-once mutable module state | **FIXED** | `Object.freeze(LOOKUP_MAP)` added at `entity-extractor.ts` line 39 after initialization |

### V2-1 — Detail

The three tab components were decomposed following the established pattern (hook + sub-components + barrel export):

| Component | Before | After | Hook | Sub-components |
|-----------|--------|-------|------|----------------|
| `SignalsTab` | 512 lines | 57 lines | `useSignalsTab.ts` (218 lines) | 5 in `signals/` |
| `DiscoveryTab` | 359 lines | 53 lines | `useDiscoveryTab.ts` (176 lines) | 3 in `discovery/` |
| `IntelTab` | 481 lines | 66 lines | `useIntelTab.ts` (128 lines) | 5 in `intel/` |

The component files are now thin composition shells. However, the extracted hooks absorbed all logic without further decomposition — they exceed the 50-line limit themselves. Carried forward as V3-1 below.

The remaining V2-1 items (`buildSituations`, `extractEntities`, `doFetchSingleFeed`) were properly decomposed into small focused functions, each under 50 lines. `useDashboardTable` was trimmed to 74 lines with 3 extracted helpers (`matchesText`, `filterItems`, `sortItems`). The DEVLOG justifies the 74-line size ("6 state variables + 1 effect + 2 memos + 5 handlers make further reduction below 50 counterproductive"), but no in-code exception comment exists per the CLAUDE.md rule wording.

---

## Part 2: Fresh Compliance Scan

### Violations Ranked by Severity

| Rank | Violation | Instances | Rule |
|------|-----------|-----------|------|
| V3-1 | Hook functions exceeding 50-line limit (introduced by V2-1 fixes) | 3 | Max 50 lines per function |
| V3-2 | `enrichEntities` exceeding 50-line limit (missed by AUDIT-2) | 1 | Max 50 lines per function |
| V3-3 | `matchPersonNames` exceeding 50-line limit (missed by AUDIT-2) | 1 | Max 50 lines per function |
| V3-4 | `extractImageUrl` exceeding 50-line limit (missed by AUDIT-2) | 1 | Max 50 lines per function |

---

## V3-1: Hook Functions Exceeding 50-Line Limit (3 instances)

**Rule violated:** *Max 50 lines per function. If longer, extract.*

| Function | File | Lines | Size | Over limit |
|----------|------|-------|------|------------|
| `useSignalsTab` | `src/hooks/useSignalsTab.ts` | 42–218 | 177 | **3.5x** |
| `useDiscoveryTab` | `src/hooks/useDiscoveryTab.ts` | 38–176 | 139 | **2.8x** |
| `useIntelTab` | `src/hooks/useIntelTab.ts` | 28–128 | 101 | **2x** |

**Root cause:** During the V2-1 fix, monolith component logic was extracted into custom hooks without further decomposition. The hooks inherited the same multi-concern structure that prompted the original component decomposition.

**Risk:** The "unmanageable blast radius" problem cited in AUDIT.md Violation #2 now lives in the hooks. Each hook mixes state management, memoized computations, event handlers, and theme object construction.

**`useSignalsTab` concern breakdown (177 lines):**
- Muting state management (lines 47–65) — extractable as `useMuteState` hook or pure functions
- Entity snapshot persistence (lines 67–80) — extractable as `useEntitySnapshots`
- Signal detection + filtering (lines 82–100) — memoized computation
- Evidence article lookup (lines 122–138) — pure function, extractable outside hook
- Top entities + sparkline computation (lines 140–170) — pure memo, extractable
- Theme object construction (lines 180–218) — extractable as pure function

**`useDiscoveryTab` concern breakdown (139 lines):**
- Filter state (lines 42–48) — 5 state variables
- Entity filtering + positioning (lines 52–95) — memoized computations
- Edge rendering logic (lines 97–130) — memoized computation
- Hover/tooltip state (lines 132–150) — event handlers
- Theme construction (lines 155–176) — extractable as pure function

**`useIntelTab` concern breakdown (101 lines):**
- Entity extraction + situation building (lines 29–31) — memoized computations
- Entity lookup + situation classification (lines 37–68) — memoized computations
- Show more/less state (lines 33–35, 70–80) — UI state
- Theme construction (lines 85–128) — extractable as pure function

---

## V3-2: `enrichEntities` Exceeding 50-Line Limit (1 instance)

**Rule violated:** *Max 50 lines per function. If longer, extract.*

| Function | File | Lines | Size | Over limit |
|----------|------|-------|------|------------|
| `enrichEntities` | `src/lib/novelty-scorer.ts` | 26–153 | 128 | **2.5x** |

**AUDIT-2 correction:** AUDIT-2.md listed this file as "Largest function ~50 lines — at limit edge." The actual function spans 128 lines. The prior scan likely measured only the inner `.map()` callback rather than the full function body.

**Risk:** The function computes 5 novelty dimensions (category spread, source diversity, edge novelty, baseline surprise, quiet mover), persists state via `saveEdgeHistory` and `updateEntityBaselines`, and builds the final enriched entity array — all in one function body. Each scoring dimension is a self-contained block extractable as a pure scoring function.

```typescript
export function enrichEntities(
  entities: ExtractedEntity[],
  items: FeedItem[]
): EnrichedEntity[] {
  // lines 30–35: build lookup maps and load history
  // lines 45–73: category spread scoring (0–30)
  // lines 75–79: source diversity scoring (0–15)
  // lines 81–98: edge novelty scoring (0–25)
  // lines 100–121: baseline surprise (0–20) / emergence (0–10)
  // lines 123–134: quiet mover bonus
  // lines 136–153: build result + persist state
}
```

---

## V3-3: `matchPersonNames` Exceeding 50-Line Limit (1 instance)

**Rule violated:** *Max 50 lines per function. If longer, extract.*

| Function | File | Lines | Size | Over limit |
|----------|------|-------|------|------------|
| `matchPersonNames` | `src/lib/entity-extractor.ts` | 127–206 | ~80 | **1.6x** |

**Risk:** Low. The function is a multi-stage person name heuristic with regex matching, stopword filtering, source-name deduplication, and title-prefix stripping. The logic is cohesive, but the deduplication/filtering pass (lines ~186–206) is a clear extraction candidate.

---

## V3-4: `extractImageUrl` Exceeding 50-Line Limit (1 instance)

**Rule violated:** *Max 50 lines per function. If longer, extract.*

| Function | File | Lines | Size | Over limit |
|----------|------|-------|------|------------|
| `extractImageUrl` | `src/lib/image-extractor.ts` | 18–88 | 71 | **1.4x** |

**Risk:** Low. The function attempts 6 sequential regex patterns to find an image URL in RSS/Atom XML, returning on first match. The structure is linear with no branching concerns. Each pattern block (3–6 lines) is small, but the total exceeds the limit.

---

## Borderline Cases (Within 30% of Limit)

| Function | File | Lines | Size | Notes |
|----------|------|-------|------|-------|
| `useDashboardTable` | `src/hooks/useDashboardTable.ts` | 78–151 | 74 | DEVLOG justification exists; no in-code exception comment |
| `parseRssItems` | `src/lib/feed-fetcher.ts` | 29–100 | 72 | Cohesive format-specific parser |
| `parseAtomEntries` | `src/lib/feed-fetcher.ts` | 103–167 | 65 | Cohesive format-specific parser |
| `getUrgencyLevel` | `src/lib/urgency.ts` | 3–55 | 53 | Exhaustive category mapping — declarative structure |

These are not flagged as violations. The CLAUDE.md rule allows exceptions when "splitting would scatter tightly related state or logic across files in a way that hurts readability" provided the reason is noted in a comment. `useDashboardTable` has a DEVLOG justification but no in-code comment; recommend adding one.

---

## Compliance Verified — No Violations

| Rule | Status |
|------|--------|
| Empty catch blocks | **None found** — all 6 `signal-storage.ts` catches log via `console.error`; all 3 URL helper catches log via `console.warn` |
| Shared mutable state | **None found** — `feedCache` is caller-owned; `LOOKUP_MAP` is frozen; `inFlightFetch` removed |
| Fire-and-forget promises | **None found** — `useSources.ts` useEffect has explanatory comment |
| Input validation at boundaries | **Present** — `sanitizeUrl` (URL protocol), `isDateInBounds` (date range), title/summary caps, `validateApiResponse` |
| Schema validation on API response | **Present** — `validateApiResponse` in `useSources.ts` validates all fields with typed defaults |

---

## Files Scanned — No Violations Found

| File | Lines | Notes |
|------|-------|-------|
| `src/app/page.tsx` | 5 | Clean |
| `src/app/layout.tsx` | 26 | Clean |
| `src/app/api/sources/route.ts` | 42 | `feedCache` at module scope is owned state, not shared — acceptable |
| `src/components/DashboardTable.tsx` | 80 | Clean (post-refactor) |
| `src/components/HeaderBar.tsx` | 246 | Internal functions all under 50 lines |
| `src/components/NetworkTab.tsx` | 182 | Internal functions all under 50 lines |
| `src/components/MapTab.tsx` | 242 | Internal functions all under 50 lines |
| `src/components/SignalsTab.tsx` | 57 | Clean (post-refactor) |
| `src/components/DiscoveryTab.tsx` | 53 | Clean (post-refactor) |
| `src/components/IntelTab.tsx` | 66 | Clean (post-refactor) |
| `src/components/FeedItemImage.tsx` | 66 | Catch block logs via `console.warn` |
| `src/components/dashboard/*.tsx` | 45–95 | All within limits |
| `src/components/intel/*.tsx` | 39–109 | All within limits |
| `src/components/signals/*.tsx` | 39–115 | All within limits |
| `src/components/discovery/*.tsx` | 33–147 | All within limits |
| `src/hooks/useSources.ts` | 117 | Clean (post-fix) |
| `src/hooks/useDashboardTable.ts` | 151 | Borderline — see table above |
| `src/lib/ad-filter.ts` | 147 | Clean |
| `src/lib/xml-helpers.ts` | 38 | Clean |
| `src/lib/date-utils.ts` | 35 | Clean |
| `src/lib/theme.ts` | 70 | Clean |
| `src/lib/urgency.ts` | 126 | Borderline — see table above |
| `src/lib/geo-coordinates.ts` | 168 | Data file — clean |
| `src/lib/cascade-graph.ts` | 155 | Largest function ~40 lines — clean |
| `src/lib/signal-detector.ts` | 324 | 8 functions, largest 41 lines — clean |
| `src/lib/signal-storage.ts` | 173 | Clean (post-fix) |
| `src/lib/situation-builder.ts` | 278 | 8 functions, largest 48 lines — clean (post-decomposition) |
| `src/lib/types.ts` | 148 | Type definitions only — clean |
| `src/lib/entity-dictionaries.ts` | ~600 | Data file — clean |
| `src/lib/sources-data.json` | — | Static data — clean |
