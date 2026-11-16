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

## Step 0: fix the stale dashboard first

The dashboard shows data from 2026-11-14. The database is fresh. Next.js caches the Neon HTTP queries that have identical text. Details and evidence are in section 2 of the guide.

1. In `src/lib/server/db.ts`, change `neon(connectionString)` to `neon(connectionString, { fetchOptions: { cache: "no-store" } })`.
2. Add a unit test for it.
3. Run `npx tsc --noEmit`, `npm test`, `npm run build`.
4. After it deploys to production, check that `/api/articles` (no parameters) shows a recent `lastIngestAt`, and that two `/api/tick` calls one minute apart do not both start an ingest run.
5. Add a DEVLOG entry.

Production deploys from `main`. Ask the operator before you merge or push to `main`.

## Then

1. Ask the operator the two blocking questions in section 3 and section 10 of the guide: what to do with the unmerged branch `claude/redesign-signals-brief-entities-p4lscw` (path A or B), and how to name topics (A graph communities, B model-labelled topics, C source category). The operator has seen live-data mock-ups of both questions at https://claude.ai/artifact/RUsH1wsLi6U7iMCqhiETS2 (private; read it with the Artifact read action). Their answers may already be in the conversation. Do not ask again if they are.
2. Follow the phases in section 8 of the guide. Finish and verify each phase before the next.
3. Use real data in every UI check. Use Playwright route interception for states you cannot get live.

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
