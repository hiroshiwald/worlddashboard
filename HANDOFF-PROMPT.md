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

## Progress log (build session, 2026-11-16)

Work branch: `claude/laughing-wozniak-gkhavi`. It holds `main` + the redesign branch + these docs. `main` is unchanged.

- Step 1 done: production runs `1396acf`; `lastIngestAt` is current; `/api/tick` returned `fresh` twice.
- Found: `.github/workflows/ingest.yml` (every 30 min, secret `INGEST_SECRET` already set) is `disabled_inactivity` since 2026-10-31. Re-enabling it answers open decision 1.
- Found: LLM extraction est. ~$14/month vs the $5 cap (`llm_monthly_budget_usd`), so tagging likely stops mid-month. Estimate only; check `llm_usage` in production.
- Step 2: merged on the work branch, checks pass. Waiting for the operator's go to push to `main`.
- Phase 2 done: `src/lib/{entity-growth,entity-paths,soft-merge,topic-membership,map-layout}.ts`.
- Phase 3a: done `entity-facts.ts`, `GET /api/feed`, `GET /api/entities/merges`. In flight: `GET /api/graph`, new fields and sorts on `GET /api/entities`.
- Phase 3b: not started. Proposed migration 009: `ALTER TABLE articles ADD COLUMN topic TEXT;` plus index `(topic, first_seen_at) WHERE topic IS NOT NULL`. Est. +$0.06/day. Needs operator approval.
- Operator questions 1 to 7 were sent in chat, with no answer yet: push to main, re-enable ingest job, Newsfeed box, proof count, persons, topic migration, budget cap.
- Helper worktrees start from `main`. Each brief must start with `git fetch origin claude/laughing-wozniak-gkhavi && git reset --hard FETCH_HEAD` and a node_modules symlink.
