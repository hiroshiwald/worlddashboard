# World Dashboard Development Log

Older entries (2026-08-20 to 2026-11-16): DEVLOG-ARCHIVE.md. Do not read it at session start.

## 2026-11-17 — main updated; growth cause found; topics merged; budget cap $10
- What changed: Operator said go. `main` fast-forwarded to `130686d` (Phase 4 tabs). Temporary route `GET /api/debug-counts` (preview only) gave live daily counts. Growth coverage weighting reverted. Growth now computed on display-merge groups (`groupMembersById` in `entity-facts.ts`). Merged topic storage (migration 009, `llm-extract.ts`, `entity-ingest.ts`) and topic clusters in `/api/graph`. `llm_monthly_budget_usd` default raised from 5 to 10 (no `settings` row overrides it).
- What it affected: `entity-facts.ts` adds one query (all non-dismissed entities for merge groups). Gate: tsc clean, 1192 tests pass (57 skipped), build passes.
- Gotchas: Live counts, Nov 2 to 16: 500 to 1,400 articles a day, about 70% with entities, 650 to 1,730 mentions a day. Collection had NO gap. The growth distortion came from duplicate rows: "United States" (id 6) had 1,593 mentions in 14 days, "US" (id 182) 33, in bursts, which read as Rising ×10. Lesson: get the data before choosing a denominator; two guesses were wasted. November LLM usage is 6 calls (150k batch input tokens) against 129 calls in October. Most November tagging is dictionary-only. Cause not checked. Migrations 006 and 007 have `applied_at` NULL in `schema_migrations`: applied by hand. Migration 009 must run on the database BEFORE this branch reaches `main`; the new ingest and graph SQL read `articles.topic`. The previews read the production database, so preview `/api/graph` fails until then. Topic cost estimate (helper, not measured): about $0.034 per 1,000 articles. Group sources add article counts across members; an article naming two members counts twice there. Helper tokens: topics 114k, clusters 88k (Sonnet).

## 2026-11-17 — Growth scaled to collection volume; Newsfeed matching fixes
- What changed: `computeGrowth` takes `totals` (all-entity mentions per hour) and scales recent counts by usual volume / recent volume (`volumeScale`). Thresholds and the 0.3 floor keep their meaning. Newsfeed matching excludes the title's publisher suffix name, and one-word names match with their own capitals ("EAST" no longer matches "Middle East").
- What it affected: `entity-growth.ts`, `entity-facts.ts` (one more query, alias `volume_mentions`), `candidate-match.ts`, `feed.ts`. Gate: tsc clean, 1197 tests pass (57 skipped), build passes.
- Gotchas: Nov 16 collected about 2x the usual volume (more ingest runs after the staleness fix), which doubled every recent count. Text-routing test mocks needed the new alias again.
## 2026-11-17 — Operator off switch
- Changed: `activity_paused` (+ `activity_paused_since`, epoch ms) settings; `runIngest` returns `{paused:true}` before any work; GET/POST `/api/activity`; header button `PauseActivityButton` with confirm and red marker.
- Affected: settings.ts, run-ingest.ts (covers /api/ingest GET+POST and /api/tick), HeaderBar.tsx, new route and component, tests. Gate: tsc, 1194 tests, build, Playwright (route-intercepted) pass. Real DB write (upsert SQL) not run.
- Gotchas: Not gated: `GET /api/sources` (live feed fetch, no LLM/Wikipedia) and user-click paths (entity PATCH, candidate accept) that can call Wikidata. Tick takes its lock before a paused run, so a paused tick still burns the 10-minute lock. Paused read failure aborts ingest (fail closed). Endpoint has no auth, like entities PATCH.
## 2026-11-17 — tabs trimmed, Ignore in Newsfeed, "Dismissed" renamed "Ignored"
- What changed: Tab bar shows Newsfeed, Entities, Entity map, Network, Map (Brief, Feeds, Developments hidden, code kept); default tab Newsfeed. Newsfeed rows get an Ignore button beside + Track (candidate: POST /api/candidates dismiss; entity: PATCH status dismissed); ignored names show struck through with an "Ignored" tag. Entities tab says Ignored/Ignore in filter, status cell, button titles, toast.
- What it affected: `HeaderBar.tsx` tab list, `useDashboardTable.ts` default, `newsfeed/*`, `useNewsfeed.ts` (`dismissCandidate`), `applyCandidateTracked` became `applyCandidateStatus`, `entities/*`, `useEntitiesTab.ts`. Gate: tsc, tests, build pass; Playwright check passes.
- Gotchas: Status filter is a select, not buttons. Candidate queue toast text in `useCandidateQueue.ts` still says "Dismissed" (out of scope). A candidate ignored in the feed becomes a `cand:` row until reload; the Newsfeed has no un-ignore (use Entities > Ignored > Track).

## 2026-11-17
- Feed now matches tracked entities (name + aliases) against title/summary at read time, merged with ingest links by id.
- Affects src/lib/server/feed.ts loadFeed; reuses buildCandidateMatcher guards. No surname derivation: bare surname needs an alias.
- Entity extraction misses: possessive folding, Unicode person regex, broader LLM prompt and topic labels.
- Affects extract-v2.ts (normalizeName, addCandidate, person regex) and llm-extract.ts (SYSTEM_PROMPT).
- Gotcha: Orbán-style names are also caught by compromise, so tests assert on display only, not layer.
- Added GET /api/emerging (src/lib/server/emerging.ts, route, tests); exported loadRoleMap from graph.ts.
- Candidate anchors use exact sample_titles = articles.title match (ingest stores raw titles), no read-time matcher needed.

## 2026-11-17 — Map tiles, new-names endpoint, topic reuse filter (orchestrator)
- What changed: Map tab uses keyless Esri Canvas tiles (CARTO now returns "API KEY REQUIRED"). New `GET /api/emerging` (contract `src/lib/emerging-types.ts`): new candidates and new satellite entities with their top 3 famous/anchor co-mentions. Topic reuse list offers only labels of 3 words or fewer.
- What it affected: `MapTab.tsx`, `emerging.ts`, `graph.ts` (exports `loadRoleMap`), `entity-ingest.ts` `loadTopicLabels`.
- Gotchas: Live `/api/graph` on 2026-11-17: 100 of 1625 nodes had a topic; topics were event-specific ("FAA funding request", 2 entities each), so the Universe showed only "Other" and "No topic". Graph nodes are all status tracked, so new untracked names never reached the map: that is why "trending new entities" disappeared. Growth ratio = recent count x (usual volume / recent volume) / usual count, which equals share now / usual share. Of 78 growing nodes, 55 were famous and many were duplicate spellings (Putin x3, Zelensky x5). Worktree helpers branch from the default branch, not the current one: push contract files first and tell helpers to fetch them. Helper tokens (Sonnet): diagnosis 94k, 95k, 77k; extraction 99k; feed 99k; emerging 114k; map UI 152k (over the 150k cap: split UI rewrites smaller next time).
- Entity map Universe now one bubble per anchor from /api/emerging; labels use real bubble radius; Growing fastest skips merged; "New near known" panel.
- Affected: src/components/entitymap/*, src/hooks/useEntityMap.ts, src/hooks/useEmerging.ts, src/lib/map-layout.ts (placeLabels).
- Gotchas: topic/cluster grouping, scope, open/close, drag, island frames, contentBand deleted. filterGraph already dropped merged nodes, so the growingFastest guard is belt and braces. Trace now shows text only (no map highlight).

## 2026-11-17 — Anchor ranking; publisher removed from Newsfeed headlines
- What changed: `EmergingAnchor` gains `type`. `anchorRank`: person/company 0, other 1, country/region/city 2, no anchor 3. Applied to anchors per item, item order in `/api/emerging`, bubble order and the "New near known" list. Newsfeed headline text drops the " - Publisher" suffix (`stripPublisherSuffix`).
- What it affected: `emerging-types.ts`, `emerging.ts`, `entitymap/universe.ts`, `newsfeed/FeedRow.tsx`, tests. Gate: tsc, 1226 tests, build pass.
- Gotchas: Operator approved the push to `main`.

## 2026-11-17 — Cause of the November LLM gap found
- What changed: Nothing in code. GitHub "Hourly ingest" had no runs between 2026-10-31 (run 1998) and 2026-11-17 (run 1999, started by hand). Workflow state is active again (updated 2026-11-17 00:59 UTC).
- What it affected: November ingest ran only from the daily Vercel cron and page ticks, so few batches were submitted (6 calls). Run 1999: 74 of 106 feeds OK, LLM used on 15 articles, month cost $0.66, no failure reasons.
- Gotchas: Articles first seen while the job was off are older than the 6-hour lookback and never get entities, topics or translations. A backfill would need a separate one-off job. 32 of 106 feeds fail; not checked.
## 2026-11-17
- Newsfeed shows English headlines for non-English articles (title_en, migration 010) with a "Translated" tag; original on hover.
- Touched llm-extract (parseTitleEn), entity-ingest (one UPDATE writes topic + title_en), feed.ts, FeedRow, feed-logic headline().
- Gotcha: vitest has no JSX transform, so FeedRow logic lives in pure headline() for testing.
## 2026-11-17 Universe: packed bubbles, name card, Track/Ignore
- Replaced the force/grid layout with packCircles (entitymap/pack.ts); added context and links to /api/emerging; new NameCard with Track/Ignore via the Newsfeed calls.
- Affected: entitymap tab, useEmerging, map-layout.ts (layoutMap deleted), stats table and countStats removed.
- Gotcha: candidate headline links come from a separate title query, since the anchor join drops articles with no tracked neighbour.

## 2026-11-17 — Entity map polish; emerging name hygiene (orchestrator)
- What changed: Universe labels always sit inside the bubble (`insideLabel`: 13 px down to 9 px, then ellipsis); outside labels removed. Bubble colour = anchor kind (person/company, other, place, none) with a legend; top 30 groups shown. `/api/emerging` drops candidate names that fail `isMatchableName` and trims a trailing dash.
- What it affected: `MapSvg.tsx`, `pack.ts`, `emerging.ts`, tests. Gate: tsc, tests, build pass. Checked with Playwright on live `/api/emerging` data from the preview.
- Gotchas: Translation (migration 010) must run in Neon BEFORE this branch reaches `main`: feed SQL reads `articles.title_en`. Helper tokens (Sonnet): translation 119k, map discovery 158k (over the 150k cap again; UI rewrites need smaller briefs).

## 2026-11-17
- Added one-off November LLM backfill: ingest tops its batch up to 400 topic-less window heads (backfill.ts, GET /api/backfill, backfill tally in ingest response).
- Affects entity-ingest.ts submit/apply stages; reprocessed articles grow hourly/edge counts only for new article_entities links, candidates and relations skipped.
- Gotcha: a head that keeps failing the LLM stays topic-less and is re-selected; delete backfill.ts and its call sites once remaining = 0.
- Orchestrator addition: `markBackfillAttempted` sets topic "Other" on window articles still topic-less after their batch resolves (or fails), so a stuck article is not re-sent every run. Helper tokens (Sonnet): 151k (over cap; idempotency work).

## 2026-11-17 — Catch-up window narrowed to Nov 10 to 16
- What changed: `BACKFILL_FROM` = 2026-11-10 (operator decision). Nov 1 to 9 skipped for budget; noted in HANDOFF-PROMPT.md.
- What it affected: `backfill.ts` and tests. Full window had 11,355 articles, estimate $7.38.
- Gotchas: Pushed to `main`; the catch-up starts on the next scheduled ingest.

## 2026-11-17
- Newsfeed: removed blue left row accent; header search now filters Newsfeed rows (matchesSearch in feed-logic.ts, searchQuery plumbed DashboardTable -> TabContent -> NewsfeedTab).
- Cause: searchQuery lived only in useDashboardTable and filtered the old items; NewsfeedTab never received it. Search covers loaded pages only.
- Entity map Universe is now a force-directed graph (UniverseGraph.tsx, pure forcegraph.ts): whole graph plus new names in one viewport, sticky side panel.
- Affected: useEntityMap (bubble/item replaced by `selected`; data is now all live nodes, filterGraph replaced by liveGraph), SidePanel, NameCard; deleted MapSvg, pack, groupByAnchor, bubbleRadius and tests.
- Gotcha: react-force-graph mutates nodes/links, so it gets copies; link ends become objects after init (endId). Not visually driven in a browser.

## 2026-11-17 — Entity map force graph: three layout attempts, stopped
- What changed: Universe is a react-force-graph-2d view (helper). Orchestrator: labels only for the top 12 new names and top 10 known entities (`pickLabelled`), bigger nodes, charge -60 / link distance 40, unlinked nodes dropped, known nodes limited to anchors of new names plus the 40 busiest (`universeNodes`).
- What it affected: `forcegraph.ts`, `UniverseGraph.tsx`, tests. Gate passes. Not pushed to `main`.
- Gotchas: Small disconnected pieces (a new name and one anchor) drift far from the core, so zoomToFit shrinks the core to a small knot. Next step with new information: add centring forces (forceX/forceY from d3-force, already installed under react-force-graph; declaring it in package.json is a stated dependency change) or lay out each component separately. Stopped after 3 attempts per CLAUDE.md. Helper committed a node_modules symlink; removed and `/node_modules` added to .gitignore.

## 2026-11-17 — Force-graph centring fixed; `followed` flag (orchestrator)
- What changed: Universe force graph gets a custom centring force (`centringForce` in `forcegraph.ts`, strength 0.2), no new dependency. Pushed to `main`. Migration 011 adds `entities.followed`; Track sets it, Ignore and Stop tracking clear it (PATCH `/api/entities/[id]` and candidate accept). Newsfeed status, "In your world", "Mentions a tracked entity", Entity map "tracked/not tracked" and dashed outlines read `followed`. On the branch only until the operator runs 011.
- What it affected: `UniverseGraph.tsx`, `forcegraph.ts`, `feed.ts` (`feedStatus`), `graph.ts` (`GraphNode.followed`), `route.ts`, `candidate-actions.ts`, `SidePanel.tsx`, `EntityLevel.tsx`, tests. Gate: tsc, 1247 tests, build pass.
- Gotchas: d3's built-in "center" force moves only the mean, so small pieces drifted out. Strength 0.08 failed on live data (1632 nodes); 0.15 borderline; 0.2 passed. feed.ts and graph.ts throw if `followed` is missing, so the tracking code must not reach `main` before 011. Old hidden tabs (Entities, Network) still show status, not `followed`. Helper tokens (Sonnet): live check 87k.

## 2026-11-17 — Duplicate names merged; rare stored names shown in Newsfeed (orchestrator)
- What changed: `soft-merge.ts` folds country prefixes (US, U.S., USA, United States; UK, U.K.) so variants group (`foldCountry`, `sharesFoldedName`). Newsfeed applies merge groups per article (`mergeArticleRows`, followed if any member is followed) and links stored candidates to an article when its raw title is in `sample_titles` (`buildTitleIndex`).
- What it affected: `soft-merge.ts`, `feed.ts`, tests. Graph and entity facts use the same groups. Gate: tsc, 1262 tests, build pass. On live graph names: 11 groups, all correct (U.S./US/USA/United States, UK, UN, US Army, US Navy, US Treasury, US Senate, AI, HIV).
- Gotchas: Neon showed "Lionfish UUV" (1 mention) and "HII" (2) were extracted; the read-time matcher missed them ("UUVs" plural; single words under 4 chars). COLA/Coca-Cola is suspected to come from the Wikidata top search hit plus copied aliases; not confirmed. Proposed next: LLM returns a Wikipedia title per entity. Helper tokens (Sonnet): feed 95k, soft-merge 83k.

## 2026-11-17 — COLA no longer resolves to Coca-Cola
- What changed: ingest name index skips all-lowercase aliases (`isNameLikeAlias` in `entity-ingest.ts`).
- What it affected: entity resolution at ingest only. Old article links to Coca-Cola stay.
- Gotchas: Neon showed Coca-Cola (284) and Coke (359) carry Wikidata aliases "cola" and "kola"; the index keys names in lowercase, so "COLA" matched.

## 2026-11-17 — Wikidata test fixtures carry the looked-up name as a label
- What changed: `wikidata.test.ts` and `fame-sweep.test.ts` fixtures now give the mocked wbgetentities hits an English label equal to the name looked up, so `hasNameForm` accepts them. Added a `hasNameForm` describe (3 cases) and a lookup case for a hit whose labels lack the name (matched:false, pageviews never called). No source or assertion changes.
- What it affected: 13 failing tests in those two files; pass now (113 passed, 8 skipped in the two files).
- Gotchas: Disambiguation fixtures label every hit that competes for the name (ICC: Q_ANTWERP and Q_ICC), or the sitelink comparison is not exercised. The default entity label is "Vladimir Putin", so any test looking up another name needs an explicit label.

## 2026-11-17 — Entity map Universe moved to sigma + graphology
- What changed: `UniverseGraph.tsx` now renders sigma (ForceAtlas2 worker runs 4 s, Louvain colours, community legend, hubs toggle). Pure helpers in `universe-view.ts`. Side panel gains "New brokers" and "New links this week". Removed `EntityLevel.tsx`, `forcegraph.ts` and their tests; `layoutEntity`/`labelText` removed from `model.ts`; `entityId`/`goEntity` removed from `useEntityMap`.
- What it affected: `EntityMapTab.tsx`, `SidePanel.tsx`, `NameCard.tsx`, `useEntityMap.ts`, `model.ts`. `lib/map-layout.ts` is now unused by the app (own test only).
- Gotchas: sigma 4 takes reducers as constructor options (no `setSetting("nodeReducer")`), so they read a ref and the view calls `refresh()`. sigma reads node attr `type` as a program name, so `paintGraph` removes it. `react-force-graph-2d` stays: `NetworkTab.tsx` still imports it. Not checked in a real WebGL browser.

## 2026-11-17 — LLM Wikipedia titles; sigma.js Entity map (orchestrator)
- What changed: LLM entities carry an optional `wiki` title (`parseWikiTitle`); ingest resolves a candidate whose `wiki` equals a stored `wiki_title` and appends the surface form as an alias (`appendWikiAliases`). Wikidata fame lookup accepts a search hit only when the name is one of its name-like labels or aliases (`hasNameForm`; `isNameLikeAlias` moved to `extract-v2.ts`). Entity map Universe is now sigma 3 + graphology: FA2 worker layout with strong gravity, Louvain colours by legend rank (others grey), label density grid, hubs hidden by default, brokers (betweenness share before vs after this week's edges) and new links in the side panel.
- What it affected: `llm-extract.ts`, `extract-v2.ts`, `entity-ingest.ts`, `wikidata.ts`, `entitymap/*`, `useEntityMap.ts`, package.json. Gate: tsc, 1276 tests, build pass. Live check with Playwright on live `/api/graph` (1,636 nodes, 5,238 edges): nodes and labels render, zoom adds labels, canvas click and broker click light the node and its neighbours.
- Gotchas: sigma 4.0.6 has a new styles/primitives engine; v3-style attributes and reducers drew edges but no nodes. Pinned sigma 3.0.2. `labelRenderedSizeThreshold` above the node size hides all labels at every zoom; use 0 and let the density grid cull. Betweenness is normalized (0..1); show it as a percentage. A wiki-resolved surface form does not resolve relations in the same run (the alias exists from the next run). react-force-graph-2d stays for the hidden Network tab. COLA cleanup SQL is in HANDOFF-PROMPT.md, not run. DEVLOG.md is 270 KB, over the 32 KB start-read limit; it needs an archive split. Helper tokens: metrics 83k (Sonnet), view 125k (Sonnet), fixtures 138k (Haiku), live check 95k (Sonnet). Rework: the view helper used sigma 4 without a browser check; one fix round.

## 2026-11-17
- Added entitymap/novelty.ts (+tests); buildGraph now carries node role/status and edge lastSeenAt/articleCount.
- Affects graph-metrics.ts consumers (additive attrs only).
- Gotcha: nodes without links get firstSeen -Infinity; reasons computed on the kept subgraph.

## 2026-11-17 — Newsfeed search queries the server
- What changed: `/api/feed` takes `q` (trim, 2..100 chars else 400; not combinable with `after`). `searchArticlePage` in `feed.ts` matches title, title_en, summary and linked entity names/aliases with ILIKE (wildcards escaped by `toLikePattern`), same ordering and `before` cursor. `useNewsfeed(searchText)` debounces 300 ms, refetches page 1 with q, pages with q, pauses polling while searching. Client-only `matchesSearch` and `fold` removed.
- What it affected: `feed.ts`, `useNewsfeed.ts`, `NewsfeedTab.tsx`, `feed-logic.ts`, their tests.
- Gotchas: source name is no longer searched (spec lists title/summary/entities only). Candidate names are no longer searched either. ILIKE '%x%' cannot use a btree; scans articles newest first and stops at LIMIT, so rare terms scan the whole table (pg_trgm GIN index proposed: migrations/012_articles_search_trgm.sql, not created).

## 2026-11-17
- Novelty View: toolbar controls, replay (sigma reducers), "(new)" label suffix, "why" line in detail panel.
- Affects EntityMapTab, UniverseGraph, SidePanel, universe-view.ts, new replay.ts and useReplay.ts.
- Gotcha: new names are marked by label suffix (no node program installed); legend counts only nodes in the filtered subgraph.

## 2026-11-17 — Entity map novelty filters; full-dataset Newsfeed search (orchestrator)
- What changed: Entity map toolbar: Novelty (top N by surprise score, default 100), Window 7/14/30 days, Hide famous, Near my tracked (1 or 2 hops), Replay by day. New names from `/api/emerging` are nodes linked to their anchors, labelled "(new)", with a "why" line in the detail panel. `/api/graph` window is 30 days. Newsfeed search sends `q` to the server (ILIKE over title, title_en, summary, entity names and aliases). Spec: docs/NOVELTY-FILTER-SPEC.md.
- What it affected: `entitymap/novelty.ts`, `replay.ts`, `EntityMapTab.tsx`, `UniverseGraph.tsx`, `SidePanel.tsx`, `useEmerging.ts`, `useReplay.ts`, `graph.ts`, `feed.ts`, `useNewsfeed.ts`, `NewsfeedTab.tsx`. Gate: tsc, 1309 tests, build pass. Live data: default view 103 nodes with 18 new names; Hide famous shows Lionfish UUV linked to U.S. Navy.
- Gotchas: No entity is followed yet, so Near my tracked is disabled with a hint. Hide famous keeps famous anchors of shown new names as context. A new name whose anchors are all hidden is dropped from the map (it stays in the side panel). Search uses leading-wildcard ILIKE (no btree index); proposed migration 012 (pg_trgm GIN) not created. Not on `main` yet. Helper tokens (Sonnet): novelty 94k, search 112k, view 98k.

## 2026-11-17 — "Pause all activity" removed from the header
- What changed: deleted `PauseActivityButton.tsx` and its use in `HeaderBar.tsx`. Login with admin and general roles noted in HANDOFF-PROMPT.md as the next step.
- What it affected: header only. `/api/activity` and the pause logic stay; activity was not paused at removal (checked live).
- Gotchas: `POST /api/activity` has no auth, so anyone can still pause by calling it. The login work should close that.

## 2026-11-17 — DEVLOG split into DEVLOG.md and DEVLOG-ARCHIVE.md
- What changed: entries 2026-08-20 to 2026-11-16 (85 entries, 254 KB) moved to `DEVLOG-ARCHIVE.md`. `DEVLOG.md` keeps 2026-11-17 on (23 KB) with a one-line pointer.
- What it affected: start-of-session reads only. HANDOFF-PROMPT.md read note updated.
- Gotchas: move entries to the archive again when DEVLOG.md passes 32 KB.
