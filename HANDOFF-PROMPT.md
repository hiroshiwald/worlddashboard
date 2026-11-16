# HANDOFF-PROMPT.md

Paste the text between the lines into a new session at the repo root. Delete this file after the build ships.

---

You build the next interface for worlddashboard (Next.js 14, Neon Postgres, Vercel Hobby). The design work is done. You build it on live data.

## Read first, in this order

1. `CLAUDE.md`. Follow every rule. Add a DEVLOG entry after each task.
2. `DESIGN.md`. Read it before any UI work.
3. `BUILD-GUIDE-INTERFACE-V2.md`. This is your spec and build order.
4. `docs/prototype/radar-sketch.html`. Open it in a browser. It shows the target behavior with fictional data. Port its logic. Do not copy its mock data.

## Goal

> Show me what is new in my world, with proof, and let me grow my world with one click.

Build three tabs: **Newsfeed**, **Entities**, **Entity map**. Do not build Quick hits.

## Decisions already made by the operator (2026-11-16)

1. Apply the staleness fix. It is already written and tested on branch `claude/awesome-maxwell-3ow8y0` (`src/lib/server/db.ts` plus `src/lib/server/__tests__/db.test.ts`). It is not on `main` yet.
2. Path A: merge the whole redesign branch `claude/redesign-signals-brief-entities-p4lscw`. It fast-forwards from `main` and passes type check, 918 tests, and build.
3. Topics: option B, a model-written topic for each article (guide section 6.5). Storing topics needs a migration. Ask the operator before you add it.
4. Proposed, not yet approved: the plan for famous entities and duplicate names in guide section 6.7. Rank by change, show "famous" as a label only, soft-merge duplicates for display, and keep foreign-language sources. Ask the operator to confirm it before you build the map.

## Step 0: get the stale-dashboard fix live

The dashboard shows data from 2026-11-14. The database is fresh. Next.js reuses saved answers for identical Neon queries. Details and evidence are in section 2 of the guide.

1. Check the fix on the branch: `npx tsc --noEmit`, `npm test`, `npm run build`.
2. Ask the operator for a go to merge it to `main`. Production deploys from `main`. Do not merge or push to `main` without that go.
3. After it deploys, check that `/api/articles` (no parameters) shows a recent `lastIngestAt`, and that two `/api/tick` calls one minute apart do not both start an ingest run.
4. Then merge the redesign branch (Path A) the same way, with the operator's go.

## Then

1. Follow the phases in section 8 of the guide. Finish and verify each phase before the next.
2. Use real data in every UI check. Use Playwright route interception for states you cannot get live.
3. The operator saw live-data mock-ups of the topic and branch choices at https://claude.ai/artifact/RUsH1wsLi6U7iMCqhiETS2 (private; read it with the Artifact read action). Do not ask those questions again.

## How to work

You lead. Cheaper agents execute. Plan the work, then send independent tasks to parallel agents in one message. Use Haiku for mechanical tasks and Sonnet for tasks that need judgment. Use an isolated worktree for any agent that edits files. Give each agent a full brief: goal, files, contract, checks, and what to report. Keep decisions, operator questions, merges, and pushes to `main` for yourself. Verify every agent result by reading the diff and running the checks. Section 13 of the guide lists tasks that are safe to run in parallel.

## Rules you must not break

- Add new tabs. Do not delete old tabs, feeds, migrations, or files without an explicit yes from the operator.
- Keep existing API response shapes. Add fields only.
- Show no mock numbers. No probability words.
- No new dependencies without a stated reason.
- Stop after 3 failed attempts at the same problem. Report what you expected and what happened.
- Write short, plain sentences in all docs, comments, and replies.

## Report back

When a phase ends, say: what changed, which files, what you checked, what you could not check. State untested items plainly.
