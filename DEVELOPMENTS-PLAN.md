# DEVELOPMENTS-PLAN.md — First Slice: Development Cards in Brief

This is the active implementation plan. It supersedes RADAR-STRATEGY.md §7–§8
on scope: that document's roadmap levels, source expansion, and surface
deletions are future context, not current work.

## 1. Scope statement

We are only refining the current news dashboard. AI/Medical/Alpha radars are
future portability paths, not current scope. They influence exactly one thing
here: the development model and scoring stay domain-neutral (pure functions,
no news-specific constants baked into signatures) so the engine could be
pointed at another corpus later. Nothing else — no new feeds, no new routes,
no navigation changes, no migrations, no repo changes.

## 2. Problem statement

The dashboard overvalues high-volume obvious entities and low-utility
surfaces. Movers, watchlist, map markers, and graph nodes are all
volume-ranked, so Russia/Trump/China headline everything — exactly what a
headline-scanner already knows. The directed relations the pipeline extracts
are rendered nowhere. The goal of this slice: surface evidence-backed
developments — lower-frequency satellite entities and new relationships
around the big anchors — and see whether that makes Brief more useful than
the feed itself.

A development is: satellite entity + anchor context + relation/reason +
evidence + time context.

## 3. First slice

The smallest implementation that can prove or kill the idea:

- **Read-only.** Development cards are computed at request time from existing
  tables (`entities`, `entity_candidates`, `entity_relations`, `entity_edges`,
  `entity_mentions_hourly`, `articles`, `article_entities`). No migration.
  No new tables. Cards are recomputed per request; their time context
  (first/last seen) comes from the underlying rows, which already persist —
  so no thread storage is needed to have honest timelines.
- **One new server module** (`src/lib/server/developments.ts`): SQL panels +
  pure scoring/eligibility functions, following the `detectors.ts` pattern
  (panels separated from testable pure functions).
- **One additive API change:** `getBrief` gains a `developments` array in its
  JSON. Existing Brief consumers are unaffected.
- **One new Brief section** rendering the cards, placed at the top of Brief.
- No new sources, no new products, no repo split, no deletions, no new
  dependencies, no settings.

Why read-only works: anchor/satellite classification is computable at query
time from `entity_mentions_hourly` baselines plus entity type;
`entity_candidates` already carries anchor context (`co_entities`),
corroboration (`source_names`, `day_count`), and role phrases (`contexts`);
relations and edges carry arrival-based `first_seen_at`/`last_seen_at`.

Two known costs of skipping a migration, both accepted for the proof:

- Candidates have no article FK, so candidate-card evidence is resolved by
  exact `sample_titles` → `articles.title` matching, constrained to the
  candidate's `source_names` and a narrow time window (§6). A card whose
  evidence cannot be resolved unambiguously is suppressed. If the slice
  proves value, proper evidence linking is the first follow-up migration.
- Candidate `first_seen_at`/`last_seen_at` are news-time (`rollupCandidate`
  in `entity-ingest.ts` accumulates by `effectiveAt` = publish date when
  known), not arrival time. They are therefore usable only as a
  matching/search window. A candidate card's observed times are derived from
  the `articles.first_seen_at` of its matched evidence rows (§6).

Card subjects come from four read-only sources, strongest first:

- **R** — a recent typed directed relation (`entity_relations`) where one
  endpoint is an anchor and the other a satellite. Rare today (relations
  require both endpoints tracked) but highest value; label `observed`.
- **N** — a tracked satellite first seen within the window (existing
  new-entity logic, bootstrap-guarded), with anchor context joined from its
  articles' co-entities. Label `observed`.
- **C** — a candidate satellite clearing the corroboration bar (≥2 distinct
  sources AND ≥2 distinct days) with an anchor in `co_entities`. Label
  `observed`. Candidate timestamps are news-time and serve only as the
  evidence search window; observed times come from matched articles (§6).
- **E** — a recent undirected edge (`entity_edges`, ≥2 articles) between an
  anchor and a satellite, when no typed relation exists. Label `pattern`
  (derived from co-coverage, not a stated relation).

## 4. DevelopmentCard v0 shape

```ts
interface DevelopmentCardJson {
  subjectName: string;      // the satellite — never an anchor
  subjectType: string;      // 15-type ontology value (or candidate type_hint)
  anchorNames: string[];    // 1–3 anchors providing context
  relationOrReason: string; // "sanction (stated relation)" |
                            //   "recurring co-coverage with Russia" | role phrase
  whyShown: string;         // one plain sentence derived from scoreParts
  label: "observed" | "pattern"; // "hypothesis" reserved; v0 never emits it
  firstObservedAt: string;  // arrival-based, always. R/N/E: from the row's
                            //   own first_seen_at. C: min(articles.first_seen_at)
                            //   over matched evidence — never candidate timestamps.
  lastObservedAt: string;   // same derivation, max side
  staleReporting: boolean;  // true when newest evidence publish date
                            //   lags first-observed by >7d
  evidence: EvidenceArticleJson[]; // 1–5; card suppressed if 0 resolve
  score: number;
  scoreParts: {             // kept in JSON for the operator; rendered compactly
    novelty: number; corroboration: number; persistence: number;
    relationStrength: number; anchorContext: number; penalty: number;
  };
}

interface EvidenceArticleJson {
  title: string; link: string; sourceName: string;
  publishedAt: string | null; // feed-claimed, null if unknown — never fabricated
  firstSeenAt: string;        // when we observed it
}
```

## 5. Ranking rules

**Anchor definition (computed per request, no stored flag):** an entity is an
anchor if its type is `country` or `region`, OR its trailing 14-day mention
baseline (from `entity_mentions_hourly`, the same panel the detectors use)
puts it in the top decile of tracked entities. Constants live in code with
tests, not in settings.

**Hard eligibility filters (before any scoring):**

- Subject is not an anchor. No exceptions — anchors appear only in
  `anchorNames`.
- ≥2 distinct sources. Single-source claims never become cards.
- ≥1 resolvable evidence article. No evidence, no card.
- Not in the bootstrap cohort (reuse `isBootstrapCohort`); system past
  warm-up (reuse `computeWarmupState`).
- Underlying first_seen (entity, relation, or edge) within the last 14 days.

**Score (pure function, weighted sum of parts):**

- Novelty: recency of first_seen — newer is higher, decaying over the window.
- Corroboration: distinct source count (capped so volume can't dominate).
- Persistence: distinct days seen (`day_count` for candidates; span for
  entities/relations) — recurring beats one-day burst.
- Relation strength: stated typed relation (R) > new tracked entity (N) >
  corroborated candidate (C) > co-coverage edge (E); relation types weighted
  (sanction/supply/acquisition/regulation/legal_action above statement_about).
- Anchor context: having a resolved anchor raises the score; the anchor's own
  volume never does.
- Penalty: subject's own 14-day volume above a satellite ceiling (an entity
  drifting into anchor territory scores down); `staleReporting` scores down.

Raw mention count is not a ranking input. It appears only as the anchor/
ceiling classifier and inside the capped corroboration part.

## 6. Evidence/time rules

- Every card links 1–5 evidence articles; a card whose evidence resolves to
  zero articles is suppressed, not rendered bare (spine #2).
- Evidence resolution: R uses `evidence_article_id` plus the two-entity
  article intersection; N/E use `article_entities`. C matches each of the
  candidate's `sample_titles` exactly against `articles.title`, constrained
  to the candidate's `source_names` and a narrow time window around its
  seen-window — no broad display-name matching. If no exact, unambiguous
  match resolves (zero hits, or one title matching conflicting articles
  beyond normal cross-source duplicates), the card is suppressed.
- `firstObservedAt`/`lastObservedAt` are arrival-based (migration 003
  semantics) and are labeled in the UI as "first observed" — never
  "happened" (spine #4). For R/N/E cards they come from the underlying row's
  own arrival-based timestamps. For C cards they are derived as
  min/max of `articles.first_seen_at` over the matched evidence rows;
  candidate `first_seen_at`/`last_seen_at` are news-time, are used only as
  the matching window, and are never rendered or labeled as observed time.
- `publishedAt` is shown per evidence article when known, null never faked.
  When the newest evidence publish date lags the card's first-observed date
  by more than 7 days, the card shows a "older reporting, newly observed"
  marker (`staleReporting`) instead of implying freshness.
- Warm-up: during `computeWarmupState` active, the section shows the same
  honest empty state pattern Brief movers already use ("baselines forming,
  N days remaining"). Empty-but-warm shows "no qualifying developments in the
  last 14 days" — an honest zero, not a hidden section.

## 7. UI changes

Brief only. One new section at the top of `BriefTab`: up to 8 development
cards, each showing subject (headline), type badge, anchor chips, relation/
reason line, whyShown sentence, first-observed/last-observed times, the
stale-reporting marker when set, and an expandable evidence list (reusing the
existing `EvidenceExpander` pattern from the signal cards). Score parts render
compactly (e.g., a tooltip/summary line) for operator judgment.

Everything else stays: Feeds, Signals, Network, Map, Review, EntityPanel are
untouched. No tab is added, removed, or renamed. Movers and the existing
Brief sections remain as-is in this slice — replacing them is a later
decision made only if development cards prove more useful.

## 8. Test plan

Pure-function unit tests for eligibility + scoring (synthetic fixtures, the
`scoreSurge` testing pattern), plus a `getBrief` test asserting the additive
JSON shape and zero-evidence suppression.

**Good fixtures (must produce cards, satellite as subject):**

- Lower-frequency company, 3 sources / 3 days, co-entity Russia, sanction
  relation → high score, label observed, anchor chip "Russia".
- Infrastructure node (port), 2 sources / 2 days, edge to shipping-disruption
  anchor → card, label pattern.
- New legal actor (person, obscure), 2 sources, co-entity Trump,
  legal_action relation → card; Trump appears only as anchor.
- Disease entity seen across health + travel sources (category spread) →
  card with corroboration boost.
- New typed relation between famous anchor and specific satellite → card
  headlined by the satellite, relation named.

**Bad fixtures (must NOT produce cards, or must be demoted/flagged):**

- "Russia surge" alone → ineligible (subject is anchor).
- "Trump mentioned in 30 articles" → ineligible (anchor; volume is not a
  reason).
- "OpenAI top entity" → ineligible (top-decile baseline ⇒ anchor).
- Single-source claim → ineligible (corroboration floor).
- Old article presented as fresh → eligible only with `staleReporting: true`
  and scored down; UI marker asserted.
- Card with no resolvable evidence → suppressed.
- Candidate whose `sample_titles` have no exact match in `articles` (or an
  ambiguous match) → suppressed, even if corroboration clears the bar.
- Candidate card must derive observed times from matched
  `articles.first_seen_at`, not from candidate timestamps → asserted with a
  fixture where the two diverge (publish date days before arrival).
- Generic topic word (type `other`, no relation, no anchor context) →
  ineligible.

Both suites run in the existing Vitest setup; existing tests stay green.

## 9. Explicit non-goals

- No AI Radar implementation, navigation, or AI-specific feeds.
- No Medical Radar implementation or medical feeds.
- No Alpha Radar features, ticker/market mapping, or trading language.
- No source expansion of any kind.
- No repo split, no new app, no new routes.
- No broad deletion: Network/Map/watchlist/cascade-graph stay until
  explicitly approved otherwise.
- No large settings/configuration UI — all thresholds are code constants
  with tests.
- No thread persistence tables yet: cards are recomputed read-only. If the
  slice proves value, an append-only update log is the first approved
  follow-up; building it before proof is overbuilding.
- No migrations. (If implementation hits a wall that truly requires one, stop
  and explain why the read-only version cannot work before writing it.)

## 10. Acceptance criteria

Reviewable, all-or-nothing:

1. Brief renders a Developments section with up to 8 cards when data
   qualifies; every card shows all §4 fields and at least one working
   evidence link.
2. Zero cards headlined by an anchor: no country/region subject, no
   top-decile-baseline subject. Enforced in code; asserted by unit tests;
   spot-checkable in the running app.
3. All bad fixtures in §8 rejected/flagged by tests; all good fixtures pass;
   full existing suite green.
4. `git diff` shows: no migrations, no changes to `sources-data.json`, no
   new dependencies in `package.json`, no deleted components, no new tabs.
5. Honest time verified in the running app: first-observed labels, warm-up
   empty state, stale-reporting marker on at least one synthetic case.
6. A card with unresolvable or ambiguous evidence never renders, and no
   card's observed times derive from candidate news-time timestamps (both
   verified by test).
7. DEVLOG.md updated with the implementation entry.
8. Proof-of-value gate (after ~2 weeks of live use): the operator can point
   to ≥3 cards/week that surfaced something a headline scan of Feeds did not.
   That judgment — not more features — decides whether thread persistence
   and any surface changes get planned next.
