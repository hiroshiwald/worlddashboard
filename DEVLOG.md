# World Dashboard Development Log

## 2026-07-15 — Entity database persistence: registry, review queue, timeline

Entities become durable database objects with real first-seen dates; unknown
recurring names surface in a Review queue for accept/merge/dismiss; clicking
an entity opens a real timeline instead of a text search.

- `migrations/002_entity_indexes.sql`: one `CREATE INDEX article_entities_entity_idx
  ON article_entities (entity_id)` for entity→articles lookups (the PK only
  covers article_id-first). Not run — the user applies it via Neon's SQL editor.
- `src/lib/server/extract-v2.ts` (new): pure candidate extraction —
  `normalizeName` (NFKD diacritic fold, lowercase, whitespace collapse, one
  trailing corporate-suffix strip) and `extractCandidates` (dictionary,
  compromise NLP, ALL-CAPS acronym, and a 2-3-capitalized-word person-regex
  layer, in that priority order; dedup by norm keeps the longest display).
- `src/lib/entity-extractor.ts`: additive-only — exported `matchDictionaryEntries`,
  `isDictionaryTerm`, and `scoreSentiment` so extract-v2.ts and entity-ingest.ts
  reuse the existing dictionary-matching loop and sentiment lexicon instead of
  duplicating them. `matchDictionary`'s internals were refactored to share that
  loop, but its return value (and every existing caller's behavior) is unchanged —
  `entity-extractor.test.ts` has a zero diff and still passes in full.
- `src/lib/server/entity-ingest.ts` (new): `processNewArticles` selects
  cluster heads from the last 6h with no `article_entities` rows yet
  (`NOT EXISTS` — idempotent, self-healing re-runs and catch-up runs),
  resolves each extracted candidate against the DB registry (canonical_name +
  aliases, all statuses including dismissed) then the static dictionaries
  (creates the entity row on first hit), else accumulates into
  `entity_candidates`. Batches writes: `entities` (upsert on canonical_name),
  `article_entities`, `entity_mentions_hourly` (JS-aggregated rollup, upserted
  with running sums — `source_count` is a same-batch approximation reconciled
  via `GREATEST`, noted in a comment; exact counts need an `article_entities`
  join), `entity_edges` (a<b pair ordering, article_count sums),
  `entity_candidates` (mention/day/source/sample-title rollup against
  pre-fetched existing rows, upserted via `jsonb_to_recordset` since its
  array-typed columns are jagged and can't go through a plain `UNNEST`).
- `src/app/api/ingest/route.ts`: calls `processNewArticles(sql)` after
  `sweepRetention`, includes its stats under `entities` in the response.
- `src/app/api/candidates/route.ts` (new): `GET` returns promotable
  candidates (≥3 distinct sources, ≥2 distinct days, seen within 14 days),
  sorted by source count desc. `POST { nameNorm, action, type?, mergeInto? }`:
  `accept` inserts a tracked entity and deletes the candidate; `merge` appends
  the candidate's norm + display to an existing entity's aliases by exact
  `canonical_name` (404 if none); `dismiss` inserts a dismissed entity using
  the candidate's stored `type_hint`. Every field is validated (action/type
  whitelists, bounded non-empty strings) before touching the DB.
- `src/components/ReviewTab.tsx` (new) + `HeaderBar.tsx` / `dashboard/TabContent.tsx`:
  new "Review" tab (same dynamic-import + switch pattern as the other tabs,
  but bypasses the shared `items.length===0` gate since it's DB-backed, not
  feed-backed) showing each candidate's counts, source chips, and sample
  titles with Accept/Merge/Dismiss actions; the tab label shows the pending
  count when > 0.
- `src/app/api/entities/route.ts` + `entities/[id]/route.ts` (new): resolve a
  clicked name to an entity id (same `normalizeName` scheme as ingest-time
  resolution), then return the entity profile, last-7-day hourly mention
  series, last 20 cluster-head articles, and top 10 co-occurring entities.
- `src/components/EntityPanel.tsx` (new): slide-over — name/type/status/first
  seen, an inline-SVG sparkline of the hourly series, the article list
  (linked out), and related-entity chips that reload the panel in place.
- `src/hooks/useDashboardTable.ts`: `handleEntityClick` now tries
  `GET /api/entities?name=` first and opens the panel on a hit; on
  404/malformed-response/network failure it warns and falls back to the
  original text-filter behavior unchanged (mirrors `useSources.ts`'s existing
  DB-then-live fallback convention). Also added `candidateCount` (fetched
  once on mount, refreshed by `ReviewTab` after each action) for the header
  badge.
- **Fix-pack** (same day, after an adversarial 5-agent review of the diff):
  `dedupeMentions()` in entity-ingest.ts collapses two mentions of the same
  entity from one article (possible when two of its aliases both appear in
  the text) before they'd otherwise double-count an hourly bucket's mentions
  and sentiment_sum; both entity-registry queries gained `ORDER BY id ASC`
  for deterministic alias-collision resolution; `candidates/route.ts`
  accept/dismiss now use the candidate's actual `last_seen_at` instead of
  backdating it to `first_seen_at`, and use `ON CONFLICT DO NOTHING RETURNING
  id` + a 409 response instead of letting a double-submitted accept throw an
  uncaught unique-violation into a raw 500; `useDashboardTable.ts`'s
  `handleEntityClick` and `EntityPanel.tsx`'s `load()` both gained a
  sequence-number guard against an out-of-order async response (rapid clicks
  on two different entities) overwriting a newer one; `fetchCandidateCount`
  got its own try/catch (it was a real unhandled rejection despite a comment
  claiming otherwise).
- **Known limitation** (explicitly authorized by the task spec): `/api/candidates`'s
  POST mutation endpoint is unauthenticated, consistent with every other
  route in this single-user hobby app — no login exists anywhere in the
  system to gate it behind.
- **Deviation**: the task asked for the acronym layer's stoplist to include
  "Q1-Q4"; since the acronym regex only matches letter-led tokens, it was
  widened to `[A-Z][A-Z0-9]{1,4}` (letter first, then letters/digits) so
  "Q1"–"Q4" are actually reachable and filtered rather than dead stoplist
  entries.
- Tests: 60 new (11 extract-v2, 19 entity-ingest incl. the fix-pack's dedup
  coverage, 15 candidates route incl. the fix-pack's 409 cases, 7 entities
  name-resolution route, 8 entities/[id] profile route). 167 → 227 passing.
  `tsc --noEmit` and `npm run build` both clean. Verified
  in a real browser (no `DATABASE_URL` in this sandbox, so every DB-backed
  fetch legitimately 503s): the Review tab renders, highlights as active, and
  shows the 503 as a visible error banner instead of failing silently;
  `EntityPanel` was mounted via a throwaway debug route with a mocked
  `/api/entities/:id` response and screenshotted in both themes (removed
  after — no dependency or file changes left behind).

## 2026-07-15 — Fix-pack: Postgres ingest layer (PR #47 follow-up)
- `migrations/001_core.sql`: `articles.dup_group_id` FK changed from default `NO ACTION` to `ON DELETE SET NULL`. `sweepRetention` deletes articles older than 30d, but a dup-group head can be up to 48h older than its members — under `NO ACTION` the delete aborted once a head crossed the cutoff before its members. Edited the migration in place (never applied to any database yet), no second migration file.
- `src/lib/server/ingest-writer.ts`: replaced the per-article `assignDupGroup` (one `SELECT` + one `UPDATE` per inserted row, called sequentially oldest-first) with a single set-based `assignDupGroups(sql)` — one `WITH heads AS (...) UPDATE articles ... FROM heads` statement issued once after all insert batches. It scans every article from the last 48h with `dup_group_id IS NULL`, joins each to the earliest same-`title_signature` article within the 48h window before it (`DISTINCT ON`, tie-broken by lowest id), and excludes self-matches so heads keep `dup_group_id` NULL. Because it re-scans the whole window every run, it also self-heals rows an earlier partial ingest left ungrouped — the old per-row version couldn't. `InsertedArticle`/`parseInsertedRow`/`toIsoString` and the `SELECT id, title_signature, first_seen_at` return shape were no longer needed and were deleted; `insertBatch` now just returns the inserted row count (`RETURNING id`).
- `src/lib/types.ts` / `src/lib/feed-fetcher.ts`: added optional `publishedEstimated?: true` to `FeedItem`. Both RSS and Atom parsers set it at the exact spot they fall back to `new Date().toISOString()` for a dateless item; the stamped `published` field is left in place for client display. Grepped all 40 `FeedItem` consumers — none does exact-shape/`Object.keys` validation, so the optional field is a no-op everywhere except the two call sites that check it.
- `src/lib/server/ingest-writer.ts` `toArticleRow`: removed the TODO — dateless items (`publishedEstimated: true`) now store `published_at = NULL` instead of the now()-stamp, so estimated dates never pollute real timestamps in Postgres.
- `src/hooks/useDashboardTable.ts` / `src/components/DashboardTable.tsx`: threaded `mode`/`lastIngestAt` from `useFeed()` through the hook's return and into `<HeaderBar>` — both already existed upstream (`useFeed`) and downstream (`HeaderBar`'s `IngestBadge`) but nothing connected them (flagged as Deviation 2 in the prior entry). No new UI.
- `src/lib/server/article-identity.ts` `extractHost`: added `console.warn` to the silent catch, matching `sanitizeUrl`'s convention in `feed-fetcher.ts`.
- Tests: rewrote the two per-row dup-group tests in `ingest-writer.test.ts` into query-shape assertions (single UPDATE call, zero bound parameters, JOIN/window/tie-break/self-exclusion clauses present in the SQL text) since the whole head-selection logic now lives inside Postgres rather than in JS — there's no `DATABASE_URL` in this sandbox to execute it against a real engine, same limitation noted in the prior entry. Added NULL-vs-given `published_at` tests, and two `feed-parser.test.ts` tests for `publishedEstimated` on dateless vs. dated RSS items. 164 → 167 passing. `tsc --noEmit` and `npm run build` both clean.
- **PR #48 review fix**: `assignDupGroups`'s JOIN now requires `h.dup_group_id IS NULL`, so an article can only attach to an actual cluster head, never to another member. Without it, recurring same-signature headlines (e.g. a daily digest) chain member-to-member indefinitely — only the first-ever occurrence stays visible, and every later day's article is hidden as a duplicate for up to 30 days. With the clause, once a head ages out of the 48h lookback window, the next same-signature article's only same-signature neighbors are members, so it finds no head, stays NULL, and becomes the new head — surfacing normally instead of staying hidden. The CTE still reads a pre-update snapshot, so same-run grouping of a fresh insert batch is unaffected.

## 2026-07-15 — Add Postgres ingest layer: hourly ingest, DB-backed read path, live-mode fallback
- `src/lib/server/db.ts`: `getSql()` — thin wrapper over `@neondatabase/serverless`'s `neon()`, built from `DATABASE_URL`. Throws immediately if unset. No module-level client instance; callers own the client and pass it down (`Sql`/`SqlRow` types exported for that purpose).
- `migrations/001_core.sql`: schema v1 — `articles` (content-hash deduped, `title_signature` + `dup_group_id` for cross-source clustering) plus `entities`, `article_entities`, `entity_mentions_hourly`, `entity_edges`, `entity_candidates`, `signals`, `settings` for later tasks to wire up.
- `scripts/migrate.mjs`: idempotent migration runner (`schema_migrations` ledger table). Gotcha: the Neon HTTP driver executes one statement per call, so each migration file is split into individual statements and bundled into a single `sql.transaction()` rather than sent as one multi-statement string.
- `src/lib/server/article-identity.ts`: `contentHash(title, link)` — sha256 of normalized title + link host, using `node:crypto`. Reuses `titleSignature` from `story-cluster.ts` (via the writer) rather than duplicating it.
- `src/lib/server/ingest-writer.ts`: `persistArticles()` — batched `INSERT ... SELECT FROM UNNEST(...) ON CONFLICT (content_hash) DO NOTHING RETURNING ...`, then sequential oldest-first `dup_group_id` assignment (earliest same-signature article within 48h). `sweepRetention()` — 4 deletes (articles 30d, hourly mentions 180d, dismissed signals 90d, entity candidates 14d).
- `src/app/api/ingest/route.ts`: authenticated via `x-ingest-key` (`INGEST_SECRET`) or `Authorization: Bearer` (`CRON_SECRET`); 500 if `INGEST_SECRET` is unset, 401 on mismatch. Fetches all feeds, persists, sweeps retention.
- `src/app/api/articles/route.ts`: DB-backed read path — cluster heads only (`dup_group_id IS NULL`), `days`/`category` filters, capped at 500, shaped as `FeedItem`. Returns 503 if `DATABASE_URL` is unset or the table is empty, which the client uses as its fallback signal.
- `.github/workflows/ingest.yml`: hourly cron (`7 * * * *`) + `workflow_dispatch`, POSTs with `x-ingest-key`. `vercel.json`: daily fallback cron (Hobby-plan limit) hitting the same endpoint.
- `src/hooks/useSources.ts`: `useFeed()` now tries `GET /api/articles` first; on 503/network/shape error it warns and falls back to the existing live `/api/sources` fetch. Return type gains `mode: 'db' | 'live'` and `lastIngestAt`.
- `src/components/HeaderBar.tsx`: new optional `mode`/`lastIngestAt` props and a single `IngestBadge` element — "LIVE MODE" text in live mode, ingest freshness (amber past 3h) in db mode.
- **Deviation 1**: the spec called `/api/ingest` "POST only," but Vercel Cron Jobs always trigger via GET (not configurable) and `vercel.json`'s fallback cron must hit the same path per the spec — added a `GET` handler alongside `POST`, sharing the same auth check and ingest logic.
- **Deviation 2**: `src/hooks/useDashboardTable.ts` and `src/components/DashboardTable.tsx` (the only caller of `HeaderBar`) are outside the authorized file list, so the new `mode`/`lastIngestAt` props are optional and the badge falls back to the old `fetchedAt` display when they're omitted — `useFeed()`'s new fields aren't yet threaded through to the UI. Follow-up: update those two files to pass `mode`/`lastIngestAt` from `useFeed()` into `HeaderBar`.
- 15 new tests (9 `article-identity`, 6 `ingest-writer`/`sweepRetention`). 149 → 164 passing. `DATABASE_URL` unavailable in this sandbox, so all DB logic is unit-tested against a mocked `sql` client; `scripts/migrate.mjs` is syntax-checked only (`node --check`), not integration-tested.

## 2026-07-15 — Backfill: purify novelty-scorer + add story clustering lib (commit 5cb6c79)
- `src/lib/novelty-scorer.ts`: `enrichEntities` is now pure — localStorage I/O (edge history, baselines) moved to callers via `loadAnalysisStores()` and the new `useEnrichedEntities` hook. Novelty scoring is deterministic and testable.
- `src/lib/story-cluster.ts` (new): groups near-duplicate stories across the 106 sources by stopword-stripped sorted-token title signature (`titleSignature()`) within a 48h window (`clusterItems()`) — the first cross-source dedup primitive, later reused directly by the Postgres ingest writer.
- 25 new tests (novelty-scorer determinism/purity, story clustering). 149/149 passing, tsc clean.
- This entry backfills the DEVLOG gap for a commit that merged without a log entry; no behavioral changes beyond what the commit message describes.

## 2026-04-22 — Tier 1 feed expansion (+33 RSS sources, ids 183–215)
- `src/lib/sources-data.json`: appended 33 entries promoting tracker "available" candidates to live — US broadcast (ABC/CBS/NBC/MSNBC/Politico EU/Atlantic/Vox), European press (BBC Mundo, Die Zeit, Bild, Corriere, Repubblica, NOS, SVT, TVN24, Kathimerini, BBC Turkish), Asia/ME (Oman Observer, Island Times), Tech/Security (ZDNet, Engadget, Fast Company, Ransomware.live, AWS Status, Azure Status), Finance/Crypto (The Block, Decrypt, Blockworks, Investing.com, MarketWatch), Commodities (Mining.com, Rigzone), UK MOD (Atom). RSS/Atom count 75 → 108.
- All Google News-proxied entries follow the existing `https://news.google.com/rss/search?q=site:DOMAIN&hl=...&gl=...&ceid=...:...` pattern. AWS/Azure/UK MOD use direct feeds. Ransomware.live was marked "direct" in the tracker but direct-URL form was unverified, so it uses Google News (safer and pattern-consistent).
- `FEED_TRACKER.md`: added "2026-04-22 Tier 1 Batch" Active section; collapsed the six "Available — Not Yet Added" subsections (tracker was stale — ~15 of its "available" rows were already in sources-data.json from prior batches). Those stale rows were removed rather than re-promoted.
- No code changes. 124 tests pass. `Dashboard Sources.csv` deliberately left unchanged — it was already ~35 entries behind the JSON and is treated as an ornamental ambition doc; FEED_TRACKER.md is the working status record.
- Gotcha: there is no CSV→JSON regeneration script. `sources-data.json` is authoritative; `Dashboard Sources.csv` is not consumed at runtime.

## 2026-04-11 — Resolve AUDIT-3 violations (V3-1 through V3-4 + borderline)
- `src/lib/novelty-scorer.ts`: decomposed `enrichEntities` (128 lines → 19-line orchestrator) into 5 pure scoring helpers (`scoreCategorySpread`, `scoreSourceDiversity`, `scoreEdgeNovelty`, `scoreBaselineSurprise`, `scoreQuietMover`) plus `buildCurrentEdges` and `enrichSingleEntity`. Module-private `CategorySpreadResult` and `ScoredReason` interfaces added for typed returns. Imported `EntityBaseline` type from `./signal-storage`. Reason ordering, state persistence, and arithmetic preserved verbatim.
- `src/lib/entity-extractor.ts`: extracted `stripTitlePrefixes(candidates)` (20 lines) from `matchPersonNames`; further extracted candidate validation into `isPlausiblePersonName(candidate, knownEntities, sourceNames)` (27 lines); hoisted inline `FILLER_WORDS` Set to module scope. `matchPersonNames` shrank from ~80 lines to 18 lines.
- `src/hooks/useSignalsTab.ts`: extracted pure `buildSignalsTheme(dark)` (13-property `SignalsTabTheme`); added exception comment on `useSignalsTab` explaining tightly-coupled state (4 source memos + mute state + snapshot refs + 4 derived memos + 4 display memos).
- `src/hooks/useDiscoveryTab.ts`: extracted pure `buildDiscoveryTheme(dark)` (9-property `DiscoveryTabTheme`); added exception comment on `useDiscoveryTab` explaining 5-state/8-memo dependency chain coupling.
- `src/hooks/useIntelTab.ts`: extracted pure `buildIntelTheme(dark)` (13-property `IntelTabTheme` extending `CardTheme`); added exception comment on `useIntelTab` explaining situation-classification pipeline coupling.
- `src/lib/image-extractor.ts`: added exception comment on `extractImageUrl` explaining linear regex-sequence structure.
- `src/hooks/useDashboardTable.ts`: added exception comment on `useDashboardTable` matching the prior DEVLOG justification (6 state + 1 effect + 2 memos + 5 handlers).
- No public signature, return type, or behavioral changes. All 124 tests pass.

## 2026-04-10 — AUDIT-3: verify fixes, fresh scan, 6 remaining violations
- All 9 prior violations confirmed fixed (AUDIT.md V1–V5, AUDIT-2.md V2-1 to V2-4)
- Fresh scan found 6 violations of 50-line function limit:
  - V3-1: 3 hooks (useSignalsTab 177 lines, useDiscoveryTab 139, useIntelTab 101) — introduced during V2-1 tab decomposition
  - V3-2: enrichEntities 128 lines in novelty-scorer.ts — AUDIT-2 miscount (reported as ~50)
  - V3-3: matchPersonNames ~80 lines in entity-extractor.ts — pre-existing, previously undetected
  - V3-4: extractImageUrl 71 lines in image-extractor.ts — pre-existing, previously undetected
- MANIFEST.md updated: added 8 missing exports (signal-storage.ts, feed-fetcher.ts), corrected cache description
- No code changes. Audit and documentation only.

## 2026-04-10 — Add fire-and-forget comment and freeze LOOKUP_MAP (V2-3, V2-4)
- `src/hooks/useSources.ts`: added comment above `fetchFeed()` in useEffect explaining why the promise is not awaited (React pattern: useEffect cannot be async; errors handled inside fetchFeed)
- `src/lib/entity-extractor.ts`: added `Object.freeze(LOOKUP_MAP)` after initialization to enforce read-only access post module load
- Comment and freeze changes only — no behavioral changes. All 124 tests pass.

## 2026-04-10 — Fix silent catch blocks in URL helpers (V2-2)
- Added `console.warn` to 3 silent catch blocks in URL parsing functions
- `sanitizeUrl` in `src/lib/feed-fetcher.ts`: logs function name, malformed URL, and error
- `getDomainFromUrl` in `src/lib/image-extractor.ts`: logs function name, malformed URL, and error
- `fallbackSourceImage` in `src/components/FeedItemImage.tsx`: logs function name, malformed URL, and error
- Empty string fallbacks unchanged — only the silence is removed
- All 124 tests pass

## 2026-04-10 — Trim useDashboardTable hook (V2-1d)
- Extracted 3 pure helper functions from `src/hooks/useDashboardTable.ts`: `matchesText`, `filterItems`, `sortItems`
- `matchesText` (8 lines): deduplicates identical text-matching pattern used for both entityFilter and searchQuery
- `filterItems` (9 lines): replaces 30-line filteredItems memo body
- `sortItems` (14 lines): replaces 15-line sortedItems memo body
- Hook function body: 112 → 74 lines (under 80-line threshold)
- 6 state variables + 1 effect + 2 memos + 5 handlers make further reduction below 50 counterproductive
- No signature, return type, or behavioral changes. All 124 tests pass.

## 2026-04-10 — Decompose buildSituations (V2-1c)
- Decomposed `buildSituations` in `src/lib/situation-builder.ts` from 219 lines to 7 functions, each under 50 lines
- Extracted `Cluster` type alias and `URGENCY_PRIORITY` module-level constant (static data, not mutable state)
- Extracted `buildItemEntityIndex` (17 lines): builds itemId→entityNames reverse index and name→entity lookup
- Extracted `findSignificantPairs` (21 lines): generates entity pair keys, filters to pairs sharing ≥2 articles
- Extracted `clusterPairs` (37 lines): greedy merge at >50% article overlap
- Extracted `collectClusterArticles` (48 lines): builds SituationArticle[], tracks sources/categories/time bounds
- Extracted `aggregateEntityMetrics` (44 lines): computes max novelty, urgency, sentiment sum, deduplicated top-3 reasons
- Extracted `computeTempo` (22 lines): determines tempo from mention velocity (new/accelerating/fading/steady)
- Extracted `situationTitle` (13 lines): picks latest article title or top-2 entity names
- `buildSituations` is now a 45-line orchestrator
- No signature, return type, or behavioral changes. All 124 tests pass.

## 2026-04-10 — Decompose extractEntities (V2-1b)
- Decomposed `extractEntities` in `src/lib/entity-extractor.ts` from 173 lines to 5 functions, each under 50 lines
- Extracted `EntityAccumulator` and `TimeThresholds` interfaces to replace inline anonymous types
- Extracted `collectSourceNames` (11 lines): gathers lowercased source names and fragments for person-name filtering
- Extracted `accumulateEntityMatch` (38 lines): unified upsert for dict and person matches (eliminated 29-line duplication)
- Extracted `computeCooccurrences` (19 lines): builds bidirectional co-occurrence map from per-item entity sets
- Extracted `buildEntityResults` (34 lines): filters to 2+ mentions, attaches top-5 co-occurrences, computes average sentiment, sorts
- `extractEntities` is now a 47-line orchestrator
- No signature, return type, or behavioral changes. All 124 tests pass.

## 2026-04-10 — Decompose doFetchSingleFeed (V2-1a)
- Decomposed `doFetchSingleFeed` in `src/lib/feed-fetcher.ts` from 136 lines to 4 functions, each under 50 lines
- Introduced `PhaseOutcome` discriminated union type for phase function returns
- Extracted `fetchDirect` (41 lines): direct fetch with 5s timeout, retry on 5xx/timeout
- Extracted `fetchViaRelay` (31 lines): relay proxy fallback with 10s timeout, XML content sniff
- Extracted `fetchFromAltUrl` (22 lines): altUrl fallback with 5s timeout
- `doFetchSingleFeed` is now a 42-line orchestrator: tries phases in sequence, accumulates errors, builds diagnostics
- `httpStatus` guard (`!== undefined`) prevents network errors from overwriting prior HTTP status values
- No signature, return type, or behavioral changes. All 124 tests pass.

## 2026-04-10 — Decompose IntelTab.tsx (Audit Violation #2 — final)
- Extracted all state, memos, and callbacks into `src/hooks/useIntelTab.ts`
- Moved helper functions (`timeAgo`, `reasonBadgeClasses`, `reasonTypeLabel`) and constants (`URGENCY_DOT_COLORS`, `TEMPO_STYLES`, `CardTheme`) to `src/components/intel/utils.ts`
- Created 5 sub-components in `src/components/intel/`: `IntelSummary`, `KnownSituationsSection`, `NovelSection`, `SituationCard`, `EntityCard`
- Barrel export at `src/components/intel/index.ts`
- `IntelTab.tsx`: 481 → 65 lines (main component is a thin composition shell)
- `IntelTabTheme extends CardTheme` — section components get full theme, card components keep narrow `CardTheme` typing
- Removed dead import (`getThemeClasses`) from original file
- Same pattern as DashboardTable, SignalsTab, and DiscoveryTab decompositions (hook + sub-components + barrel)
- All 4 audit violation #2 components now decomposed. No behavioral or visual changes. All 124 tests pass.

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
