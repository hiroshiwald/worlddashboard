# World Dashboard Development Log

## 2026-07-15 — Calibration fix-pack: news-time/watch-time conflation in the signal engine

The signal engine shipped and immediately produced 140 signals, all
critical, all 100% confidence. Root cause: `entity-ingest.ts` derived
`entities`/`entity_edges` `first_seen_at` from `effectiveAt = published_at ??
first_seen_at` — news time. Feeds pre-load ~7 days of publish-dated
articles, so on day one every entity/edge looked like it had a week of
history, defeating the 72h bootstrap guard (its `MIN(first_seen_at)` anchor
landed pre-launch) and flooding `first_seen`/`novel_edge`. The surge
detector's `baselineDaily = baselineSum / 14` (a fixed divisor) compounded
it: `baselineDays >= 3` was satisfied by publish-date calendar spread
rather than real operating days, so a genuinely brand-new system measured
λ against a fabricated multi-day baseline — United States hit 56.2σ.

**The invariant this violated**: NEWS TIME (when an article was published)
and WATCH TIME (when this platform first observed it) are different clocks.
Everything that measures "is this new/surprising *to us*" must use watch
time; everything that shapes a trend chart's timeline must use news time.

- `src/lib/server/settings.ts`: added `warmup_days: 7` to `DEFAULTS`.
- `src/lib/server/detectors.ts`:
  - `getSystemEpoch(sql)` — `MIN(articles.first_seen_at)`, deliberately
    unscoped by `dup_group_id` (a dup member's arrival is still a real
    observation). `computeWarmupState(epoch, warmupDays, now)`: active (and
    `daysRemaining`) when there's no epoch yet or fewer than `warmup_days`
    have elapsed since it.
  - `runDetectors` computes the epoch once and skips `surge`/`first_seen`/
    `novel_edge` entirely while warm-up is active, `console.warn`-ing the
    days remaining (visible in Vercel's function logs; NOT in the
    `ingest.yml` Actions curl output — see Deviations below).
    `cross_category`/`sentiment` are pure 24h-window detectors with no
    history dependence, so they keep running.
  - `computeEffectiveBaselineDays(daysSinceEpoch) = clamp(daysSinceEpoch -
    1, 1, 14)` replaces the fixed `/14` divisor; `scoreSurge` gained a
    `daysSinceEpoch` param with a `>= 4` gate (defense-in-depth alongside
    the existing `baselineDays >= 3` gate, redundant under the
    `warmup_days=7` default but real if an operator tunes warm-up shorter).
  - Recalibrated saturating scales that made everything critical @100%:
    `scoreFirstSeenNovelty` critical now needs `>= 8` sources (was 4),
    confidence `sources/8`; `scoreNovelEdge` critical now needs `>= 6`
    articles (was 4), confidence `articles/6`.
- `src/lib/server/entity-ingest.ts`: `HeadArticle`/`PendingMention`/
  `ResolvedMention` gained `arrivalAt = toDate(row.first_seen_at)` alongside
  the existing `effectiveAt`. `upsertNewEntities`, `bumpEntityLastSeen`, and
  `rollupEntityEdges` (via `groupMentionsByArticle`) now key off `arrivalAt`
  instead of `effectiveAt` — entities/edges `first_seen_at`/`last_seen_at`
  are watch time. `rollupHourlyMentions` deliberately stays on `effectiveAt`
  (publish-date spread is the correct shape for trend charts) and
  `entity_candidates` timing is untouched (publish spread there is
  legitimate recurrence evidence, per the original detector spec).
- `migrations/003_time_semantics_repair.sql` (new, one-time, never edits
  001/002): recomputes `entities.first_seen_at`/`last_seen_at` from
  `MIN`/`MAX(articles.first_seen_at)` via `article_entities` (entities with
  no surviving link keep their current values); clamps
  `entity_edges.first_seen_at`/`last_seen_at` up to at least
  `MIN(articles.first_seen_at)` (guarded so an empty `articles` table is a
  no-op instead of `NULL`ing a `NOT NULL` column); `DELETE FROM signals` —
  every pre-fix row is an artifact of the miscalibrated engine. Verified by
  hand against a seeded schema: a no-op on empty, and correctly repairs/
  clamps/preserves on seeded data (see conversation for the exact psql
  session).
- Tests: `src/lib/server/__tests__/integration/warmup-gate.integration.test.ts`
  (new) — (a) a day-1-launch scenario (articles all arriving within the
  last 24h, `published_at` spread across the prior week) asserts zero
  surge/first_seen/novel_edge while cross_category still fires; (b) an old
  system epoch (9 days) lets first_seen fire at warning (not critical) for
  3 sources and a seeded 10x spike fires surge with a sane z (< 15σ, not
  56σ). Unit coverage added to `detectors.test.ts`
  (`computeWarmupState` boundary at epoch+6.9d/+7.1d, `computeEffectiveBaselineDays`
  λ math, the `daysSinceEpoch` gate, recalibrated severity/confidence
  tables) and `entity-ingest.test.ts` (hourly bucketing stays effectiveAt-only,
  edges key off arrivalAt-only). Existing integration tests updated where
  the fix changed observable behavior: `entity-ingest.integration.test.ts`'s
  first/last_seen_at assertions now check "close to now" instead of a
  hardcoded publish-date ISO string, and one test was rewritten to
  deliberately backdate a later article's `published_at` to 2020 to prove
  `last_seen_at` now tracks arrival, not publish date.
  `signal-engine.integration.test.ts` gained a `beforeEach` `seedSystemEpoch()`
  (one article dated 30 days ago, outside `getBrief`'s 48h top-stories
  window) so its surge/first_seen/novel_edge tests — which never touched
  `articles` before — aren't wrongly warm-up-gated.

### Deviations from the fix-pack spec

- FIX 1 asked to surface the warm-up boolean "in whatever stats object the
  ingest route reports, so operators can see it in the Actions run log."
  The allowed file list for this pack excludes `src/app/api/ingest/route.ts`
  and `signal-store.ts`, and `route.ts`'s `counts.signals` is exactly
  `persistSignals`'s return value — there's no path from `runDetectors` to
  the HTTP response without touching one of those two files. Implemented
  the computation and gating fully (`getSystemEpoch`/`computeWarmupState`
  in `detectors.ts`, unit-tested) plus a `console.warn` with days-remaining
  for operational visibility in Vercel's function logs — but that warning
  does not reach `ingest.yml`'s GitHub Actions curl output today. Wiring
  `warmup: {active, daysRemaining}` into the ingest response is a small,
  isolated follow-up once `route.ts` is back in scope.
- `settings.test.ts` isn't in the pack's explicit test-file allowlist, but
  adding `warmup_days` to `DEFAULTS` (required by FIX 1) breaks its
  hardcoded multi-override equality assertion. Updated it minimally (one
  assertion, spread `...DEFAULTS` instead of a literal) so `npm test` stays
  green per the pack's own finish criteria.

## 2026-07-15 — Server-side signal engine + Brief landing tab

Signals become persistent database rows computed from real stored history at
the end of every hourly ingest, with a lifecycle the user controls
(new/seen/dismissed/promoted, plus reopen); the landing page becomes a
bounded daily brief.

- `src/lib/server/settings.ts` (new): `DEFAULTS` (`surprise_k: 3,
  dismiss_cooldown_hours: 72, brief_max_blocks: 10`) and `getSettings(sql)`
  overlaying `settings` table rows onto them — type-validated per key,
  `console.warn` + default fallback on mismatch.
- `src/lib/server/detectors.ts` (new): five pure scoring functions
  (`scoreSurge`, `scoreFirstSeenNovelty`, `scoreNovelEdge`,
  `scoreCrossCategory`, `scoreSentimentDeterioration`) plus
  `runDetectors(sql, settings)`. Rate surprise: `z = (observed24h -
  baselineDaily) / sqrt(baselineDaily + 1)`, baseline over the trailing 14
  days excluding the last 24h, skipped below 3 days of baseline history.
  First-seen novelty and novel-edge both apply a 72h bootstrap guard against
  the global `MIN(first_seen_at)` (entities / entity_edges respectively) so
  the initial dictionary-import cohort doesn't flood the queue. Sentiment
  deterioration is skipped entirely if the whole 24h window's sentiment_sum
  is zero across every entity (older rows may not have it populated). Every
  panel query is batched (few statements, shared across detectors where the
  underlying data overlaps — e.g. one `articles24h` query feeds both surge
  evidence and cross-category), scoped to `status='tracked'` entities and
  cluster-head (`dup_group_id IS NULL`) articles only. The old client
  detector's **escalation** type is deliberately not ported — cross_category
  and surge already cover the same "compound situation" signal it was
  approximating, and it didn't map cleanly onto stored history the way the
  other five did.
- `src/lib/server/signal-store.ts` (new): `persistSignals` suppresses a
  candidate whose dedupe_key was dismissed within
  `settings.dismiss_cooldown_hours`, otherwise upserts against the active
  partial unique index (`ON CONFLICT (dedupe_key) WHERE state IN
  ('new','seen','promoted')`) — state is never touched by re-detection.
  Returns `{created, refreshed, suppressed}`. `transitionSignal` enforces
  the lifecycle (any active state → seen/dismissed/promoted; dismissed → new
  via `reopen`), returns false on an unknown id or illegal transition.
  `loadSignals` is the one query shared by `/api/signals` and `/api/brief`:
  severity-first ordering, entity names resolved via a LATERAL join (no
  per-signal fetch), plus a second batched query resolving
  `evidence.articleIds` to title/link/source for the UI's evidence
  expanders — a field added beyond the detector spec's literal "articleIds"
  contract, needed once the Brief/Signals UI had to render actual links.
- `src/app/api/ingest/route.ts`: `detect-signals` wired as the final stage
  (`getSettings` → `runDetectors` → `persistSignals`), following the
  existing per-stage try/catch-and-attribute pattern — a detector failure
  is reported by stage name without discarding `entities`/`inserted`/etc.
  from the stages that already succeeded.
- `src/app/api/signals/route.ts` (new): `GET ?state=csv` (default
  `new,seen,promoted`), `POST {id, action}` → `transitionSignal` (404 if the
  id doesn't exist, 409 on an illegal transition).
- `src/lib/server/brief.ts` + `src/app/api/brief/route.ts` (new):
  `computeStoryScore(clusterSize, ageHours) = ln(1+clusterSize) *
  e^(-ageHours/24)`, kept as a standalone pure function (hand-checked in
  its test) even though the query that feeds it isn't ordered in SQL — the
  ranking, sort, and cap-at-15 all happen in JS. `newEntities` reuses the
  same 72h bootstrap guard as the first-seen detector, capped at 5.
  `s-maxage=300, stale-while-revalidate=600`; 503 when `DATABASE_URL` is
  unset (both routes).
- `src/components/BriefTab.tsx` + `src/components/brief/*` (new): first tab,
  new default `activeTab` (was `"feeds"`) in `useDashboardTable.ts` — signal
  cards grouped by severity, a new-entities chip row, a ranked top-stories
  list. Distinct empty states for DB-not-configured, no-signals-yet, and
  fetch error.
- `src/components/SignalsTab.tsx` + `src/hooks/useSignalsTab.ts`
  (rewritten): the tab is now a signal **manager** — fetches every signal
  state and filters client-side via a state bar, with `reopen` available
  only for dismissed signals. `WatchlistSection` (top client entities with
  sparklines) is unchanged; it never depended on the deleted detector.
  `ManagedSignalCard` (in `src/components/signals/`) is shared between
  BriefTab and SignalsTab rather than duplicated — same card, different
  allowed-actions list.
- **Deleted**: `src/lib/signal-detector.ts` + its test (client-side anomaly
  detection, superseded by the server-side engine); the now-dead
  `SignalCard.tsx`/`SignalCardGrid.tsx`/`SignalsSummaryStrip.tsx` (only fed
  the old client `Signal` data model, no other importers).
- **Muting → dismiss migration**: `src/lib/signal-storage.ts` had only its
  three muting exports removed (`loadMutedEntities`, `saveMutedEntities`,
  `MUTE_DURATION`) plus the `wd-muted-entities` key — client-side muting is
  superseded by server-side dismiss, which now persists across devices and
  survives a page reload instead of expiring after 24h. Edge-history,
  baselines, and entity-snapshot code in that file are untouched by
  explicit task scope; `loadPreviousEntityNames`/`saveEntitySnapshot`/
  `SNAPSHOT_INTERVAL` are consequently now unused (they only ever fed the
  deleted client detector's novel-emergence check) — left in place rather
  than deleted, since the task explicitly scoped this file to "muting
  exports only" and didn't authorize touching the rest. Flagging as a
  known follow-up rather than silently cleaning it up outside scope.
  `useSignalsTab.ts` does a one-time `localStorage.removeItem('wd-muted-entities')`.
- `src/lib/entity-dictionaries.ts`: added "Great Britain" to the United
  Kingdom entry (UK, U.K., Britain were already present).
  `src/lib/server/extract-v2.ts`: acronym stoplist gained AI, ML, EV, IPO,
  CPI, GPS, VPN, PDF, URL, APP (GDP/FAQ/CEO-class role words were already
  present); reordered into a single alphabetically sorted set per the
  existing convention.
- **Known limitation** (consistent with every other mutation route in this
  single-user hobby app — no login exists anywhere to gate it behind):
  `POST /api/signals` is unauthenticated, same as `POST /api/candidates`.
- **Deviation 1**: bare `"UK"` never resolves via the dictionary layer —
  `entity-extractor.ts`'s `matchDictionaryEntriesInternal` has a pre-existing
  `term.length < 3` floor (out of this task's file scope) that silently
  drops every 2-character dictionary alias (also affects `"US"`). The
  extract-v2 test for UK resolution uses `"U.K."` (4 chars) instead, plus a
  dedicated test for the new `"Great Britain"` alias; noted here rather than
  fixed since `entity-extractor.ts` wasn't an authorized file for this task.
- **Deviation 2**: the detector spec's evidence contract is "numeric
  decomposition + articleIds" only (bare numbers). The Brief/Signals UI's
  evidence expanders need actual article titles/links to render, so
  `loadSignals` gained a second batched query resolving those ids to
  `{id, title, link, sourceName}` refs, attached as a separate `articles`
  field alongside (not replacing) the original `evidence` object — keeps
  the detector's literal contract intact while giving the UI what it needs.
- Verified in a real browser: local Postgres 16 (already running from the
  prior session's setup) seeded with entities/signals/articles, migrations
  applied directly via `psql` (the production Neon HTTP driver can't reach
  a plain Postgres server, so `scripts/migrate.mjs` doesn't work against it
  — same limitation noted in earlier entries). Since that same driver
  limitation means the Next.js dev server can't actually read the seeded
  data either, verification used Playwright route interception
  (`page.route`) to mock `/api/brief` and `/api/signals` with realistic
  payloads shaped exactly like the real API responses, then drove the real
  rendering code end-to-end: Brief tab (default, severity-grouped signal
  cards, new-entities chips, top stories, both themes), Signals tab
  (state-filter bar with live counts, `Reopen` appearing only on the
  dismissed card, evidence expander toggling). Screenshots taken, no
  console errors; throwaway dev database dropped and dev server stopped
  afterward — no repo or config changes left behind.
- Tests: 77 new (6 settings, 22 detectors, 15 signal-store, 6 brief, 10
  `/api/signals` route, 2 `/api/brief` route, 12 real-Postgres integration
  tests for the full engine — surge, first-seen novelty (plus its own
  dedicated bootstrap-guard-suppression case), novel edge, cross-category,
  persistence/refresh/cooldown/transitions/evidence-article resolution, and
  a `getBrief` source-count dedup edge case — 3 extract-v2 U.K./Great
  Britain/AI cases, 1 ingest-route detect-signals-failure case) minus 8
  removed with `signal-detector.test.ts` — net +69. 251 → 320 passing (241
  unit + 10 integration baseline → 298 unit + 22 integration; ran for real
  against a local Postgres 16, not just skipped). Initially only the surge
  path had real-Postgres coverage; adding first-seen/novel-edge/
  cross-category integration tests caught a real test-authoring bug (an
  entity can't simultaneously be within a 48h "recent" window and >72h from
  a same-window global-min — geometrically impossible since 48h < 72h) but
  the detector SQL itself — including the `UNNEST`-based novel-edge
  evidence join and the `cardinality`/`array_agg` source-dedup expression in
  `brief.ts` — was correct on first real execution. `tsc --noEmit` and
  `npm run build` both clean.
- **Fix-pack** (same day, after a 5-dimension adversarial review of the diff
  with independent 3-verifier confirmation per finding — 8 raw findings
  collapsing to 6 distinct issues, all confirmed real): (1) `detectors.ts`'s
  `loadGlobalMinFirstSeen` computed the novel-edge bootstrap guard's global
  `MIN(first_seen_at)` over *all* `entity_edges` rows with no
  `status='tracked'` join — unlike its sibling `entities` branch — even
  though the registry resolves mentions against dismissed entities too, so
  a stray dismissed-entity edge with an old timestamp could skew the guard
  and either flood the queue on bootstrap day or wrongly suppress genuine
  novelty. Fixed by joining `entity_edges` to `entities` on both sides and
  requiring `status='tracked'`, matching `loadRecentNovelEdges`'s own
  scoping; added a regression test seeding exactly that dismissed-entity
  skew. (2) `brief.ts`'s `parseStoryRow` read only `row.published_at`,
  so a dateless article (`published_at = NULL`, a routine, reachable state
  per `ingest-writer.ts`) silently became the Unix epoch via `new
  Date(null)` — sinking the story's rank to zero and reporting a bogus
  1970 `publishedAt` in the API response — instead of falling back to
  `first_seen_at` like the query's own `COALESCE` and `WHERE` clause
  already do. Fixed with `row.published_at ?? row.first_seen_at`; added a
  regression test (reproduced live pre-fix: `topStories[0].publishedAt ===
  "1970-01-01T00:00:00.000Z"`). (3) `signal-store.ts`'s `transitionSignal`
  was a non-atomic read-then-write (separate `SELECT state` then `UPDATE`,
  no transaction, no guard) — two concurrent transitions on the same id
  could race, with the loser's request silently discarded while still
  reporting success. Rewritten as a single conditional
  `UPDATE ... WHERE id = $1 AND state = $2 RETURNING id`, collapsing the
  two round-trips into one atomic compare-and-swap; a zero-row result now
  covers unknown-id, illegal-transition, *and* lost-the-race uniformly,
  which is exactly the boolean the API route already expected. (4)
  `DashboardTable.tsx`'s "Fetching live feeds..." and "No feed items" blocks
  were gated only on `loading`/`items.length`, not `activeTab` — Brief is
  now the default tab and is DB-backed (its data doesn't depend on the live
  feed items array at all), so every fresh page load briefly showed a
  spinner about an unrelated data source stacked on top of Brief's own
  content, and a live-feed outage would show "No feed items — past 7 days"
  underneath a Brief tab that had already loaded fine. This was visible in
  this same session's own earlier browser screenshot and misdiagnosed as
  pre-existing Review-tab behavior at the time. Fixed with an
  `isItemsDependentTab(activeTab)` predicate excluding `brief`/`review`
  (the two DB-backed tabs); re-verified in browser that the stray text is
  gone. (5) `useBriefTab.ts`/`useSignalsTab.ts` each tracked in-flight
  actions with a single `busyId: number | null` — clicking a second card's
  action while a first was still in flight silently re-enabled the first
  card's buttons (letting a second, possibly conflicting action fire before
  the first resolved) and an unsequenced `load()` refetch could let a
  slower-resolving response from an earlier action overwrite fresher state
  from a later one. Extracted `useBusyIds()` (a `Set<number>`, shared by
  both hooks) plus a `loadSeq` ref sequence-guard on `load()` in each,
  mirroring the `entityClickSeq` pattern `useDashboardTable.ts`'s
  `handleEntityClick` already uses for the identical class of bug. (6)
  `SignalIcon` in `signals/utils.tsx` was dead code orphaned by the
  `SignalCard.tsx` deletion — unreferenced anywhere, and stale against the
  live signal-type surface besides (its switch statement only covered the
  old client detector's six types; three of the five real server-side
  types would fall through with no case). Deleted, along with its
  `signals/index.ts` re-export.
- Tests: 3 new real-Postgres regression tests (dismissed-entity edge
  skewing the bootstrap guard; the epoch-fallback bug) plus a rewritten
  `transitionSignal` unit-test block matching the new atomic-UPDATE shape
  (net -1 test — the old block's per-scenario mock coverage is now
  redundant with the integration suite, which exercises the real guarded
  SQL directly). 320 → 321 passing (298 unit + 23 integration). `tsc
  --noEmit` and `npm run build` both clean; re-verified BriefTab/SignalsTab
  in browser post-fix (Playwright route interception, same method as the
  first pass) — the stray "No feed items" text is gone and the busyIds
  refactor renders identically to before.

## 2026-07-15 — CI workflow, real-Postgres integration tests, docs catch-up

Tests/CI/docs only — no production source, migration, or config touched.

- `.github/workflows/test.yml` (new): "Tests" workflow on `pull_request` and
  push to `main`. One `ubuntu-latest` job with a Postgres 16 service
  container (`pg_isready` health check), `actions/checkout@v4` +
  `actions/setup-node@v4` (node 20, npm cache), `npm ci`, `npx tsc --noEmit`,
  `npm test` (with `TEST_DATABASE_URL` pointed at the service container),
  `npm run build`.
- `src/lib/server/__tests__/helpers/pg-sql.ts` (new): `makePgSql(pool)` —
  a ~10-line adapter from a node-postgres `Pool` to the tagged-template
  `Sql` contract (positional `$1..$n` from the template's string parts;
  node-postgres already serializes JS arrays/strings correctly for the
  production queries' `::text[]`/`::jsonb` casts, so no special-casing was
  needed). `applyMigrations`/`freshSchema` — a from-scratch migration
  applier (deliberately not importing `scripts/migrate.mjs`, which runs
  `main()` at import time) that reads `migrations/*.sql` in filename order
  and executes them against a real Postgres, so the integration suite
  validates the actual migration files rather than a hand-copied schema.
  Added `pg` + `@types/pg` as devDependencies — justified because
  `@neondatabase/serverless` (the production driver) requires Neon's HTTP
  proxy and cannot reach a plain Postgres, so it's unusable for real
  integration testing.
- `src/lib/server/__tests__/integration/` (new): gated with
  `describe.skipIf(!process.env.TEST_DATABASE_URL)` so the suite skips
  cleanly wherever no database is configured and runs for real in CI, plus
  one ungated canary (`env-canary.test.ts`) that fails loudly if `CI` is
  set without `TEST_DATABASE_URL` — guards against the whole layer silently
  skipping while CI stays green.
  - `ingest-writer.integration.test.ts`: exact-duplicate insert/re-insert,
    `published_at NULL` for a dateless item, cross-source paraphrase
    dup-group linking, the three-consecutive-days recurring-headline case
    (day 2 attaches to day 1's head; after day 1 ages out of the 48h
    window, day 3 starts a new head rather than chaining to day 2), and
    `sweepRetention`'s 30-day delete plus the `ON DELETE SET NULL` path on
    a younger dup-group member.
  - `entity-ingest.integration.test.ts`: `processNewArticles` happy path
    (dictionary entities with correct type/first_seen_at, article_entities
    written for cluster heads only, hourly bucket math on
    `COALESCE(published_at, first_seen_at)`, `entity_a < entity_b` edge
    ordering, an unresolved recurring name landing in `entity_candidates`
    with correct mention_count/source_names/day_count), full-run
    idempotency (a second run touches zero rows anywhere — the regression
    test for the mention-inflation blocker), `entities.last_seen_at`
    advancing on a later mention while `first_seen_at` stays put, and a
    SQL-level candidate accept flow (insert entity from the candidate's
    fields, delete the candidate, confirm the next article resolves to it
    and no candidate row reappears) — done directly against the tables
    since the route handlers construct their own Neon client and aren't
    importable here.
- **Gotcha (caught by actually running against Postgres, not just
  reasoning about the SQL): schema races between concurrent test files.**
  vitest runs test files concurrently by default; both integration files
  share the one `TEST_DATABASE_URL` database, and each originally did
  `DROP SCHEMA public CASCADE` in its own `beforeEach` — one file's drop
  would occasionally wipe the other's mid-test (`relation "articles" does
  not exist`). Fixed by giving each file its own named schema
  (`wd_test_ingest_writer` / `wd_test_entity_ingest`) via the pool's
  `options: "-c search_path=<name>"`, so `freshSchema` now drops/creates a
  caller-given schema instead of hardcoding `public`. `vitest.config.ts` is
  outside the authorized file list for this task, so this was fixed at the
  test-helper level rather than by disabling file parallelism.
- **Deviation from the task brief**: the brief assumed this sandbox has no
  database and that the integration tests would first execute in CI. It
  actually has Postgres 16 installed (just not running) — started it
  locally, pointed `TEST_DATABASE_URL` at it with the exact
  `POSTGRES_PASSWORD=test`/`POSTGRES_DB=test` the CI service container
  uses, and ran the full integration suite for real (5 repeated runs, no
  flakiness) before this ever reached GitHub Actions. That's how the
  schema-race gotcha above was caught instead of shipped. This local
  Postgres was sandbox-only setup, not a repo or CI change.
- MANIFEST.md: added `addCandidate` to `extract-v2.ts`'s exports; expanded
  `migrations/002_entity_indexes.sql`'s row to cover all three of its
  statements (the prior fix-pack had only documented the first index);
  added rows for the four new test-helper/integration files; added a CI
  test gate invariant and an integration-test-layer invariant (schema
  isolation included); corrected the entity-pass idempotency invariant,
  which still described the old `NOT EXISTS(article_entities)` gate even
  though the code (and this same section's migration row) already reflects
  the `entities_processed_at` marker.
- Local: 240 pre-existing tests still pass; with no `TEST_DATABASE_URL` set
  the 10 new integration tests report as skipped (241 passed | 10 skipped,
  21 files) and the 1 new canary test passes; with `TEST_DATABASE_URL` set
  against a real local Postgres, all 251 tests pass (21 files, 0 skipped).
  `tsc --noEmit` and `npm run build` both clean.

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

### Review fixes (same day, second pass — not yet merged when this landed)

A second review of the branch (still unmerged) found seven further issues,
all fixed here:

- **FIX 1 (blocker) — explicit processed marker**: the entity pass's
  idempotency gate was `NOT EXISTS(article_entities)`. An article whose
  extracted names were *all* unresolved candidates never got an
  `article_entities` row, so it was re-selected for its entire 6h lookback
  window every run and its `entity_candidates` sightings re-accumulated —
  `mention_count` could inflate ~6x (`day_count`/source dedup were already
  immune, `mention_count` wasn't). Separately, the marker write
  (`article_entities`) happened *before* the hourly/edges/candidates
  rollups, so a mid-run crash after it permanently skipped those. Fixed with
  `migrations/002_entity_indexes.sql`'s new `articles.entities_processed_at`
  column (`ALTER TABLE`, not yet run) — `selectUnprocessedHeads` now filters
  on `entities_processed_at IS NULL` instead of `NOT EXISTS`, and
  `processNewArticles` sets it as the deliberately-last statement of a run,
  after every aggregate write. A crash between those writes and the marker
  now means one batch retries next run (additive rollups double-count for
  that one batch — rare, bounded, and explicitly preferred over silently
  losing articles whose entities never got recorded at all; see the comment
  above the marker UPDATE).
- **FIX 2 — stale `last_seen_at`**: `entities.last_seen_at` was only ever
  set by the first-mention upsert; a mention resolving against an *existing*
  registry entity never touched it again, so a tracked entity's
  `last_seen_at` froze at creation while `/api/entities/[id]` served it as
  live data. `processNewArticles` now bumps it for every resolved mention in
  one grouped `UPDATE ... FROM UNNEST(...) ... GREATEST(...)` statement
  (harmless no-op re-set for just-created entities, essential for
  registry-resolved ones).
- **FIX 3 — layer-priority bug**: `extract-v2.ts`'s `addCandidate` upgraded
  a norm's entry whenever the new candidate's display was longer —
  including its `layer` and `typeHint` — so a dictionary hit could be
  silently demoted by a same-norm compromise/acronym/person-regex match with
  a longer display (e.g. "Veltrax" → "Veltrax Inc" after suffix-stripping),
  sending a known dictionary entity into the human review queue instead of
  auto-tracking it. Fixed with an explicit layer-priority ranking
  (dictionary > compromise > acronym > person-regex): a collision keeps the
  higher-priority layer's `layer`/`typeHint` unconditionally, and only
  upgrades the display string when the new layer's priority is ≥ the
  existing one's.
- **FIX 4 — stranded candidate race**: if an hourly ingest re-inserted a
  candidate a reviewer had just accepted/dismissed, `ON CONFLICT (canonical_name)
  DO NOTHING` returning zero rows was treated as a hard failure (409), and
  since the candidate row never got deleted, it stayed un-actionable for the
  full 14-day retention window. Since that `ON CONFLICT` target can only
  no-op for one reason (the `canonical_name` already exists),
  `acceptCandidate`/`dismissCandidate` now explicitly check for that entity
  on a zero-row return and, if found, delete the candidate and return
  success anyway — the name is resolved either way. 409 is now reserved for
  the case where the entity genuinely doesn't exist. Noted as a single-writer
  assumption in a comment: this read-then-delete isn't transactional, so two
  ingest runs racing here could each see zero rows, but that's a rare,
  bounded undercount, not data corruption.
- **FIX 5 — per-article resilience**: `processNewArticles`'s classification
  loop now wraps each article's extraction + classification in its own
  try/catch — a pathological title logs `console.error` with the article id
  and is skipped (left unmarked, so it retries next run) instead of
  aborting the whole batch.
- **FIX 6 — observable ingest failures**: `/api/ingest`'s pipeline stages
  (fetch-feeds, persist-articles, sweep-retention, process-entities) are now
  each wrapped so a throw is attributable — `console.error`'d with the
  stage name, and the 500 response includes `{ error, stage, ...whatever
  counts prior stages already produced }` instead of a generic
  undifferentiated 500.
- **FIX 7 — small UI fixes**: `handleEntityClick`'s text-filter fallback now
  also closes any already-open `EntityPanel`; `ReviewTab` treats a 503 from
  `/api/candidates` as a friendly "Entity review requires a configured
  database" empty state rather than the generic error banner, and resets
  the header badge count to 0 on any load failure so it can't show a stale
  positive number.
- Tests: 13 new (3 entity-ingest — marker-is-final-statement, grouped
  `last_seen_at` bump, throwing-article-skipped-rest-commits; 4 extract-v2
  layer-priority cases; 4 candidates route — race-resolves-as-success and
  genuinely-absent-entity-409, for both accept and dismiss; a new
  `src/app/api/ingest/__tests__/route.test.ts`, 4 tests, covering stage
  attribution and partial-counts-on-failure). 227 → 240 passing. `tsc
  --noEmit` and `npm run build` both clean.

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
