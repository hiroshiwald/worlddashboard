# HANDOFF-PROMPT.md

Rewritten 2026-11-16, after the operator approved the staleness fix, the redesign branch (Path A), topic option B, and the noise plan. Paste the block below into a new session. Delete this file when the build ships.

Paste this:

```text
Check out branch claude/awesome-maxwell-3ow8y0. Read HANDOFF-PROMPT.md and BUILD-GUIDE-INTERFACE-V2.md at the repo root, then do the work in "Your job" in HANDOFF-PROMPT.md. The operator already decided the items under "Decisions made". Do not ask those again.
```

---

## What you are building

You build the next interface for worlddashboard (Next.js 14, Neon Postgres, Vercel Hobby plan). The design is finished and the operator approved it. You build it on live data.

> Show me what is new in my world, with proof, and let me grow my world with one click.

Three new tabs: **Newsfeed**, **Entities**, **Entity map**. No Quick hits tab.

## The operator

The operator is not technical. Write every message to them in plain English with short sentences. When you ask for a decision, give each option a cost and a benefit, say which one you recommend, and show it with live data where you can. Ask for all pending decisions in one message. Do not use jargon without defining it. Do not use em dashes. Do not write "X, not Y" sentences.

## Read first, in this order

1. `CLAUDE.md`. Follow every rule. Add a DEVLOG entry after each task.
2. `DESIGN.md`. Read it before any UI work.
3. `BUILD-GUIDE-INTERFACE-V2.md`. This is your spec. Sections 5 to 8 define the tabs, formulas, backend work, and phases. Section 6.7 is the noise plan. Section 13 is how to delegate.
4. `docs/prototype/radar-sketch.html`. Open it in a browser. It shows the target behavior with fictional data. Port the logic. Do not copy its mock data.

## State of the project on 2026-11-16

| Item | State |
|---|---|
| Stale-dashboard fix (`getSql` uses `cache: "no-store"`) | On `main` as commit `1396acf`. Vercel was building it when this was written. Verify it is live (Step 1). |
| Redesign branch `claude/redesign-signals-brief-entities-p4lscw` | Not merged. 9 commits, 62 files. Fast-forwards from the pre-fix `main`. Passes type check, 918 tests, build. Merge it with the operator's go (Step 2). |
| Docs branch `claude/awesome-maxwell-3ow8y0` | Holds this file, the guide, and the prototype. Not on `main`. |
| Daily cron | Once a day only (Hobby plan). See open decision 1. |

## Decisions made (operator, 2026-11-16)

1. Apply the staleness fix. Done, on `main`.
2. Path A: merge the whole redesign branch.
3. Topics: option B, a model-written topic for each article (guide 6.5). Storing topics needs a migration. Ask the operator for approval right before you add it.
4. Noise plan (guide 6.7), approved: sort by change not volume, show "famous" as a small "Context" label and never hide an entity because of it, soft-merge duplicates for display and let the operator approve real merges in batches, keep foreign-language sources.

## Still open (ask in one message when you reach it, with a recommendation)

| # | Question | Recommendation | Needed by |
|---|---|---|---|
| 1 | Run ingest every 15 minutes with an outside scheduler (a GitHub Actions job that calls `/api/ingest`)? Needs a new GitHub secret. Without it, "real time" means once a day plus what the tick triggers. | Yes | Before Newsfeed ships |
| 2 | Newsfeed box under each headline: a "how it touches your world" note, a summary, or an image? | The note | Phase 3 |
| 3 | The proof gate (3 genuine catches a week) has no place to record results. Count by hand, or add a small decision log? | By hand for now | Phase 5 |
| 4 | Delete the old Network, Map and Feeds tabs after the new ones pass? | Only after the operator says yes | Phase 6 |
| 5 | Persons appear as one entity type among others. No profiling pages. Confirm. | Confirm | Phase 3 |

## Your job

### Step 1: confirm the fix is live

- Check the latest production deployment is Ready and built from `1396acf` (Vercel MCP `list_deployments`).
- `GET https://worlddashboard.vercel.app/api/articles` with no parameters must show a `lastIngestAt` from the last day. It showed 2026-11-14 before the fix.
- Call `/api/tick` twice, a minute apart. It must not start two ingest runs.
- The sandbox blocks direct `curl` to the production site (HTTP 403). Use the Vercel MCP `web_fetch_vercel_url` tool. Large responses are saved to a file. Read them with Python, not inline.
- Report the result to the operator in plain English.

### Step 2: merge the redesign branch

Ask the operator for a go. Then fast-forward `main` to the branch (or open a pull request, whichever the operator prefers). After the deploy, spot-check Brief, Developments, and Entities on production.

### Step 3: build the rest, in this order

Follow guide section 8. Each phase ends with `npx tsc --noEmit`, `npm test`, `npm run build`, a DEVLOG entry, and a Playwright check with route interception.

| Phase | Work | Run in parallel |
|---|---|---|
| 2 | Pure functions in `src/lib/` with unit tests: growth and diversity (6.1, 6.2), nearest tracked and shortest path (6.4), soft merge (6.7 rule 4), topic membership (6.5), label placement and layout port from the prototype | One Haiku agent per function group, each in a worktree |
| 3a | Backend: `entity-facts.ts`, `GET /api/feed` (articles with their entities, with a cursor), `GET /api/graph` (with the node cap in 6.6), additions to `GET /api/entities` | One Sonnet agent per module, after Phase 2 merges |
| 3b | Topic storage: migration, extraction change in `llm-extract.ts` (reuse existing topic labels in the prompt), refresh at the end of each ingest run. Measure the model cost of one day of articles first | One Sonnet agent. Needs operator approval for the migration |
| 4 | UI: Newsfeed tab, Entities tab changes (including a "Suggested merges" segment), Entity map (Universe, cluster, entity, drag, trace) | One Sonnet agent per tab, after Phase 3 merges |
| 5 | Checks from guide section 9, on live data | Haiku agents for Playwright scripts and live-data checks |
| 6 | Retire old tabs, delete `docs/prototype/`, `HANDOFF-PROMPT.md`, stale `DEVELOPMENTS-PROMPT-1.md`, update `MANIFEST.md` | Only with the operator's yes |

## How to work

You lead. Cheaper agents execute.

- Plan the work, then send independent tasks to parallel agents in one message. Use Haiku for mechanical tasks and Sonnet for tasks that need judgment.
- Use an isolated worktree for any agent that edits files. Merge worktrees one at a time and run all checks after each merge.
- Give each agent a full brief: goal, exact files, the contract it must keep, the checks to run, and what to report. The agent knows nothing else.
- Keep decisions, operator questions, merges, and pushes to `main` for yourself.
- Verify every agent result by reading the diff and running the checks. A report is a claim, not proof.
- Do not let an agent print large API responses into its own context. Tell it to read saved files with Python.

## Facts learned from live data (use them)

- `GET /api/entities` accepts `limit` from 1 to 200. The Entities tab offers 250 rows per page (`PAGE_SIZE_OPTIONS` in `src/components/entities/types.ts`), so that option returns HTTP 400. Fix it to 200.
- 1,617 entities are tracked. 99.4% of the entities named in today's headlines are marked famous. The top of any volume list is always Trump, Russia, Ukraine, China, Nvidia.
- Duplicates are common: Russia, Russland, Russian Federation; U.S., U.S, US, USA, EE.UU., VS. Some names are wrong: "Democratic" is mapped to the DR Congo, "Repubblica" (a newspaper) is typed as a country, "CISA" points to a French village.
- Wikipedia page links are wrong for short names ("Fed" points to Russia, "EU" to the United States, "UN" to Great Britain). Never merge in the database by shared page alone. A merge cannot be undone today.
- Option B live test: a small model gave 39 topic labels to 500 headlines. 18% got "Other". One entity can sit in several topics.
- Growth test: Russia, Ukraine, China, and Nvidia all ran at or below their usual rate (ratios 0.65 to 0.98) over the last 7 days. A Trump reading showed an impossible jump. Treat that series as suspect.
- Redesign branch Developments cards on live data are far better than the old Signals rows ("Emerging link: Australia + MasterChef").
- The operator saw live-data mock-ups at https://claude.ai/artifact/RUsH1wsLi6U7iMCqhiETS2 (private; read it with the Artifact read action).

## Rules you must not break

- Add new tabs. Do not delete old tabs, feeds, migrations, or files without an explicit yes from the operator.
- Keep existing API response shapes. Add fields only.
- Show no mock numbers. No probability words.
- No new dependencies without a stated reason.
- No database row is merged without the operator's approval.
- Stop after 3 failed attempts at the same problem. Report what you expected and what happened.
- Do not push to `main` without the operator's go.

## Report back

When a phase ends, say in plain English: what changed, what you checked, what you could not check, and what you need from the operator.

## Progress log

Read DEVLOG.md entries dated 2026-11-16 and 2026-11-17 for detail. State on 2026-11-17:

- `main` = `20ba496` (Phase 4 tabs, topics code, merged growth). Migration 009 is applied (operator ran it in Neon). Ingest GitHub workflow re-enabled by the operator.
- Work branch `claude/laughing-wozniak-gkhavi` is ahead of `main` with: growth scaled to collection volume, Newsfeed matching fixes, the activity off switch (`/api/activity`, header button, `activity_paused` setting, ingest job treats paused as success), hidden tabs (Brief, Feeds, Developments; code kept), Newsfeed Ignore, Entities "Ignored" wording.
- Next: check the branch preview (growth top list, Newsfeed), then push to `main` (operator approved these features). Then confirm an ingest run writes `articles.topic` and `/api/graph` returns clusters.
- Open: duplicate rows still list separately in Entities (spec 6.7 wants one row per merge group). Map trace has no per-hop evidence. November LLM usage is 6 calls vs 129 in October; cause not checked. Off switch does not gate `/api/sources` or user-triggered Wikidata calls.
- Operator decisions made 2026-11-17: hide old tabs except Network and Map; build share-of-mentions growth; budget cap $10; off switch; Ignore with a listable, reversible Ignored filter.
- Rules learned: get data before choosing a fix (two growth guesses were wasted). Test mocks route SQL by substring; give new queries a unique alias. Helpers over 150k tokens: split the work smaller.

### Update 2026-11-17 (later session), branch `claude/modest-mendel-vvxklr`

- Done, not on `main`: keyless Esri map tiles; `GET /api/emerging` (new names next to famous/anchor entities); Entity map Universe now groups new names by anchor, with a "New near known" panel; Newsfeed matches tracked names and aliases at read time; extraction folds possessives, handles accented names, prompt asks for every named person and for broad 1 to 3 word topics.
- Checked: tsc, 1223 tests, build. `/api/emerging` on the preview returned 200 anchored items. The map rendered with live data through route interception.
- Not checked: Esri tiles in a real browser (the sandbox blocks the host). Newsfeed on live data.
- Next: operator checks the preview, then pushes to `main`. Anchors are mostly countries; rank person and company anchors first if the operator wants a "near Sam Altman" view. Universe stats box still shows the old With/Without context table.

### Update 2026-11-17 (end of session), branch `claude/modest-mendel-vvxklr` = `main`

- On `main`: anchor ranking (people/companies first, places last), publisher removed from Newsfeed headlines, headline translation (migration 010 applied by operator), Entity map discovery (packed bubbles coloured by anchor kind, name card with context, headlines, Track/Ignore), emerging name hygiene, November catch-up.
- LLM gap cause: GitHub "Hourly ingest" did not run 2026-10-31 to 2026-11-17. Re-enabled; run 1999 was fine.
- Catch-up: `src/lib/server/backfill.ts`, window Nov 10 to 16 only. `GET /api/backfill` shows `{remaining, estimatedUsd}`. Delete the file, its call sites in `entity-ingest.ts` and `src/app/api/backfill` when remaining = 0.
- SKIPPED, revisit with operator: Nov 1 to 9 catch-up. Full Nov 1 to 16 window was 11,355 articles, estimated $7.38 (300 in / 200 out tokens per article, batch rates) against the $10 monthly cap with $0.66 spent. To run it: set BACKFILL_FROM to 2026-11-01 after the Nov 10 to 16 run ends, ideally in December or with a higher cap.
- Open: 32 of 106 feeds fail in ingest (not checked). Motion on the Entity map not checked in a real browser. Esri map tiles not checked in a real browser.

### Open decision 2026-11-17: what "tracked" means
- Fact: ingest creates every new dictionary hit and every LLM "famous" name with `status = 'tracked'` (`classifyCandidate`, `entity-ingest.ts` ~:259-263). So 1,625 "tracked" rows are mostly system-added. Robert Pattinson was added this way. No column records which rows the operator chose.
- Proposed fix (needs operator yes + migration 011): `entities.followed BOOLEAN NOT NULL DEFAULT false`. Only the operator's Track sets it. UI "tracked"/"In your world" reads `followed`; status 'tracked' stays as "known to the system" so growth, graph and map keep working.
- In flight at handoff: helper building Entity map single-view force graph (react-force-graph-2d, as in NetworkTab); helper removing the Newsfeed blue left border and fixing header search for the Newsfeed. Merge each to the branch, run tsc/tests/build, Playwright check, then push to `main` (operator approved pushes for this work).
