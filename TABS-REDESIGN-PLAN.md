# TABS-REDESIGN-PLAN.md — Signals → Developments, Brief honesty, Entities dossier

Review packet per FABLE-ROADMAP §9. Scope: the Signals, Brief, and Entities
tabs only. This document defines WHAT; DESIGN.md governs HOW; CLAUDE.md
governs code discipline.

## 1. Product decision (§9.1)

**Primary user/job:** the single operator reading the dashboard daily. The
job is: *"show me what changed that I could not have seen by scanning
headlines, let me drill to the evidence, and let me tell the system I've
seen it."* Every change below serves that job.

**Vertical scope:** World Radar only. No AI/Medical/Alpha work, no new
sources, no repo split.

**The diagnosis** (from a full audit of all three stacks, 2026-09-01):

- **Signals tab** is a flat inventory of raw detector firings. Its "Promote"
  action is a dead end — no code anywhere consumes `state='promoted'`. A
  signal's `first_detected_at` is fetched and never rendered; the detector
  math (z-score, baselines, deltas) is captured in `evidence` JSONB and
  never shown; there is no type/severity filter; moment-type signals
  silently vanish after 7 quiet days with no warning; the 72h dismiss
  cooldown is invisible. Meanwhile the far richer developments engine
  (`developments.ts`, the product's actual unit of value) renders only as
  Brief's top-8 digest — there is no surface where the operator can see the
  full eligible set.
- **Brief** leads correctly with developments but has honesty gaps: the
  `isEmpty` check ignores `developments` and `movers` (a brief with only
  those renders "All quiet" — a live bug); `generatedAt` is fetched and
  never rendered; movers show a bare `×4.2` multiplier with the observed
  and baseline counts hidden; the top-8 cap is invisible; score breakdowns
  exist only in a hover tooltip.
- **Entities tab** is a registry chore, not a radar roster: fixed
  `ORDER BY id ASC`, no sort controls, no activity data (no last-seen, no
  mention/source counts, no trend), and — the biggest confusion — the tab
  shows only the raw Wikidata `fame` column while the system's real
  fame/anchor decision (`isFamous`: stored OR dictionary OR breadth OR
  volume; `isAnchor`: type OR baseline percentile) is invisible, so an
  entity labeled "Emerging" can be silently suppressed everywhere as
  famous. `EntityPanel` omits every fame field, and its Relations list
  drops `evidence_article_id` — a claim with no evidence link, a direct
  spine #2 violation.

**The decision — three distinct, non-overlapping value propositions:**

1. **Brief** = the 60-second morning read. A digest that leads with
   developments and is honest about when it was generated, what it shows,
   and what it caps.
2. **Signals tab becomes the Developments tab** (FABLE-ROADMAP §6's
   recommended nav: Brief / Developments / Evidence / Entities). Default
   segment: the full, filterable inventory of development cards — uncapped,
   score-visible, with an honest diagnostics line explaining what was
   rejected and why. Second segment: the raw detector signals, kept as the
   engine-room view, made explainable (first-detected, detector math,
   expiry/cooldown honesty) and with the dead-end "Promote" repurposed as
   "Watch" — watched signals sort first here and in Brief, giving the one
   stored ack loop a real meaning.
3. **Entities** = the radar roster + dossier. The tracked table gains
   activity columns and sort; the system's real classification (Anchor /
   Satellite, with the *reason*) is exposed instead of hidden; EntityPanel
   becomes the full dossier: fame verdict with its Wikipedia evidence,
   aliases, activity summary, relations *with their evidence article*, and
   connection recency.

## 2. Design-spine check (§9.2)

**Brief**
- Non-obvious: unchanged (developments lead). Movers gain their observed vs
  baseline counts — the deviation is the point, so show the deviation.
- Evidence: unchanged (cards/expanders).
- Zero config: nothing configurable added.
- Honest time: `generatedAt` rendered; the `isEmpty` bug fixed so content
  is never falsely reported quiet; the top-8 cap named ("Top 8 · see all in
  Developments").

**Developments tab (né Signals)**
- Non-obvious: the whole eligible development set, not just top-8; the
  diagnostics line surfaces what the engine rejected (no-evidence,
  single-source, anchor-subject, famous-subject counts) so an empty state
  explains itself instead of looking broken.
- Evidence: every card keeps its 1–5 evidence links; signal cards keep the
  article expander and gain the detector's own numbers (z, baseline,
  delta, category counts) — the math behind the claim, one click away.
- Zero config: filters (label, source kind, state, severity, type) are view
  controls over an already-computed set, not behavior settings. Nothing the
  user sets changes what the system watches or detects.
- Honest time: "first detected X ago" on signal cards; "state since X" once
  acted on; moment-type cards state their 7-quiet-day expiry; dismissed
  cards state the 72h re-fire cooldown. Development cards keep
  first/last-observed.

**Entities**
- Non-obvious: Role column (Anchor / Satellite) with the reason the system
  believes it — the classification that governs every downstream surface,
  currently invisible. Activity columns show deviation-relevant facts
  (7-day mentions · sources, last seen) rather than raw lifetime volume as
  a ranking.
- Evidence: relations in EntityPanel link their `evidence_article_id`
  (spine #2 fix); the fame verdict shows its Wikipedia evidence (title,
  sitelinks, monthly pageviews, checked-when); edges show since-when.
- Zero config: sort headers and clickable stat tiles are view controls;
  accept/dismiss remains the only teaching interaction.
- Honest time: Last-seen column; "checked X ago" moves into the panel next
  to the verdict it qualifies; edge first-seen shown as "since <date>".

## 3. Entity/noise plan (§9.3)

Engine semantics are **unchanged** — no scoring, eligibility, suppression,
or ranking rule changes in this slice. What changes is exposure: the
Entities tab stops hiding the anchor/satellite/famous classification the
engine already computes. Anchors are labeled as context ("never headlines a
card"); satellites as promotable. The Developments tab's diagnostics line
makes the famous/anchor suppression visible as counts, so "why isn't X
showing" has an answer.

## 4. Development/thread model (§9.4)

Read-only, unchanged. Developments remain per-request computations with no
stored identity. **Thread storage is explicitly deferred** per FABLE-ROADMAP
§14c — it needs its own slice with a migration and a "what has been seen"
design; this plan does not back into it. The one stored state that exists
today (the signals state machine) gets its dead end fixed: `promoted` is
relabeled "Watch" (DB value unchanged, no migration) and watched signals
sort first in the tab and in Brief's signals section. Observed vs pattern
labels are unchanged; nothing emits "hypothesis".

## 5. Evidence model (§9.5)

- Development cards: unchanged (1–5 resolved articles, zero-evidence cards
  suppressed; publish time and first-seen time distinct).
- Signal cards: article expander unchanged; adds the per-type detector
  numbers already stored in `evidence` JSONB. Missing/aged-out articles
  already degrade honestly (dropped at resolution).
- Relations in EntityPanel: `evidence_article_id` joined and rendered as a
  link when the article is still retained; when aged out, the relation
  renders without a link (the row's `article_count`/`last_seen_at` still
  shown) — absence is shown, not faked.

## 6. Implementation scope (§9.6)

No migrations. No new dependencies. No new tabs (one renamed). All API
changes additive. Server work lands before the UI that consumes it.

**Phase 1 — Brief honesty (UI + hook only).**
Files: `src/components/BriefTab.tsx`, `brief/BriefMoversSection.tsx`,
`brief/BriefNewEntitiesSection.tsx`, `brief/BriefSignalsSection.tsx`,
`brief/BriefDevelopmentsSection.tsx`, `src/hooks/useBriefTab.ts`.
Changes: fix `isEmpty` (include developments + movers); render
`generatedAt`; movers show observed24h and baselineDaily; new-entity chips
show type; promoted-first ordering within severity groups plus a "watching"
chip; "Top 8" cap label. Not touched: any server file, `/api/brief`.

**Phase 2a — Developments API (server).**
Files: new `src/app/api/developments/route.ts` (+ tests),
`src/lib/server/developments.ts` (additive: optional card cap override;
rejection tally by eligibility reason returned alongside cards),
`src/lib/server/brief.ts` untouched (keeps its own cap).
Contract: new GET endpoint `{developments, diagnostics, warmup,
generatedAt}`; `getDevelopments` signature gains an optional options arg.
Query cost: identical panels to the Brief path (the engine already computes
all drafts before capping); one request-time invocation, cache headers as
`/api/brief`. Runtime stays far under the 60s ceiling (§14b).

**Phase 2b — Developments tab (UI).**
Files: `src/components/SignalsTab.tsx` (renamed/recomposed),
`src/components/signals/*` (filters, card additions, relabel),
`src/components/HeaderBar.tsx`, `src/components/dashboard/TabContent.tsx`,
`src/components/DashboardTable.tsx`, `src/hooks/useDashboardTable.ts`
(TabKey `"signals"` → `"developments"`), new hook for the developments
fetch, a shared `DevelopmentCard` extracted from
`BriefDevelopmentsSection` (score parts become a visible expandable, not
hover-only). Segments: Developments (default) | Signals.

**Phase 3a — Entities API (server).**
Files: `src/app/api/entities/route.ts`, `src/app/api/entities/[id]/route.ts`,
`src/lib/server/entity-admin.ts` (+ tests).
Contract (all additive): list mode gains `sort`
(`name|first_seen|last_seen|activity`, default `last_seen` desc) and
per-page activity aggregates (`mentions7d`, `sources7d`, `lastSeenAt`) plus
per-page role classification (`role: anchor|satellite` + reasons, reusing
`fame.ts`/`developments.ts` helpers — never duplicating their thresholds);
stats-tile filters (`fameChecked=never`, `fameLocked=true`, parked ≡
existing `status=dismissed`); detail endpoint gains the fame block
(`fame`, `fameLocked`, `wikiTitle`, `wikiSitelinks`,
`wikiPageviewsMonthly`, `fameCheckedAt`), `aliases`, a 30-day activity
summary (`mentions30d`, `sources30d`), relations gain
`evidence: {title, link} | null`, edges gain `firstSeenAt`.
Query cost note: list mode adds ~3 bounded queries per request (page-id
aggregates + two percentile population queries); detail adds 1. All
read-only, Neon-safe.

**Phase 3b — Entities tab (UI).**
Files: `src/components/entities/*` (EntitiesTable, EntityRow, StatsStrip,
ControlsRow, types), `src/components/EntityPanel.tsx`,
`src/hooks/useEntitiesTab.ts`.
Changes: columns become Name · Role · Type · Status · Fame · Activity (7d)
· Last seen · First seen, with sort headers; the "Checked" column moves
into the panel; Parked/Never-checked/Locked tiles become filters;
EntityPanel gains the fame/evidence block, aliases, 30-day summary,
relation evidence links, edge since-dates with a "new" badge (first seen
≤7d). Review-queue segment: unchanged except candidate first/last-seen
already fetched gets rendered in the Counts cell.

**Phase 4 — cleanup + docs.**
Verify-then-delete dead client code flagged in DEVLOG 2026-07-22
(`useEnrichedEntities.ts` and its now-caller-less transitive dependencies
— delete only what a fresh grep proves has zero callers). DEVLOG.md entry
per phase; MANIFEST.md rows updated.

**Test plan:** every server change gets route/unit tests (existing vitest
conventions); pure functions (role classification, sort mapping, detector
evidence formatting) get unit tests; UI verified by dev server + Playwright
route interception (this repo's sanctioned pattern — `.tsx` is not
vitest-transformable here); `tsc --noEmit`, full `npm test`, `next build`
green per phase.

**Rollback:** each phase is an independent revert; API changes are additive
so no consumer breaks on revert.

## 7. Complexity budget (§9.7)

Deleted/demoted: the dead `promoted` semantics (replaced, not extended);
the Entities "Checked" column; hover-tooltip-only score parts; dead
client-side signal-enrichment modules (phase 4); raw-`id` ordering as the
default entity sort. New abstractions: one shared `DevelopmentCard`
component (replacing a private copy), one developments fetch hook, one
route. No new dependency, no migration, no setting. What would make this
too large: touching detector/scoring semantics, thread storage, or
Network/Map — all excluded.

## 8. Repo split assessment (§9.8)

Keep one repo. Nothing here is domain-specific; no split trigger from §8.2
is true.

## Out of scope (binding)

Detector/scoring/eligibility changes; thread persistence (§14c); Network/
Map tabs; Review-queue mechanics beyond rendering already-fetched fields;
new sources; LLM spend changes; migrations; new dependencies.
