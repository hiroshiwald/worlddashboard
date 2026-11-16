# BUILD-GUIDE-INTERFACE-V2.md

Build guide for the next interface of worlddashboard: three tabs (Newsfeed, Entities, Entity map) on live data. Written 2026-11-16 from a long design session. It is a plan and a spec. It is not permission to delete anything.

Read in this order: `CLAUDE.md`, `DESIGN.md`, this guide, then the prototype at `docs/prototype/radar-sketch.html`. The prototype uses fictional data. It shows the intended behavior. Do not copy its mock data or its simulation code.

---

## 1. State of the project on 2026-11-16

These facts were checked against Vercel and GitHub on this date.

| Fact | Evidence |
|---|---|
| Production runs `main` at commit `1dd6a7c`, deployed 2026-08-21. No production deploy since. | Vercel deployment `dpl_2r3N3qkcsbmjJPGsthDboe1VsieJ` is the only production deploy and is aliased to `worlddashboard.vercel.app`. |
| An unmerged redesign branch exists. It has no open pull request. | Branch `claude/redesign-signals-brief-entities-p4lscw`, 9 commits on 2026-09-01. See section 3. |
| The database is fresh. The dashboard screen is not. | See section 2. |
| The cron runs once a day. | `vercel.json`: `13 6 * * *` on `/api/ingest`. The Hobby plan limits crons to daily. |

---

## 2. Phase 0: why the dashboard looks stale, and the fix

### Finding

The pipeline is running. The dashboard shows a cached copy of old query results.

Evidence, all read from production on 2026-11-16 at about 21:15 UTC:

1. `GET /api/articles?days=1` returned items whose newest arrival time (`updatedAt`) was `2026-11-16T20:39:56Z`.
2. `GET /api/articles` (the dashboard's own request, default `days=7`) returned `lastIngestAt = 2026-11-14T07:09:39.939Z`. Its newest item arrived at that same moment, and its newest published time was `2026-11-14T06:39:09Z`.
3. Both requests were `x-vercel-cache: MISS`, so the CDN did not cache them.
4. `GET /api/brief` returned `topStories` published on 2026-11-13 and 2026-11-14 only, with empty `movers` and `newEntities`. Its `developments` showed first-observed times of 2026-11-16T19:45Z, so the database held new articles.

The two requests differ only in the `days` parameter. The same code, the same database, and the same minute gave two different answers. The only explanation that fits is a cache keyed on the exact query.

### Cause

Next.js 14 has a Data Cache for `fetch()`. The Neon HTTP driver (`@neondatabase/serverless`) sends every query as a `fetch()` POST. When two queries have identical SQL text and identical parameters, Next.js can return the earlier response. `export const dynamic = "force-dynamic"` does not stop this. `DEVLOG.md` records the same failure for RSS feeds on 2026-04-09.

Queries that include a changing JavaScript value (for example `now`) always differ, so they stay fresh. Queries that use SQL `now()` with constant parameters stay identical, so they freeze. That matches the evidence.

Confidence: high that this is the main cause. Not verified directly: Vercel Hobby keeps runtime logs for only 1 hour, and the environment variable list returned 403, so I could not read the cron history or the secrets.

### Secondary risk to check

`src/lib/server/tick.ts` uses parameterless or constant-parameter queries: `getLastIngestAt` and `tryAcquireLock`. If those are cached, the freshness check and the lock can return wrong answers forever. A frozen "stale" answer makes every tick start an ingest run. A frozen lock result can stop locking or stop ingesting. The ingests seen at 19:45 and 20:39 UTC today point to the first case. Check this after the fix.

### Fix

**Status (2026-11-16):** applied and tested on branch `claude/awesome-maxwell-3ow8y0` (type check clean, 806 tests pass, build passes, and the new test fails without the fix). It is not on `main` yet, so production still shows frozen data. Merging to `main` needs the operator's go.

One line in `src/lib/server/db.ts`:

```ts
return neon(connectionString, { fetchOptions: { cache: "no-store" } });
```

The installed driver (1.1.0) supports `fetchOptions`. Next.js is 14.2.35.

Then:

1. Add a unit test that `getSql` passes `fetchOptions.cache === "no-store"` to `neon`. Mock `@neondatabase/serverless`.
2. Run `npx tsc --noEmit`, `npm test`, and `npm run build`.
3. Merge to `main`. Vercel deploys production from `main`.
4. Verify in production:
   - `GET /api/articles` (no parameters): `lastIngestAt` is within the last 15 minutes of a recent tick, and the newest `updatedAt` equals it.
   - `GET /api/brief`: `topStories` include today's publish dates.
   - Call `/api/tick` twice a minute apart. The second call must return `{"triggered":false,"reason":"fresh"}` or `"locked"`, not start another run.
5. Add a DEVLOG entry that links this finding to the 2026-04-09 entry.

### Related gaps (decide, do not assume)

- The daily cron is too slow for a "real time" feed. On the Hobby plan, use an outside scheduler: a GitHub Actions workflow on a 15-minute cron that calls `POST /api/ingest` with the `x-ingest-key` header. Keep the existing tick as a backup. This needs the operator to approve a new secret in GitHub.
- The header's "last ingest" badge reads `MAX(first_seen_at)`. After the fix it is correct. It still says nothing about feeds that fail. Section 7 covers a feed-health table.

---

## 3. The unmerged redesign branch

`claude/redesign-signals-brief-entities-p4lscw` (head `0113058`) holds work that overlaps this guide. Read `TABS-REDESIGN-PLAN.md` on that branch first.

| Commit | What it adds | Relevance |
|---|---|---|
| Phase 1 | Brief fixes: the "All quiet" bug when only developments or movers exist, a generated-at line, mover counts | Fixes a bug found in this session |
| Phase 2a/2b | `GET /api/developments` with rejection diagnostics. Signals tab becomes Developments | Not needed for the three tabs. Keep |
| Phase 3a | Entities API: sort, `mentions7d`, `sources7d`, stat-tile filters, dossier fields, relation evidence | Needed for the Entities tab |
| Phase 3a follow-up | `classifyEntityRole`: anchor, famous, satellite roles on the entities API | Needed to separate context entities |
| Phase 3b | Entities tab becomes roster and dossier | Overlaps the Entities tab here |
| Phase 4 | Deletes dead client-side modules (-514 lines) | Safe cleanup |

**Decision made 2026-11-16: Path A, merge the whole branch.** It fast-forwards from `main` (main has not moved since 2026-08-21) and passes on a clean copy: type check, 918 tests, build. Merge it after the Phase 0 fix is live. Path B is rejected. Both options are kept below for the record.

- **Path A (recommended):** open a pull request for the redesign branch, review it, merge it, and build this guide on top.
- **Path B:** leave it unmerged and cherry-pick only Phase 3a and its follow-up into the new work.

Do not rebuild the Entities API from scratch. It already exists on that branch.

---

## 4. The core

> Show me what is new in my world, with proof, and let me grow my world with one click.

"My world" means the tracked entities plus their direct neighbors.

The whole platform repeats one loop: collect articles, tag the entities in them, nominate untracked entities, the user decides (Track or Not interested), link entities by co-mention, surface what changed. Every screen serves one step and ends in one verb.

Four numbers to test against. They are targets, not facts. Set the final values from a real test.

- At most 10 items need a decision on the main list.
- 10 seconds to read and decide them.
- 1 click from any claim to its evidence.
- 3 per week: items the operator did not already know. This is the proof gate in `DEVELOPMENTS-PLAN.md`.

Dropped for now: **Quick hits** (the ten-item decision list). Its engine pieces (nomination score, growth) still power the other tabs. Keep the idea in this guide. Do not build the tab.

---

## 5. What to build

Three tabs. The prototype shows all three working on one shared state: tracking an entity anywhere changes every view.

| New tab | Replaces | Notes |
|---|---|---|
| Newsfeed | Feeds | Articles with the entities found in each, and a Track control |
| Entities | Entities | Spreadsheet with growth, diversity, and connection to what you track |
| Entity map | Network and Map | Clusters first, then one cluster, then one entity |

Rules for this phase:

- Add the new tabs. Do not delete Network, Map, Feeds, or the current Entities tab. Mark them deprecated in `MANIFEST.md`. Delete them only after the operator approves.
- Keep every existing API response shape. Add fields. Do not rename or remove them. Check all consumers first (`CLAUDE.md`).
- Everything the screen shows must come from stored data. No mock numbers.

### 5.1 Newsfeed

Intent: see inbound news as it arrives, with every entity in each story marked tracked or not, and add one in a click.

Layout per row (three columns, as in the operator's sketch):

1. Story headline (link) with a small box under it.
2. Source name, source URL, category, arrival time.
3. Entities found, numbered, with a tick for tracked and a "+ Track" button for the rest. Select a name to open the entity popup.

Details:

- **The box** says how the story touches the tracked world: "In your world: A, B" and "Not tracked yet: C". This is a guess at the operator's intent. The operator may want a summary or an image instead. Ask once.
- **Time:** show arrival time first. Show publish time only when it lags arrival by 6 hours or more. This is the honest-time rule in `DESIGN.md`.
- **Filters:** All, Mentions a tracked entity, Has untracked entities, New to us (an entity first seen in 24 hours).
- **Live behavior:** poll for new arrivals every 60 seconds while the tab is visible. Show "N new articles, show" instead of moving the list under the reader. Provide Pause.
- **Rising marker:** show a small ▲ beside an entity name when its growth state is Rising (section 6.1).
- **Entity popup:** type, state, theme, a Track or Stop tracking button, Not interested, "Connection to what you track" (section 6.4), latest evidence, links to Entities and Entity map. Close with Esc. On a phone it becomes a bottom sheet.
- **Honest freshness line** above the list: "Data as of {last ingest}. Next scheduled ingest {time}." Show a stale marker when the last ingest is older than 2 hours.

Empty, loading, and error states are part of the work (`DESIGN.md`). Include "no articles yet", "database not configured", and a failed-load message that says what to do.

### 5.2 Entities

Intent: manage the entity list. Which are growing, which are well sourced, which connect to what I track.

Columns: Entity, Status, Growth (chip and 14-day sparkline), Mentions, Source (diversity chip and top sources), Connection to what you track, Topics.

Sorting by column header. Default sort is Growth. The four sorts the operator asked for:

| Sort | Meaning |
|---|---|
| Tracked | Tracked first, then context entities, then the rest |
| Growth | See section 6.1 |
| Mentions | Count of articles naming the entity |
| Diversity | Count of distinct sources. 3 or more is Multi-source. 1 is Single source and weaker evidence |

Behavior:

- Select a row: open that entity on the Entity map. Enter on the keyboard does the same. Arrow keys move the selection.
- Select a topic name: open that cluster on the map.
- "Track" inline for untracked rows. It must not open the map.
- Filters: name search, All / Tracked / Not tracked / Dismissed.
- Keep the existing pagination and the existing review actions (accept, merge, dismiss). Known bug on `main`: the page-size options are 50, 100 and 250 (`src/components/entities/types.ts`), but `GET /api/entities` rejects `limit` above 200 (`MAX_LIMIT` in `entity-admin.ts`). Choosing 250 returns HTTP 400. Fix the option list to 50, 100 and 200. Do not lose the candidate review queue that exists today. Put it in this tab as a segment, as it is now.
- Do not group by category. The operator struck this out.

Removed from the prototype's earlier versions on purpose: the side panel, the separate sort bar, the "Related to" column. Do not bring them back.

### 5.3 Entity map

Intent: see the whole universe as clusters, open a cluster, open an entity, and see how things connect or fail to connect.

One screen, three levels, and a breadcrumb: Universe, then topic or topics, then entity. Esc goes up one level.

**Universe (the default).**

- Opens collapsed. Each cluster is a numbered circle (entity count). A ▲ count on the label shows how many entities inside are rising. Links between clusters are aggregated, so the picture stays readable at any size.
- Context entities (anchors) show as small dark nodes. A switch hides them: "With context | Without context".
- Select a cluster to open it in place. Its entities appear as nodes inside a soft outline of the same color. Select the cluster label to close it. "Open all" and "Close all" buttons exist.
- Drag any node, any collapsed cluster, or an opened outline (which moves the whole group). "Reset layout" restores the original positions. Dragging must never change the selection. Labels must never block clicks on nodes.
- The side panel shows the numbers: entities, links, islands, and entities not connected to anything, both with and without context. When nothing is selected it lists "Growing fastest". When something is selected it shows that cluster, entity, or link with its evidence.
- Island frames: when the graph has more than one connected group, draw each in a dashed frame. Put isolated items in a band labeled "Not connected to anything".
- Trace a connection: two selectors, From and To. Show the shortest path and one evidence article per hop. Open the clusters on the path automatically and dim everything else. If a path exists only through context entities, say so. If none exists, say the two never appear together.

**Cluster level.** Entities whose main topic is in the selected set, with links among them. A side panel lists them fastest-growing first, with "Also touches" chips that add a neighboring topic, and evidence.

**Entity level.** The entity in the center, its topics as bubbles around it, its linked entities inside the bubbles. Select a topic to open its cluster. Select a linked entity to move to it.

Visual rules (keep):

- Solid ring: tracked. Dashed ring: not tracked. Black: context entity. Color: topic.
- Node size carries no meaning. Growth is the only exception marker: a blue halo and "▲ ×N".
- Line weight is the article count. A blue line means the pair first appeared together in the last 2 days.
- Labels use collision-aware placement: try right, left, above, below and keep the position that overlaps least.

---

## 6. Definitions

Port these as pure functions in `src/lib/` with unit tests. Keep the constants in code, not in settings (`DESIGN.md`, zero configuration).

### 6.1 Growth

Growth compares recent activity with the entity's own usual rate.

```
recentPerDay  = articles naming the entity in the last 72 hours / 3
usualPerDay   = mean articles per day over days 4 to 14 before now
                (use entity_mentions_hourly; floor at 0.3)
ratio         = recentPerDay / max(usualPerDay, 0.3)

state:
  New      untracked entity first seen in the last 72 hours
  Rising   recent articles >= 3 and ratio >= 3
  Falling  usualPerDay >= 0.5 and ratio < 0.5
  Steady   otherwise
```

The prototype used a mock "usual rate" per entity and a seeded history for older days. In production, read both from `entity_mentions_hourly`. The prototype's three-bar and 14-bar sparklines should draw real daily counts.

Show the ratio as "▲ ×N" with N capped at "10+". Do not show a growth state for an entity with fewer than 3 days of history. Show "warming up" instead (honest time).

### 6.2 Diversity

Distinct `source_name` values over the entity's articles in the last 14 days. 1 is Single source. 2 is "2 sources". 3 or more is Multi-source.

### 6.3 Context entities (anchors)

Use the role classification on the redesign branch (`classifyEntityRole`) or `isAnchor` in `developments.ts`. A context entity is never a card subject and never a nomination. It can still appear as a node and in paths.

### 6.4 Connection to what you track

Breadth-first search over `entity_edges`, starting at the entity. Context entities count as hops. Only tracked, non-context entities count as targets. Return up to 3 nearest targets, the path to each, and the hop count. For a tracked entity, show its tracked neighbors instead.

### 6.5 Topics and clusters (open decision)

The prototype hand-tags one topic per article. Real data needs a method. Options:

| Option | Cost | Notes |
|---|---|---|
| A. Graph communities | None | Run label propagation on `entity_edges` over the last 14 days, excluding context entities. Name each cluster after its two highest-mention members. Computed from links, so nothing is configured. Recommended start |
| B. LLM topic per article | Uses the existing monthly budget | Add a `topic` field to the extraction prompt in `llm-extract.ts`. Better names. Needs a controlled vocabulary or a merge step so "Port delays" and "Port congestion" collapse |
| C. Source category | None | Too coarse. Do not use |

**Decision made 2026-11-16: option B, a model-written topic for each article.** Live test on 500 headlines: 39 labels, readable names ("Ukraine-Russia war", "Gaza conflict"), 18% labelled "Other". Option A produced entity-list names ("Iran · U.S. · U.S"). Option C put 70% of entities in one group called "News".

How to build it:

- Add a `topic` to each article. Extend the existing model extraction step in `llm-extract.ts`. Pass the list of existing topic labels back into the prompt so the model reuses a name instead of inventing a near copy. Store it (new column or a small `article_topics` table). This is a migration, so it still needs the operator's approval.
- An entity belongs to every topic where it appears in at least 2 articles in the last 14 days. If none qualifies, it belongs to its single most common topic. One entity can sit in several topics (23 of 167 did in the live test). The earlier rule "one main cluster per entity" is dropped.
- Draw lines between topics from shared entities. Weight links with the cosine rule in section 6.7.
- Articles the model cannot place get "Other". Show them as one grey bubble so the gap is visible.
- Spend: the model step must stay under the existing monthly budget cap. I did not measure dollars. Measure the cost of one day of articles before turning it on.

### 6.6 Scale

The prototype has 24 entities. Production has hundreds of tracked entities and over a thousand pending candidates (`DEVLOG.md`, August 2026). Rules:

- The Universe draws only tracked and non-dismissed entities, plus candidates that link to a tracked entity and rank in the top 150 by link count and source diversity. Cap the node total near 300.
- Never run the force layout on the server for every request. Compute positions in the browser, deterministically, per connected group. Cache by data version.
- The Universe opens collapsed, so the first paint is a few dozen clusters.

### 6.7 Famous entities and duplicate names

Live data on 2026-11-16 (500 headlines, 167 entities named twice or more):

- 99.4% of those entities carry the famous label. Only 1 is a tracked, not-famous entity.
- The top of every list is always the same: Trump, Russia, Ukraine, China, Nvidia. Russia appears under 4 names (Russia, Russland, Russian Federation, and a mis-linked "Fed"). The United States appears as U.S., U.S, US, USA, EE.UU. and VS.
- Famous is a proxy for "always in the news". The product needs the real measure: change against the entity's own normal. Use that measure and the famous-or-not split stops mattering.

Rules:

1. **Rank by change, not volume.** The default sort in the Entities tab, the map side panel, and "Growing fastest" is Growth (section 6.1). Volume and diversity stay as sort options, never the default. An always-present entity such as the United States has a ratio near 1 and drops down the list. A famous entity that spikes still rises.
2. **Famous becomes a label, not a gate.** In the three new tabs, show the famous flag as a small "Context" tag. Do not hide anything because of it. The existing rule "a famous entity never headlines a Development card" stays in the Developments engine. Do not change it.
3. **Map view.** Show entities that are New or Rising, plus their direct neighbours. Draw context entities small and grey. Name clusters by topic (6.5), never by entity names. Weight each link by shared articles divided by the square root of the two entities' article counts (cosine). Two always-present entities then no longer dominate. Live test: the largest cluster fell from 29 entities to 18, and the clusters were more even. It did not remove every odd member ("Harvard University" still joined the Russia cluster).
4. **Duplicates: soft merge first, real merge by a person.**
   - Compute a display-only merge map on the server: two entities merge for display when they have the same type and one name is in the other's alias list, or they share a Wikipedia page. Union their article sets. Show "Russia (+3 names)". Nothing in the database changes, so it is reversible.
   - Never merge in the database automatically. Today a merge cannot be undone (see the 2026-08-21 DEVLOG entry), and the data is wrong in places. In a live check of 106 shared-Wikipedia-page groups, 90 candidate merges passed the alias test, but 2 of 24 sampled were wrong (King Charles II and III are different people). The Wikipedia link itself is wrong for short names: "Fed" points at Russia, "EU" at the United States, "UN" at Great Britain, "Australia" at Dow. Do not merge pairs whose names differ only by a number or roman numeral.
   - Put the suggested merges in a review list in the Entities tab. The operator approves them in batches through the existing candidate review actions. Check `candidate-actions.ts` and `entity-ingest.ts` first. An entity-to-entity merge may need a new endpoint, which needs approval.
5. **Foreign-language sources: keep them.** Test: a rough word-based check marked 172 of 500 headlines (34%) as non-English. Removing them cut entities named twice or more from 167 to 131. It removed only 7 of the 53 entities that share a Wikipedia page with another one (53 to 46). Most duplicates come from English variants (U.S., USA). Dropping them also removes the early foreign-language coverage the product exists to find. If noise stays high after rules 1 to 4, add a Newsfeed view filter (All or English). Do not change ingestion. The language check used is crude. It flagged at least one English headline as foreign. Use a proper detector if the filter is built.

Evidence for rule 1: the last 7 days of hourly counts for four of the biggest entities show them at or below their own usual rate. The ratio of the last 3 days to the earlier 4 was 0.65 for Russia, 0.75 for Ukraine, 0.98 for China, and 0.87 for Nvidia. None of them would be Rising. (Ukraine and Nvidia were copied by hand by a helper agent, so treat those two as less certain. A fifth reading, Trump, showed an impossible jump from 0.3 to 16 a day, so the series looks incomplete. It was not used.)

Acceptance checks for 6.7: with the default sort, the top 10 of the Entities tab does not show an entity whose ratio is under 1.5, unless it is a New entity. Duplicates such as Russia and Russland show as one row. No database row is merged without the operator's approval.

---

## 7. Backend work

All routes are Next.js App Router handlers under `src/app/api/`. Validate every input at the boundary (`CLAUDE.md`). Keep SQL in `src/lib/server/`.

| Need | Work | Notes |
|---|---|---|
| Fix staleness | `db.ts` no-store | Phase 0 |
| Articles with entities | Extend `GET /api/articles` (or add `GET /api/feed`) to return, per article, its entities: id, name, type, status, role | Join `article_entities` and `entities`. Add a `limit` and a `before` cursor. Keep the current response shape for the existing Feeds tab |
| Entity facts | New `entity-facts.ts`: per entity, `mentions`, `recent72h`, `usualPerDay`, `ratio`, `state`, `daily[14]`, `sources`, `firstSeenAt`, `lastSeenAt` | One query over `entity_mentions_hourly` and `article_entities`. Use one population query, not one per entity |
| Entities list | Add growth, diversity, and nearest tracked to `GET /api/entities` | The redesign branch already adds sort and 7-day aggregates. Extend it |
| Graph | New `GET /api/graph` returning nodes (id, name, type, status, role, clusterId, state, ratio), edges (a, b, articleCount, firstSeenAt), and clusters | Apply the caps in 6.6. Include counts for islands with and without context |
| Path | Compute in the browser from the graph payload, or add `GET /api/connection?from=&to=` | The browser option needs no new route |
| Clusters | `entity-clusters.ts` and the `entity_clusters` table | Phase 4. Needs approval |
| Track and Not interested | Existing: `PATCH /api/entities/[id]` and `POST /api/candidates` | Verify first how names move from `entity_candidates` to `entities`. Read `entity-ingest.ts` and `candidate-actions.ts`. The Newsfeed must show one consistent state for a name |
| Feed health | Optional new table for per-feed last success, last failure, typical gap | Needed for a "blind spots" view. Not in this phase |
| Ingest cadence | Outside scheduler | See section 2 |

Pitfalls recorded in `DEVLOG.md` that bite here:

- Do not interpolate a JavaScript value inside `INTERVAL '...'`. The Neon driver fails silently. Use `make_interval(days => ${n}::int)`.
- The Neon HTTP driver cannot connect to a plain local Postgres. Integration tests that need a real database run in CI only. Tests that need `TEST_DATABASE_URL` are skipped locally.
- Many integration fixtures use real country names. The fame gate suppresses them. Use fictional names.

---

## 8. Build order

Each phase ends with passing `npx tsc --noEmit`, `npm test`, `npm run build`, a DEVLOG entry, and a UI check with Playwright route interception (`DESIGN.md`).

| Phase | Work | Done when |
|---|---|---|
| 0 | Staleness fix (section 2) | Production shows data from the last tick. Tick stops re-running |
| 1 | Resolve the redesign branch (section 3) | Operator has chosen A or B. The chosen work is on `main` |
| 2 | Pure functions: growth, diversity, nearest tracked, shortest path, label placement | Each has unit tests, including empty and single-article cases |
| 3 | Newsfeed tab, API changes, popup | Rows show real entities with working Track. Filters work. New-article pill works. Empty, loading, and error states exist |
| 4 | Entities tab changes, then clusters (6.5) | Four sorts work on real data. Row select opens the map. Topics link to clusters |
| 5 | Entity map: Universe, cluster, entity, drag, trace | The checks in section 9 pass on real data |
| 6 | Cleanup, only with approval | Old tabs deprecated or removed. `docs/prototype/` deleted. `MANIFEST.md` and `README.md` updated |

Do not start phase 3 before phase 0 works. Without it, every screen shows frozen data and you cannot judge your work.

---

## 9. Acceptance checks

Run these on production-like data, not the prototype.

1. **Fresh data.** A new article in a feed appears in the Newsfeed within one ingest cycle. The header time matches.
2. **Evidence.** Every entity, link, topic, and growth claim reaches its articles in one click.
3. **Honest time.** Arrival time leads. Publish lag of 6 hours or more is flagged. A stale system shows a stale marker.
4. **Track propagates.** Track an entity in the Newsfeed popup. Its chip, its Entities row, its map node, and its cluster count all update with no reload.
5. **Growth is exceptional.** At most about 10 percent of entities show Rising on a normal day. If more do, the threshold is wrong. Tune the constants in code and re-test.
6. **Universe is readable.** The collapsed Universe has no overlapping circles and no overlapping labels. Open all stays usable with the node cap.
7. **Islands are honest.** The island counts match a direct count on `entity_edges`, with and without context.
8. **Drag.** Dragging a node, a cluster, and an outline works with a mouse. Dragging never selects. Reset layout restores the first layout exactly.
9. **Trace.** For a known pair, the path matches a hand check. For an unconnected pair, the message says so.
10. **Phone.** No horizontal scroll at 400 px. The popup becomes a bottom sheet. State what you could not test, such as touch dragging.
11. **Both themes.** Check light and dark.

---

## 10. Open decisions to put to the operator

1. ~~Redesign branch~~ Decided: path A (section 3).
2. ~~Topic method~~ Decided: option B. Still needs approval for the migration that stores article topics (6.5).
2b. Duplicate and context handling: the plan in 6.7. Approve the soft-merge approach and the review list.
3. The Newsfeed box under each headline: a "how it touches your world" note, or a summary, or an image?
4. An outside ingest scheduler (15 minutes) and a new GitHub secret?
5. Delete the old Network, Map, and Feeds tabs once the new ones pass? Delete only after a yes.
6. The proof gate (3 catches a week) has no place to record results. The triage deck that would have recorded it was dropped. Measure by hand, or add a small decision log?
7. Persons appear as one entity type among others. No profiling pages are planned. Confirm.

---

## 11. Prototype map

File: `docs/prototype/radar-sketch.html`. One file, plain JavaScript, no build step. Open it in a browser. Also published (private) at https://claude.ai/artifact/PaTaVUjVGzoTfChvxF6BJD. Read it with the Artifact tool if the file is missing.

Port the logic. Rewrite the UI in the repo's React and Tailwind. Delete the prototype when the build ships.

| Behavior | Prototype function |
|---|---|
| Entity facts, growth, sparkline | `growth`, `spark`, `facts` |
| Nearest tracked entity, shortest path | `nearestTracked`, `shortestPath` |
| Co-mention graph | `derive` |
| Clusters-first units, edges, layout | `netUnits`, `netEdges`, `forceUnits`, `netLayout` |
| Label placement | `placeLabels`, `labelText` |
| Rendering the Universe | `netInner`, `networkSvg`, `networkPanel` |
| Dragging | the `pointerdown`, `pointermove` handlers near the end of the script |
| Cluster and entity levels | `clusterSvg`, `clusterPanel`, `entitySvg`, `entityPanel`, `mapModel` |
| Newsfeed rows and popup | `drawNewsfeed`, `drawPop`, `connHtml` |
| Entities table and sorts | `drawEntities`, `CMP`, `SORT_INFO` |

What the prototype does not prove:

- Real-data scale (24 entities, 37 articles, 3 days).
- Touch dragging.
- Topic quality. Its topics are hand-tagged.
- Whether the growth thresholds suit real data.

---

## 12. Rules that still apply

- `CLAUDE.md`: every line is a liability. Delete before adding. State changes and assumptions before editing. Re-read files before editing more than two. Max 50 lines per function. No shared mutable state between modules. Treat all external input as untrusted. No new dependencies without a stated reason. Run tests after changes. Add a DEVLOG entry after each task.
- `DESIGN.md`: the four spine rules (surface the non-obvious, evidence one click away, zero configuration, honest time). Own the empty, loading, and error states of any screen you touch. Verify UI by driving it, not by looking at it.
- The current plan documents forbid new feeds, migrations, and deletions without operator approval. This guide asks for approval where it needs it (section 10).
- Do not add probability words ("likely", "very likely") to any screen. The system can measure how well a claim is sourced. It cannot judge how likely the claim is.
- No new dependencies are needed. The prototype uses none.

---

## 13. How to run the work: delegate in parallel

The lead session plans, decides, and verifies. Cheaper agents do the execution. This cuts time and cost.

- Send each independent task to its own agent, all in one message so they run in parallel. Use the cheapest model that can do the task. Use Haiku for mechanical work. Use Sonnet for work that needs judgment.
- Use an isolated worktree for any agent that edits files, so agents do not overwrite each other.
- Give each agent a complete brief: the goal, the exact files, the contract it must keep, the checks to run, and what to report. The agent knows nothing else.
- Do not delegate decisions, operator questions, merges, or pushes to `main`. Do not delegate a task that depends on another task's output until that output exists.
- Verify every agent result yourself: read the diff, run `npx tsc --noEmit` and `npm test`. A report is a claim, not proof.

Safe to run in parallel after Phase 2 (no shared files):

| Task | Agent | Output |
|---|---|---|
| Pure functions with unit tests: growth, diversity, nearest tracked, shortest path | Haiku, worktree | Files in `src/lib/` and tests |
| `entity-facts.ts` and its tests | Sonnet, worktree | Server module and tests |
| `GET /api/graph` route and tests | Sonnet, worktree | Route and tests |
| Newsfeed tab UI | Sonnet, worktree | Components and hook |
| Entities tab UI changes | Sonnet, worktree | Components and hook |
| Playwright checks for each tab | Haiku | Scripts and a pass or fail list |
| Live-data checks against production | Haiku | Short report |

Merge the worktrees one at a time. Run all checks after each merge.
