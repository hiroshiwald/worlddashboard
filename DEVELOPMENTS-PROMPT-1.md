# DEVELOPMENTS-PROMPT-1.md — Implementation Prompt Packet (L1A + L1B)

Prompts for a code model implementing the first slice defined in
DEVELOPMENTS-PLAN.md. Two sequential tasks. Run L1A first; review it against
its checklist; merge; then run L1B. Do not run them together.

Each prompt is self-contained but the implementing model must still read
CLAUDE.md, DESIGN.md, and DEVELOPMENTS-PLAN.md before writing code.

---

## Shared scope rules (verbatim in both prompts)

- Current news dashboard only. Brief only.
- Read-only: no migrations, no new tables, no schema changes.
- No new sources; do not touch `src/lib/sources-data.json`.
- No AI Radar, Medical Radar, or Alpha Radar work of any kind.
- No repo split, no new app, no new routes.
- No deletions of existing tabs, components, or modules.
- No new dependencies; do not touch `package.json`.
- No new settings; all thresholds are code constants with tests.
- Only touch the files listed in your task. If the task seems to require
  touching anything else, STOP and report why instead of proceeding.
- If a stated fact about the codebase turns out to be wrong, STOP and
  report the discrepancy. Do not improvise around it.
- After 3 failed attempts at the same problem, STOP and report your
  diagnosis (CLAUDE.md "When Stuck").
- Append a DEVLOG.md entry when done (date, what changed, what it
  affected, gotchas).

---

## Prompt L1A — server: development cards + scoring + additive getBrief

```
TASK

Implement read-only "development cards" on the server and expose them as an
additive `developments` field on getBrief. A development card surfaces a
lower-frequency "satellite" entity around a high-volume "anchor" entity,
with linked evidence and honest observation times.

Read first: CLAUDE.md, DESIGN.md, DEVELOPMENTS-PLAN.md (the spec you are
implementing), src/lib/server/brief.ts, src/lib/server/detectors.ts (the
code patterns to follow), src/lib/server/__tests__/brief.test.ts and
detectors.test.ts (the test patterns to follow).

FILES YOU MAY CHANGE — NOTHING ELSE

- NEW  src/lib/server/developments.ts
- NEW  src/lib/server/__tests__/developments.test.ts
- EDIT src/lib/server/brief.ts (add the field; call the new module)
- EDIT src/lib/server/__tests__/brief.test.ts (assert the additive shape)
- EDIT DEVLOG.md (append entry)

Explicitly forbidden: migrations/, src/lib/sources-data.json, package.json,
any React component or hook, detectors.ts, signal-store.ts,
entity-ingest.ts, llm-extract.ts.

DATA FACTS (verified; if any turn out false, STOP and report)

- articles: id, title, link, source_name, source_category, source_tier,
  summary, published_at (nullable news time, never fabricated),
  first_seen_at (arrival time = when this system observed it),
  dup_group_id (NULL = cluster head). Articles older than 30 days are
  deleted by retention.
- entities: id, canonical_name, type (15-type ontology), status
  ('candidate'|'tracked'|'dismissed'), aliases, first_seen_at,
  last_seen_at — both ARRIVAL-based.
- article_entities: (article_id, entity_id) join.
- entity_mentions_hourly: (entity_id, bucket, mentions, source_count,
  sentiment_sum) — buckets are news-time.
- entity_edges: undirected co-occurrence (entity_a < entity_b),
  first_seen_at/last_seen_at ARRIVAL-based, article_count.
- entity_relations: directed typed relations (source_id, target_id,
  relation, first_seen_at, last_seen_at, article_count,
  evidence_article_id nullable) — timestamps ARRIVAL-based.
- entity_candidates: name_norm, display_name, type_hint, first_seen_at,
  last_seen_at, mention_count, source_names[] (cap 10), day_count,
  sample_titles[] (cap 3), contexts[] (cap 3), co_entities[] (cap 5).
  WARNING: candidate first_seen_at/last_seen_at are NEWS-time (publish
  date when known), NOT arrival time. Use them ONLY as a search window.
  Never render or label them as observed time.
- Warm-up: import computeWarmupState from ./detectors. getBrief already
  computes it; developments must be [] while warm-up is active.
- DB access: the Sql tagged-template type from ./db, same as brief.ts.
  Unit tests mock Sql exactly as brief.test.ts does.

OUTPUT SHAPE

Export these types from developments.ts:

interface EvidenceArticleJson {
  title: string;
  link: string;
  sourceName: string;
  publishedAt: string | null;  // never fabricate; null when unknown
  firstSeenAt: string;         // articles.first_seen_at (arrival)
}

interface DevelopmentCardJson {
  subjectName: string;
  subjectType: string;
  anchorNames: string[];            // 1-3, always at least 1
  relationOrReason: string;
  whyShown: string;
  label: "observed" | "pattern";
  firstObservedAt: string;          // arrival-based, see derivation rules
  lastObservedAt: string;
  staleReporting: boolean;
  evidence: EvidenceArticleJson[];  // 1-5; card suppressed if 0
  score: number;
  scoreParts: {
    novelty: number; corroboration: number; persistence: number;
    relationStrength: number; anchorContext: number; penalty: number;
  };
}

Export: getDevelopments(sql: Sql, now?: Date): Promise<DevelopmentCardJson[]>
plus every pure function (isAnchor, eligibility checks, score functions,
whyShown builder) individually, for unit testing.

ANCHOR CLASSIFIER (pure function)

isAnchor(type, baselineDaily, anchorThreshold): entity is an anchor when
type is 'country' or 'region', OR baselineDaily >= anchorThreshold.
anchorThreshold = max(3, 90th percentile of baselineDaily across tracked
entities with any mentions in the trailing 15 days). baselineDaily uses
entity_mentions_hourly over the trailing 15 days excluding the last 24h,
divided by effective baseline days (import computeEffectiveBaselineDays
from ./detectors — do not reimplement).

CARD SOURCES (window = trailing 14 days)

R — stated relation (label "observed", strongest):
  entity_relations with first_seen_at in window, both endpoints tracked,
  exactly one endpoint an anchor; the non-anchor is the subject. Evidence:
  evidence_article_id plus articles containing both entities
  (article_entities self-join, cluster heads only), cap 5.
  firstObservedAt/lastObservedAt = the relation row's own timestamps.
  relationOrReason = "<relation> (stated relation)".

N — newly tracked satellite (label "observed"):
  entities status='tracked', first_seen_at in window, NOT an anchor,
  excluding the bootstrap cohort (same guard as brief.ts loadNewEntities:
  first_seen_at >= min(tracked first_seen_at) + 72h). Anchors = tracked
  anchor entities co-occurring in the subject's cluster-head articles;
  require >=1 anchor or the card is ineligible. Evidence = the subject's
  cluster-head articles, newest first, cap 5. firstObservedAt/
  lastObservedAt = the entity row's own timestamps.
  relationOrReason = "first observed around <anchor>".

C — corroborated candidate (label "observed"):
  entity_candidates with last_seen_at within window (window check only —
  news-time), day_count >= 2, >= 2 distinct source_names, and >= 1
  co_entities name resolving to a tracked anchor entity.
  EVIDENCE (strict): match each sample_titles[] value EXACTLY against
  articles.title, constrained to source_name IN source_names AND
  COALESCE(published_at, first_seen_at) between candidate first_seen_at
  minus 2 days and last_seen_at plus 2 days. Resolve matches to their
  cluster head (dup_group_id). A title whose matches resolve to more than
  one distinct cluster is ambiguous — discard that title's matches.
  If no matched articles remain, SUPPRESS the card. No display-name or
  fuzzy matching of any kind.
  firstObservedAt/lastObservedAt = min/max articles.first_seen_at over the
  matched evidence rows — NEVER the candidate row's timestamps.
  relationOrReason = contexts[0] when present, else
  "recurring alongside <anchor>".

E — co-coverage edge (label "pattern", weakest):
  entity_edges with first_seen_at in window, article_count >= 2, both
  endpoints tracked, exactly one endpoint an anchor, excluding the edge
  bootstrap cohort (see detectors.ts loadGlobalMinFirstSeen pattern).
  Evidence: articles containing both entities (the detectors.ts
  loadEdgeArticles pattern), cap 5. firstObservedAt/lastObservedAt = the
  edge row's own timestamps.
  relationOrReason = "recurring co-coverage with <anchor>".

ELIGIBILITY (hard filters, applied before scoring, all sources)

- Subject is not an anchor. No exceptions.
- >= 2 distinct evidence source names (single-source never becomes a card).
- >= 1 resolved evidence article (else suppress).
- >= 1 anchor in anchorNames.
- Warm-up inactive; bootstrap cohorts excluded as specified per source.

SCORING (pure function over per-card inputs; no SQL inside)

- novelty = exp(-ageDays / 7), ageDays measured from firstObservedAt to now.
- corroboration = min(distinctSources, 5) / 5.
- persistence = min(distinctDays, 5) / 5 (C: day_count; others: distinct
  UTC days across evidence firstSeenAt values).
- relationStrength: R with relation in (sanction, supply, acquisition,
  investment, regulation, legal_action) = 1.0; other R relations = 0.8
  except statement_about/other = 0.5; N = 0.6; C = 0.5; E = 0.35.
- anchorContext = min(anchorCount, 3) / 3 * 0.5.
- penalty = 0.5 if staleReporting, plus 1.0 if the subject's own
  baselineDaily >= anchorThreshold / 2 (drifting into anchor territory).
- score = 3*relationStrength + 2*novelty + corroboration + persistence
  + anchorContext - penalty.

staleReporting = true when (firstObservedAt - newest evidence publishedAt)
> 7 days; false when no evidence has a publish date.

Raw mention count must not appear as a score input anywhere.

ASSEMBLY

- Dedupe across sources by normalized subject name; keep the card with the
  highest relationStrength (R > N > C > E).
- Sort by score descending, ties by firstObservedAt descending. Cap at 8.
- whyShown: one plain sentence built from the parts, e.g. "First observed
  4 days ago, reported by 3 sources over 2 days, linked to Russia by a
  stated sanction relation." Pure function, unit-tested.

WIRE INTO getBrief

- Add `developments: DevelopmentCardJson[]` to the Brief interface in
  brief.ts. Compute alongside the existing Promise.all work; skip (empty
  array) while warmup.active, like movers. Keep getBrief's existing
  behavior byte-identical otherwise — this is an additive change.

TESTS (Vitest, existing patterns; all must pass with npm test)

Pure-function unit tests, good fixtures (must produce cards, satellite as
subject):
1. Low-frequency company, 3 sources / 3 days, anchor Russia, sanction
   relation -> eligible, high score, label "observed", anchor chip Russia.
2. Infrastructure entity, 2 sources / 2 days, edge to a shipping anchor ->
   eligible, label "pattern".
3. Obscure person, 2 sources, anchor Trump, legal_action relation ->
   eligible; Trump is in anchorNames, never the subject.
4. Disease entity evidenced across health + travel sources -> eligible.
5. New relation famous-anchor -> specific satellite -> card subject is the
   satellite.

Bad fixtures (must be ineligible, suppressed, or flagged):
6. Russia (type country) as subject -> ineligible.
7. High-baseline entity (baselineDaily above threshold) as subject ->
   ineligible, regardless of mention count.
8. Single-source subject -> ineligible.
9. Old reporting: newest publish date 10 days before firstObservedAt ->
   eligible only with staleReporting=true and penalty applied.
10. Zero resolvable evidence -> suppressed.
11. Candidate whose sample_titles have no exact match, or an ambiguous
    match (one title resolving to two distinct clusters) -> suppressed.
12. Candidate observed times must come from matched articles'
    first_seen_at: fixture where candidate news-time timestamps differ by
    days from matched arrival times; assert card uses arrival values.
13. Generic term (type_hint 'other', no anchor in co_entities) ->
    ineligible.

getBrief tests (mock Sql, brief.test.ts pattern):
14. Response includes developments: [] during warm-up.
15. Response shape is additive: all pre-existing fields unchanged.

ACCEPTANCE

- npm test fully green, including all existing tests.
- git diff touches only the five files listed.
- No migrations, no new dependencies, no settings, no deleted code paths.
- Functions <= 50 lines; pure scoring separated from SQL panels;
  TypeScript strict; comments follow existing file style.
- DEVLOG.md entry appended.
```

---

## Prompt L1B — UI: Developments section in Brief

```
TASK

Render the `developments` array (added to getBrief by L1A) as the first
section of the Brief tab, with honest empty/warm-up states. UI only; the
server work is already merged.

Read first: CLAUDE.md, DESIGN.md, DEVELOPMENTS-PLAN.md sections 4, 6, 7;
src/components/BriefTab.tsx; src/components/brief/BriefMoversSection.tsx
(warm-up state pattern); src/components/signals/ManagedSignalCard.tsx
(evidence expander pattern — read it, do not modify it);
src/hooks/useBriefTab.ts; src/lib/theme.ts.

FILES YOU MAY CHANGE — NOTHING ELSE

- NEW  src/components/brief/BriefDevelopmentsSection.tsx
- EDIT src/components/brief/index.ts (export it)
- EDIT src/components/BriefTab.tsx (render it first, above movers)
- EDIT src/hooks/useBriefTab.ts (extend BriefData with the
  developments field and its card/evidence types, mirroring the server
  JSON shape from src/lib/server/developments.ts)
- EDIT DEVLOG.md (append entry)

Explicitly forbidden: any src/lib/server/ file, any signals/ component,
any other tab, sources-data.json, package.json, migrations/.

RENDER SPEC (per card)

- Headline: subjectName with a small subjectType badge. The subject is
  always the satellite — never bold/feature an anchor name.
- Anchor chips: anchorNames (1-3), visually secondary to the subject.
- relationOrReason line, then whyShown sentence.
- Times: "first observed <timeAgo>", "updated <timeAgo>" from
  firstObservedAt/lastObservedAt. Use src/lib/date-utils timeAgo. Never
  use the word "happened"; these are observation times.
- staleReporting=true renders a visible marker: "older reporting, newly
  observed".
- label renders as a small tag: "observed" or "pattern".
- Evidence: collapsed by default; expander button ("N sources") opens the
  list. Each item: title (link, opens in new tab), sourceName, publish
  date when non-null, and observed timeAgo. Follow the ManagedSignalCard
  expander interaction pattern; implement locally in the new component,
  do not import from signals/.
- score/scoreParts: render compactly for the operator (e.g. score to one
  decimal in a muted corner; scoreParts in the title attribute). Do not
  build any visualization.

STATES (all required, DESIGN.md owns this)

- Warm-up (data.warmup.active): section header plus the same honest line
  BriefMoversSection uses ("warming up — N days remaining"); no cards.
- Empty (warm-up over, zero cards): "No qualifying developments in the
  last 14 days." Do not hide the section.
- Loading/error/db-unconfigured: BriefTab already handles these globally;
  add nothing new.
- Section order in BriefTab: Developments, then movers, signals, new
  entities, top stories. Do not otherwise change existing sections.

STYLE

- Use getThemeClasses(dark) like the sibling brief sections; both themes.
- Semantic markup: the card list is a <ul>; expander is a <button> with
  aria-expanded.
- Match the file layout, naming, and comment style of the existing brief/
  components. Keep every function under 50 lines.

TESTS

- Any non-trivial logic (e.g. a formatting or grouping helper) goes in a
  pure function with unit tests. Keep the component itself thin.
- npm test fully green including all existing tests.
- Verify in the running app (npm run dev): a populated state, the
  warm-up state, and the empty state (temporarily stub the fetch if
  needed to see each; remove stubs before committing).

ACCEPTANCE

- git diff touches only the five files listed.
- All render-spec fields present on a populated card; all three states
  reachable and honest.
- No new dependencies, no settings, no server changes, no deletions.
- DEVLOG.md entry appended.
```

---

## Reviewer checklist (operator, per task)

L1A:
- [ ] Diff limited to the five listed files; no migrations, deps, settings.
- [ ] Candidate evidence is exact sample_titles matching with source +
      window constraints; ambiguous/zero matches suppress the card.
- [ ] Candidate observed times derived from matched articles'
      first_seen_at (test #12 present and passing).
- [ ] No anchor ever appears as a card subject (tests #6-#7).
- [ ] Raw mention count absent from scoring inputs.
- [ ] getBrief unchanged except the additive field; brief tests green.

L1B:
- [ ] Diff limited to the five listed files; server untouched.
- [ ] Satellite is the headline; anchors are secondary chips.
- [ ] Evidence one click away; publish vs observed times both shown;
      stale-reporting marker works.
- [ ] Warm-up and empty states render honestly; section never hidden.
- [ ] Both themes render correctly; expander accessible.
