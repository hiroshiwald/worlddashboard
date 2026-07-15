## Modules

| Name | Purpose | Key Exports |
|------|---------|-------------|
| `src/app/api/sources/route.ts` | API endpoint that orchestrates feed fetching and returns aggregated items | `GET` handler |
| `src/app/api/ingest/route.ts` | Fetches all feeds, persists to Postgres, sweeps retention, runs entity extraction, detects and persists signals. Auth via `x-ingest-key` or `Authorization: Bearer` (`CRON_SECRET`) | `POST`, `GET` handlers |
| `src/app/api/articles/route.ts` | DB-backed read path — cluster heads only, `days`/`category` filters, 503 when unconfigured/empty | `GET` handler |
| `src/app/api/candidates/route.ts` | Review queue: promotable unresolved entity names, accept/merge/dismiss actions | `GET`, `POST` handlers |
| `src/app/api/entities/route.ts` | Resolves a name to a tracked/dismissed entity id by canonical_name or alias | `GET` handler |
| `src/app/api/entities/[id]/route.ts` | Entity profile + 7-day hourly mention series + last 20 articles + top 10 co-occurring entities | `GET` handler |
| `src/app/api/signals/route.ts` | Signal lifecycle: `GET` filtered by state (default new,seen,promoted), severity-ordered, entity names resolved; `POST {id, action}` transitions state (404 unknown id, 409 illegal transition). Unauthenticated (see Invariants) | `GET`, `POST` handlers |
| `src/app/api/brief/route.ts` | Bounded daily-brief payload: capped active signals, newly-tracked entities, recency-ranked top stories. Edge-cached 5min, 503 when unconfigured | `GET` handler |
| `src/lib/server/db.ts` | Thin Postgres query helper over `@neondatabase/serverless` | `getSql`, `Sql`, `SqlRow` |
| `src/lib/server/article-identity.ts` | Pure article identity hashing for de-duplication | `contentHash` |
| `src/lib/server/ingest-writer.ts` | Batched article persistence, cross-source dup-group linking, retention sweep | `persistArticles`, `sweepRetention` |
| `src/lib/server/extract-v2.ts` | Pure candidate extraction: dictionary + compromise NLP + acronym + person-regex layers, normalization | `normalizeName`, `extractCandidates`, `addCandidate`, `Candidate`, `TypeHint` |
| `src/lib/server/entity-ingest.ts` | Resolves extracted candidates against the DB registry then static dictionaries, else queues as a candidate; batches all entity/mention/edge/candidate writes. Tracks two clocks per mention — `effectiveAt` (news time: publish date) and `arrivalAt` (watch time: ingest arrival) | `processNewArticles`, `dedupeMentions`, `rollupHourlyMentions`, `rollupEntityEdges`, `rollupCandidate`, `EntityIngestStats` |
| `src/lib/server/settings.ts` | Tunable detector/brief thresholds: DB-overlaid defaults, type-validated per key | `DEFAULTS`, `getSettings`, `Settings` |
| `src/lib/server/detectors.ts` | Five pure scoring functions (rate surprise, first-seen novelty, novel entity edge, cross-category convergence, sentiment deterioration) plus the batched-query orchestrator; every candidate's evidence has a numeric score decomposition + capped articleIds. History-dependent detectors gate on a system-wide warm-up epoch | `runDetectors`, `scoreSurge`, `scoreFirstSeenNovelty`, `scoreNovelEdge`, `scoreCrossCategory`, `scoreSentimentDeterioration`, `isBootstrapCohort`, `computeWarmupState`, `computeEffectiveBaselineDays`, `CandidateSignal` |
| `src/lib/server/signal-store.ts` | Signal persistence: dismiss-cooldown-aware upsert against the active partial unique index, lifecycle transitions, the shared severity-ordered/entity-and-evidence-article-resolved query used by both signal routes | `persistSignals`, `transitionSignal`, `loadSignals`, `SignalJson`, `EvidenceArticle`, `SignalAction`, `PersistResult` |
| `src/lib/server/brief.ts` | Daily-brief assembly: pure recency-decayed story ranking plus the top-stories/new-entities queries | `getBrief`, `computeStoryScore`, `Brief`, `TopStoryJson`, `NewEntityJson` |
| `migrations/001_core.sql` | Schema v1: articles, entities, article_entities, entity_mentions_hourly, entity_edges, entity_candidates, signals, settings | — |
| `migrations/002_entity_indexes.sql` | `article_entities_entity_idx` (entity_id-first index for entity→articles lookups), `articles.entities_processed_at` (idempotent entity-pass marker column, replaces a `NOT EXISTS(article_entities)` gate), `entity_edges_entity_b_idx` (entity_b-first index for entity→edges lookups) — not yet run against the production database | — |
| `migrations/003_time_semantics_repair.sql` | One-time data repair for the news-time/watch-time conflation: recomputes `entities.first_seen_at`/`last_seen_at` from `MIN`/`MAX(articles.first_seen_at)` via `article_entities`; clamps `entity_edges.first_seen_at`/`last_seen_at` up to `MIN(articles.first_seen_at)`; `DELETE FROM signals` (every pre-fix row is an artifact of the miscalibrated engine). No-ops on an empty database — not yet run against the production database | — |
| `scripts/migrate.mjs` | Idempotent migration runner (`schema_migrations` ledger) | — |
| `src/app/page.tsx` | Home page — renders the main dashboard | `Home` component |
| `src/app/layout.tsx` | Root HTML layout with metadata and font loading | `RootLayout` component |
| `src/app/globals.css` | Tailwind directives and dark-scrollbar styles | — |
| `src/components/DashboardTable.tsx` | Thin composition shell: imports hook + sub-components, composes layout. Live-feed loading/empty states are gated to items-dependent tabs only (excludes Brief/Review, which are DB-backed) | `DashboardTable` |
| `src/components/dashboard/EntityFilterBanner.tsx` | Entity filter notification bar with clear controls | `EntityFilterBanner` |
| `src/components/dashboard/FeedTable.tsx` | Desktop sortable table with header and row sub-components | `FeedTable` |
| `src/components/dashboard/FeedCardList.tsx` | Mobile responsive card layout for feed items | `FeedCardList` |
| `src/components/dashboard/TabContent.tsx` | Lazy-loaded tab switcher for Brief, Intel, Signals, Network, Map, Discovery, Review | `TabContent` |
| `src/components/dashboard/index.ts` | Barrel export for dashboard sub-components | — |
| `src/components/HeaderBar.tsx` | Top navigation with search, category filter, theme toggle, tab switcher (Brief first, incl. Review's pending-count badge), ingest-mode badge | `HeaderBar` |
| `src/components/BriefTab.tsx` | Thin composition shell: imports hook + sub-components, composes layout — the default landing tab | `BriefTab` |
| `src/components/brief/BriefSignalsSection.tsx` | Active signals grouped by severity, using the shared `ManagedSignalCard` (Seen/Promote/Dismiss actions) | `BriefSignalsSection` |
| `src/components/brief/BriefNewEntitiesSection.tsx` | Chip row of newly-tracked entities with source counts | `BriefNewEntitiesSection` |
| `src/components/brief/BriefTopStoriesSection.tsx` | Ranked top-stories list: headline link, cluster size, source count, age | `BriefTopStoriesSection` |
| `src/components/brief/index.ts` | Barrel export for brief sub-components | — |
| `src/components/ReviewTab.tsx` | Entity candidate review queue: counts, source chips, sample titles, Accept/Merge/Dismiss actions | `ReviewTab` |
| `src/components/EntityPanel.tsx` | Slide-over entity timeline: profile, inline-SVG hourly sparkline, recent articles, related-entity chips | `EntityPanel` |
| `src/components/IntelTab.tsx` | Thin composition shell: imports hook + sub-components, composes layout | `IntelTab` |
| `src/components/intel/IntelSummary.tsx` | Summary bar with entity/situation counts and low-data warning | `IntelSummary` |
| `src/components/intel/KnownSituationsSection.tsx` | Expandable row strip for known situations with article drill-down | `KnownSituationsSection` |
| `src/components/intel/NovelSection.tsx` | Card grid for emerging situations and standalone novel entities | `NovelSection` |
| `src/components/intel/SituationCard.tsx` | Single situation card with novelty score, entity chips, and latest article | `SituationCard` |
| `src/components/intel/EntityCard.tsx` | Single entity card with novelty score and reason badge | `EntityCard` |
| `src/components/intel/utils.ts` | Shared helpers and constants: timeAgo, reasonBadgeClasses, URGENCY_DOT_COLORS, TEMPO_STYLES | `timeAgo`, `reasonBadgeClasses`, `reasonTypeLabel`, `CardTheme` |
| `src/components/intel/index.ts` | Barrel export for intel sub-components | — |
| `src/components/SignalsTab.tsx` | Thin composition shell: imports hook + sub-components, composes layout — the signal **manager** (all states, client-side state filter) | `SignalsTab` |
| `src/components/signals/types.ts` | Shared client-side DTO shape for a signal row (mirrors `SignalJson`) and the lifecycle action union | `SignalCardData`, `SignalAction` |
| `src/components/signals/ManagedSignalCard.tsx` | Signal card with header, confidence bar, evidence expander (article links), entity chips, and a caller-supplied action button list — shared by BriefTab and SignalsTab | `ManagedSignalCard` |
| `src/components/signals/ManagedSignalGrid.tsx` | Grid of `ManagedSignalCard`s with per-state action sets (`reopen` only for dismissed) and an empty state | `ManagedSignalGrid` |
| `src/components/signals/StateFilterBar.tsx` | Client-side state filter buttons (All/New/Seen/Dismissed/Promoted) with live counts | `StateFilterBar` |
| `src/components/signals/WatchlistCard.tsx` | Entity sparkline card with sentiment badge and mention stats | `WatchlistCard` |
| `src/components/signals/WatchlistSection.tsx` | Watchlist header and card grid for top entities | `WatchlistSection` |
| `src/components/signals/utils.tsx` | Shared helpers: severityColor, timeAgo, SentimentBadge | `severityColor`, `timeAgo`, `SentimentBadge` |
| `src/components/signals/index.ts` | Barrel export for signals sub-components | — |
| `src/components/NetworkTab.tsx` | Force-directed graph of entity co-occurrences | `NetworkTab` |
| `src/components/MapTab.tsx` | Leaflet geospatial map with entity markers | `MapTab` |
| `src/components/DiscoveryTab.tsx` | Thin composition shell: imports hook + sub-components, composes layout | `DiscoveryTab` |
| `src/components/discovery/DiscoveryControls.tsx` | Edge mode toggle, entity type filter, min mentions slider | `DiscoveryControls` |
| `src/components/discovery/ScatterPlot.tsx` | 2D scatter plot with SVG edges, entity dots, and hover tooltip | `ScatterPlot` |
| `src/components/discovery/DiscoveryLegend.tsx` | Color legend for novelty types | `DiscoveryLegend` |
| `src/components/discovery/utils.ts` | Shared constants and helpers: TYPE_DOT_COLORS, getDotColor | `TYPE_DOT_COLORS`, `getDotColor` |
| `src/components/discovery/index.ts` | Barrel export for discovery sub-components | — |
| `src/components/FeedItemImage.tsx` | Image component with Google favicon and text-initial fallbacks | `FeedItemImage` |
| `src/hooks/useDashboardTable.ts` | Custom hook: all DashboardTable state, memos, effects, handlers. Default `activeTab` is `"brief"`. `handleEntityClick` resolves a name to an entity id (opens `EntityPanel`) before falling back to the text filter; tracks `candidateCount` for the Review tab badge | `useDashboardTable`, `TabKey`, `ColumnKey` |
| `src/hooks/useBusyIds.ts` | Per-id "in flight" tracking (a `Set`, not a single shared id) so one action's controls don't get wrongly re-enabled by an unrelated concurrent action | `useBusyIds` |
| `src/hooks/useBriefTab.ts` | Fetches/refreshes `/api/brief`, dispatches signal actions (POST-then-refresh) via `useBusyIds`, sequence-guards `load()` against out-of-order responses, distinguishes DB-not-configured from a fetch error | `useBriefTab`, `BriefData`, `BriefSignal`, `BriefNewEntity`, `BriefTopStory` |
| `src/hooks/useSignalsTab.ts` | Custom hook: watchlist memos (unchanged from before) plus the signal-manager fetch/action/state-filter state (via `useBusyIds` + a sequence-guarded `load()`), theme | `useSignalsTab`, `SignalsTabTheme`, `StateFilter`, `STATE_FILTERS` |
| `src/hooks/useDiscoveryTab.ts` | Custom hook: all DiscoveryTab state, memos, callbacks, theme | `useDiscoveryTab`, `EdgeMode`, `EdgeData`, `DiscoveryTabTheme` |
| `src/hooks/useIntelTab.ts` | Custom hook: all IntelTab state, memos, callbacks, theme | `useIntelTab`, `IntelTabTheme` |
| `src/hooks/useSources.ts` | React hook for fetching feed data: tries DB-backed `/api/articles` first, falls back to live `/api/sources` | `useFeed` |
| `src/lib/types.ts` | All shared TypeScript interfaces | `FeedItem`, `SourceMeta`, `ExtractedEntity`, `EnrichedEntity`, `Signal`, `Situation`, `UrgencyLevel`, `SortConfig`, etc. |
| `src/lib/feed-fetcher.ts` | RSS/Atom fetching with 3-phase fallback (direct → relay → altUrl), parsing, and caller-owned cache | `fetchAllFeeds`, `parseFeedXml`, `parseRssItems`, `parseAtomEntries`, `CacheEntry` |
| `src/lib/entity-extractor.ts` | Dictionary-based NER from feed text with a hand-rolled lexicon sentiment scorer | `extractEntities`, `matchDictionaryEntries`, `isDictionaryTerm`, `scoreSentiment`, `LookupEntry` |
| `src/lib/entity-dictionaries.ts` | Country, org, region dictionaries and person stopwords | `COUNTRY_DICT`, `ORG_DICT`, `REGION_DICT`, `PERSON_STOPWORDS` |
| `src/lib/novelty-scorer.ts` | Five-dimension novelty scoring (0–100) and known-situation detection | `enrichEntities`, `isKnownSituation` |
| `src/lib/situation-builder.ts` | Greedy clustering of entity pairs sharing articles into situations | `buildSituations` |
| `src/lib/cascade-graph.ts` | Static causal graph across 12 impact domains with BFS chain builder | `buildCascadeChain`, `CascadeChain`, `CascadeDomain` |
| `src/lib/ad-filter.ts` | Ad and sponsored content detection with 50+ title patterns and URL/description filters | `isAdContent`, `isFinancialAd` |
| `src/lib/image-extractor.ts` | Six-method image URL extraction from RSS/Atom XML | `extractImageUrl`, `getSourceImageUrl`, `getDomainFromUrl` |
| `src/lib/xml-helpers.ts` | HTML stripping, XML tag/attribute extraction | `stripHtml`, `extractTag`, `extractAttr` |
| `src/lib/signal-storage.ts` | localStorage persistence for edge history, entity snapshots, baselines (muting removed — superseded by server-side dismiss; `loadPreviousEntityNames`/`saveEntitySnapshot`/`SNAPSHOT_INTERVAL` are currently unused now that the client detector they fed is gone, kept per explicit task scope) | `SNAPSHOT_INTERVAL`, `loadPreviousEntityNames`, `saveEntitySnapshot`, `edgeKey`, `loadEdgeHistory`, `saveEdgeHistory`, `loadEntityBaselines`, `updateEntityBaselines`, `getBaselineRate`, `EntityBaseline` |
| `src/lib/geo-coordinates.ts` | Lookup map of 100+ countries/regions to [lat, lng] centroids | `getCoordinates` |
| `src/lib/date-utils.ts` | Relative and absolute date formatting | `timeAgo`, `formatDate` |
| `src/lib/urgency.ts` | Deterministic category-to-urgency mapping and Tailwind styling | `getUrgencyLevel`, `getRowClasses`, `getUrgencyBadgeClasses` |
| `src/lib/theme.ts` | Dark/light theme class generation | `getThemeClasses`, `ThemeClasses` |
| `src/lib/sources-data.json` | Static list of ~147 RSS/Atom feed sources with name, category, tier, url, type | — |
| `src/lib/__tests__/ad-filter.test.ts` | Tests for ad/sponsored content detection | — |
| `src/lib/__tests__/xml-helpers.test.ts` | Tests for HTML stripping and XML extraction | — |
| `src/lib/__tests__/image-extractor.test.ts` | Tests for image URL extraction from XML | — |
| `src/lib/__tests__/urgency.test.ts` | Tests for category-to-urgency mapping and styling | — |
| `src/lib/__tests__/date-utils.test.ts` | Tests for timeAgo and formatDate | — |
| `src/lib/__tests__/feed-parser.test.ts` | Tests for RSS 2.0 and Atom parsing | — |
| `src/lib/__tests__/entity-extractor.test.ts` | Tests for entity extraction, co-occurrence, sentiment | — |
| `src/lib/server/__tests__/article-identity.test.ts` | Tests for contentHash stability, normalization, distinctness | — |
| `src/lib/server/__tests__/ingest-writer.test.ts` | Tests for persistArticles (dup-group linking, batching) and sweepRetention (mocked sql client) | — |
| `src/lib/server/__tests__/extract-v2.test.ts` | Tests for normalizeName and each extractCandidates layer, dedup tie-break, U.K./Great Britain dictionary resolution, AI acronym-stoplist suppression | — |
| `src/lib/server/__tests__/entity-ingest.test.ts` | Tests for resolution order, rollup math (hourly/edges/candidates), mention dedup, idempotency query shape (mocked sql client); hourly bucketing keys on effectiveAt-only, edges key on arrivalAt-only | — |
| `src/lib/server/__tests__/settings.test.ts` | Tests for DEFAULTS overlay, type-validation fallback per key (mocked sql client) | — |
| `src/lib/server/__tests__/detectors.test.ts` | Tests for each scoring function on synthetic panels (flat/no-surge, 10x-spike/critical, cold-start skip, severity boundaries, recalibrated first-seen/novel-edge tables), bootstrap-cohort suppression, `computeWarmupState` boundary, `computeEffectiveBaselineDays` λ math, tracked/cluster-head query shape (mocked sql client) | — |
| `src/lib/server/__tests__/signal-store.test.ts` | Tests for cooldown suppression, created/refreshed counting, transition legality matrix, severity ordering, evidence-article resolution (mocked sql client) | — |
| `src/lib/server/__tests__/brief.test.ts` | Hand-checked tests for computeStoryScore's ranking formula | — |
| `src/lib/server/__tests__/helpers/pg-sql.ts` | Test-only `Sql` adapter over a real `pg` `Pool` (no Neon proxy dependency) plus a from-scratch migration applier, for integration tests | `makePgSql`, `applyMigrations`, `freshSchema` |
| `src/lib/server/__tests__/integration/env-canary.test.ts` | Ungated: fails loudly if `CI` is set but `TEST_DATABASE_URL` is not, so the integration layer can't silently skip in CI | — |
| `src/lib/server/__tests__/integration/ingest-writer.integration.test.ts` | Real-Postgres tests for `persistArticles` (exact-duplicate/dateless/cross-source dup-group linking, recurring-headline head rotation across a 48h window) and `sweepRetention` (30-day delete, `ON DELETE SET NULL` on a dup-group head) | — |
| `src/lib/server/__tests__/integration/entity-ingest.integration.test.ts` | Real-Postgres tests for `processNewArticles` (dictionary entity creation, cluster-head-only mentions, hourly/edge/candidate rollups, idempotent re-run, `last_seen_at` advancement on ARRIVAL even with a backdated `published_at`, SQL-level candidate accept flow) | — |
| `src/lib/server/__tests__/integration/signal-engine.integration.test.ts` | Real-Postgres tests for the full signal pipeline: `runDetectors`+`persistSignals` producing a correct surge row, re-run refreshing (not duplicating) under the partial unique index, dismiss-cooldown suppression, the transition state machine, `loadSignals`'s entity-name and evidence-article resolution, `getBrief`'s ranked top stories. Seeds an old (30-day) system-epoch article in `beforeEach` so these tests, which mostly never touch `articles`, aren't wrongly warm-up-gated | — |
| `src/lib/server/__tests__/integration/warmup-gate.integration.test.ts` | Real-Postgres tests for the warm-up gate: a day-1-launch scenario (articles arriving within 24h, `published_at` spread across the prior week) yields zero surge/first_seen/novel_edge while cross_category still fires; an old (9-day) system epoch lets first_seen fire at warning (not critical) for 3 sources and a 10x spike fires surge with a sane z (< 15σ) | — |
| `src/app/api/candidates/__tests__/route.test.ts` | Tests for GET filtering/shaping and POST accept/merge/dismiss incl. validation and conflict 409s | — |
| `src/app/api/entities/__tests__/route.test.ts` | Tests for name/alias resolution and deterministic ordering | — |
| `src/app/api/entities/[id]/__tests__/route.test.ts` | Tests for entity profile + series/articles/edges query shape | — |
| `src/app/api/signals/__tests__/route.test.ts` | Tests for state-csv parsing/defaulting, action validation, 404/409 semantics, legal transition wiring | — |
| `src/app/api/brief/__tests__/route.test.ts` | Tests for 503-when-unconfigured and the response shape + cache header | — |

## Invariants

- **7-day item window**: Feed items older than 7 days are discarded at fetch time. No stale data enters the pipeline.
- **Dateless item published_at**: feed items with no parseable date get `publishedEstimated: true` on the `FeedItem` plus a `now()`-stamped `published` for client display; `persistArticles` stores `published_at = NULL` for these rows in Postgres instead of the stamp.
- **15 items per source**: Each feed is capped to prevent any single source from dominating.
- **Deterministic urgency**: Urgency level is a pure function of source category — no mutable state, no runtime overrides.
- **Canonical entity names**: Dictionary-based extraction resolves aliases to canonical forms (e.g., "USA" → "United States"). Case-insensitive, word-boundary matching, longest-match-first.
- **Bidirectional co-occurrences**: Entity pairs are stored as sorted tuples — no duplicates, order-independent.
- **Novelty score range**: Composite score is 0–100 across five dimensions; no single dimension can exceed its cap (spread: 30, diversity: 15, edges: 25, surprise: 20, emergence: 10).
- **Situation clustering threshold**: Entity pairs must share ≥2 articles to form a cluster; clusters merge only at >50% article overlap.
- **Single Neon Postgres, written by `/api/ingest`, `/api/candidates` POST, and `/api/signals` POST**: server-side persistence (articles, entities, mentions, edges, candidates, signals) lives in one Neon Postgres database. `/api/ingest` (hourly GitHub Actions cron + daily Vercel cron fallback) is the only writer for the article/entity/signal pipeline; `/api/candidates` POST and `/api/signals` POST are the two other writers (reviewer/user-triggered, both unauthenticated by design — single-user hobby app, no login exists anywhere in the system). `/api/articles`, `/api/entities`, `/api/entities/[id]`, `/api/candidates` GET, `/api/signals` GET, and `/api/brief` are read-only. Client-side ephemera (edge history, entity snapshots, baselines, theme) still lives in browser localStorage.
- **Signal lifecycle**: a signal row's `state` moves `new` → (`seen` | `dismissed` | `promoted`) any number of times among the three active states, and `dismissed` → `new` only via an explicit `reopen` — no other transition out of `dismissed` is legal. `signals_dedupe_key_active_idx` is a partial unique index on `dedupe_key` covering only the active states (`new`, `seen`, `promoted`); a dismissed row is deliberately excluded from that constraint so a fresh detection can create a brand-new active row for the same `dedupe_key` once `persistSignals`'s dismiss-cooldown window (`settings.dismiss_cooldown_hours`, default 72h) has elapsed. Re-detection never touches `state` — only `last_evidence_at`/`confidence`/`severity`/`evidence`/`title` are refreshed on an existing active row. `transitionSignal` is a single conditional `UPDATE ... WHERE id = $1 AND state = $2 RETURNING id` (state doubles as the compare-and-swap guard) rather than a separate read-then-write, so two concurrent transitions on the same id can't race — the loser's zero-row result is indistinguishable from an unknown id or an already-illegal transition, which is exactly the boolean contract the API route expects.
- **Brief tab is the default landing view**: `useDashboardTable`'s `activeTab` starts at `"brief"` (was `"feeds"`); every other tab, including Feeds, remains one click away and behaviorally unchanged.
- **Dup-group retention safety**: `articles.dup_group_id` FK is `ON DELETE SET NULL` — `sweepRetention`'s 30-day delete on a dup-group head is never blocked by newer member rows (up to 48h younger) still referencing it.
- **Entity resolution order**: DB registry (canonical_name or any alias, normalized, all statuses including dismissed) → static dictionaries (creates the entity row on first hit) → otherwise accumulates into `entity_candidates`. Dismissed entities still resolve and get mentions recorded (so they never re-surface as candidates) but are excluded from every user-facing list.
- **Entity-pass idempotency**: `processNewArticles` selects cluster heads from the last 6h whose `articles.entities_processed_at` is `NULL` — an explicit marker set as the last statement of a successful run, not a `NOT EXISTS(article_entities)` check (an article whose extracted names are all unresolved candidates never gets an `article_entities` row, so `NOT EXISTS` would keep re-selecting — and re-accumulating into `entity_candidates` — for that article's whole 6h lookback window). Re-runs and catch-up runs self-heal: a crash between the aggregate writes and the marker `UPDATE` leaves that batch unmarked, so it retries next run (additive rollups double-count for that one batch — rare and bounded, preferred over silently dropping the batch).
- **One mention per article per entity**: `dedupeMentions` collapses two resolved mentions of the same entity from one article (possible when two of its aliases both appear in the text) before `article_entities`/`entity_mentions_hourly`/`entity_edges` are written, so a single article can't double-count itself into an hourly bucket's mentions/sentiment_sum.
- **Detector scope and bootstrap guard**: every detector query is scoped to `entities.status = 'tracked'` and cluster-head articles (`dup_group_id IS NULL`) only. First-seen novelty and novel-edge detection both suppress candidates within 72h of the global `MIN(first_seen_at)` across all tracked entities/edges respectively, so the one-time initial dictionary-import cohort never floods the signal queue; the same guard is reused by `/api/brief`'s `newEntities`. Rate surprise is skipped (cold start, not "no surprise") for any entity with under 3 days of baseline history in the trailing-14-day-excluding-last-24h window.
- **News time vs. watch time, and the system warm-up gate**: NEWS TIME (`published_at`, when an article was written) and WATCH TIME (`articles.first_seen_at`, when this platform first observed it) are different clocks. Feed pre-loads backfill ~7 days of publish-dated articles on day one, so anything keyed on news time looks like it has a week of history immediately. `entities`/`entity_edges` `first_seen_at`/`last_seen_at` are watch time (`arrivalAt` in `entity-ingest.ts`) — `entity_mentions_hourly` buckets and `entity_candidates` timing deliberately stay on news time (`effectiveAt`), since publish-date spread is the correct shape for trend charts and legitimate recurrence evidence respectively. `detectors.ts`'s `getSystemEpoch` (`MIN(articles.first_seen_at)`, unscoped by `dup_group_id`) anchors a system-wide warm-up gate (`settings.warmup_days`, default 7): `surge`, `first_seen`, and `novel_edge` — the three history-dependent detectors — stay silent until `warmup_days` have really elapsed since the system's first observed article, independent of and in addition to the 72h bootstrap guard above (which alone isn't sufficient once entity `first_seen_at` reflects arrival: a fresh entity's arrival is always "recent," so the bootstrap guard's own anchor is equally fresh). `cross_category` and `sentiment` have no history dependence and keep running through warm-up. The surge baseline's daily rate divides by `computeEffectiveBaselineDays` (real elapsed operating days, clamped to `[1, 14]`), not a fixed 14-day divisor — the fixed divisor understated λ for a system that hadn't actually been running that long.
- **Candidate promotion rule**: the Review queue shows only candidates with ≥3 distinct sources, ≥2 distinct days, last seen within 14 days.
- **entity_edges pair ordering**: always stored as `entity_a < entity_b` (by id) — enforced by a DB CHECK and by `rollupEntityEdges` sorting ids before pairing.
- **Edge history retention**: 30-day window; entries older than 30 days are pruned on save.
- **Entity snapshot window**: 2-hour retention for emergence detection.
- **Fetch timeout**: 5 seconds per phase. Direct phase allows 1 retry on 5xx. Total worst-case per source: ~20s across all phases.
- **Cache layers**: In-memory feed cache (5min fresh / 30min stale) → CDN (60s fresh / 300s stale-while-revalidate) → browser (no-store). Next.js Data Cache is force-disabled.
- **Ad filtering order**: URL patterns → title regex (50+ patterns) → financial ad regex (dateless feeds only). Applied before items enter the pipeline.
- **CI test gate**: `.github/workflows/test.yml` runs on every PR and every push to `main` — `tsc --noEmit`, the full `vitest` suite (unit + integration) against a real Postgres 16 service container, then `npm run build`. Nothing merges without all three passing.
- **Integration-test layer**: `src/lib/server/__tests__/integration/*.test.ts` exercises `persistArticles`, `sweepRetention`, `processNewArticles`, and the full signal engine (`runDetectors`/`persistSignals`/`transitionSignal`/`loadSignals`/`getBrief`) against a real Postgres (via `pg`, not `@neondatabase/serverless` — the Neon HTTP driver requires Neon's proxy and cannot reach a plain Postgres), gated by `describe.skipIf(!process.env.TEST_DATABASE_URL)` so the suite skips cleanly with no database configured (this sandbox, teammate laptops) and runs for real in CI. An ungated canary test fails loudly if `CI` is set without `TEST_DATABASE_URL`, so a misconfigured CI env can't silently skip the whole layer while staying green. Each integration test file owns its own named Postgres schema (set via the pool's `search_path` option, torn down and reapplied from the real `migrations/*.sql` files before every test) rather than sharing `public` — vitest runs test files concurrently against the one shared `TEST_DATABASE_URL`, so schema-per-file avoids one file's drop/recreate racing another's mid-test.

## Boundaries

**Browser → Server**
- `useFeed` hook fetches `GET /api/articles` (DB-backed) first; on a 503, network error, or malformed response it falls back to `GET /api/sources` (live), both with `cache: 'no-store'`
- Response includes `items[]`; the live path also includes feed diagnostics and metadata, the DB path includes `lastIngestAt`
- `useDashboardTable`'s `handleEntityClick` fetches `GET /api/entities?name=`; on a hit it opens `EntityPanel` (which then fetches `GET /api/entities/[id]`); on 404/malformed/network failure it warns and falls back to the text filter
- `ReviewTab` fetches `GET /api/candidates` on mount and after every action; `POST /api/candidates` for accept/merge/dismiss
- `useDashboardTable` fetches `GET /api/candidates` once on mount for the header badge count; `ReviewTab` syncs it after each action via a callback (no extra fetch)
- `useBriefTab` fetches `GET /api/brief` on mount; `POST /api/signals` for the Seen/Promote/Dismiss card actions, then re-fetches the brief
- `useSignalsTab` fetches `GET /api/signals?state=new,seen,dismissed,promoted` on mount (all states, filtered client-side); `POST /api/signals` for Seen/Promote/Dismiss/Reopen, then re-fetches

**Server → External Feeds**
- `fetchAllFeeds` hits ~147 RSS/Atom sources in parallel — called from `/api/sources` (live reads) and `/api/ingest` (hourly/daily writes)
- 3-phase fallback per source: direct fetch → `RELAY_URL` proxy → `altUrl`
- Optional `RELAY_SECRET` header for relay authentication
- All fetches use `cache: 'no-store'` to bypass Next.js Data Cache

**Server → Postgres**
- `/api/ingest` (hourly GitHub Actions cron + daily Vercel cron fallback) is the only writer for articles/entities/signals: fetches all feeds, `persistArticles` (batched insert + dup-group linking), `sweepRetention`, `processNewArticles` (entity resolution + rollup writes), then `getSettings` → `runDetectors` → `persistSignals` (detect-and-persist signals) as the final stage
- `/api/candidates` POST and `/api/signals` POST are the two other writers: accept/merge/dismiss (ending in a delete from `entity_candidates`) and signal state transitions respectively
- `/api/articles` reads cluster heads (`dup_group_id IS NULL`) from the last N days, capped at 500
- `/api/entities` resolves a name to an entity id; `/api/entities/[id]` reads that entity's profile, hourly series, articles, and edges
- `/api/candidates` GET reads promotable candidates
- `/api/signals` GET reads signals in the requested states via `loadSignals` (shared with `/api/brief`); `/api/brief` reads active signals (capped at `settings.brief_max_blocks`), new entities, and ranked top stories via `getBrief`
- `scripts/migrate.mjs` (manual, owner-run) applies `migrations/*.sql` against `DATABASE_URL`
- All access goes through `getSql()` (`src/lib/server/db.ts`) — no module-level client, no shared connection state

**Server → CDN**
- Vercel Edge caches API responses (`s-maxage=60, stale-while-revalidate=300`); `/api/brief` uses its own `s-maxage=300, stale-while-revalidate=600`

**Client → External Services**
- Google Favicons API (`google.com/s2/favicons`) for fallback article images
- CARTO tile CDN (`basemaps.cartocdn.com`) for Leaflet map layers
- Google Fonts CDN for Inter typeface

**Client → localStorage**
- `signal-storage.ts` reads/writes: edge history, entity snapshots, entity baselines (muted entities removed — superseded by server-side dismiss)
- Theme preference stored as `wd-theme`; a one-time `useSignalsTab` effect removes the now-obsolete `wd-muted-entities` key

**Internal Module Dependencies**
- `DashboardTable` → `useDashboardTable` + `HeaderBar` + `EntityPanel` + dashboard sub-components
- `useDashboardTable` → `useFeed` + `theme` + `/api/entities` (name resolution) + `/api/candidates` (badge count)
- `TabContent` → all tab components (dynamic imports) + `BriefTab` + `ReviewTab`
- `BriefTab` → `useBriefTab` + brief sub-components (`ManagedSignalCard` from `signals/`)
- `SignalsTab` → `useSignalsTab` + signals sub-components (`StateFilterBar`, `ManagedSignalGrid` → `ManagedSignalCard`, `WatchlistSection`)
- `ReviewTab` → `/api/candidates` (GET/POST)
- `EntityPanel` → `/api/entities/[id]`
- `/api/ingest` → `entity-ingest` (`processNewArticles`) after `ingest-writer`, then `settings` (`getSettings`) → `detectors` (`runDetectors`) → `signal-store` (`persistSignals`)
- `entity-ingest` → `extract-v2` + `entity-extractor` (`scoreSentiment`)
- `detectors` → `settings` (`Settings` type)
- `signal-store` → `detectors` (`CandidateSignal` type) + `settings` (`Settings` type)
- `brief` → `signal-store` (`loadSignals`) + `settings` (`Settings` type)
- `/api/signals`, `/api/brief` → `signal-store` (+ `brief` for the latter)
- `extract-v2` → `entity-extractor` (`matchDictionaryEntries`, `isDictionaryTerm`) + `entity-dictionaries` (`PERSON_STOPWORDS`) + `compromise`
- `/api/entities`, `/api/entities/[id]` → `extract-v2` (`normalizeName`)
- `FeedTable` / `FeedCardList` → `FeedItemImage` + `urgency` + `date-utils`
- All analysis tabs → `entity-extractor` → `entity-dictionaries` + `urgency`
- `useSignalsTab` → `entity-extractor` + `novelty-scorer` + `signal-storage` (watchlist) + `/api/signals` (manager)
- `DiscoveryTab` → `useDiscoveryTab` + discovery sub-components
- `useDiscoveryTab` → `entity-extractor` + `novelty-scorer` + `signal-storage`
- `IntelTab` → `useIntelTab` + intel sub-components
- `useIntelTab` → `entity-extractor` + `novelty-scorer` + `situation-builder`
- `MapTab` → `geo-coordinates` + `react-leaflet`
- `NetworkTab` → `react-force-graph-2d`
- `feed-fetcher` → `ad-filter` + `xml-helpers` + `image-extractor`
