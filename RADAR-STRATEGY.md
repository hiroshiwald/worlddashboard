# RADAR-STRATEGY.md — Planning Packet

## ⚠️ STRATEGIC CONTEXT ONLY — DO NOT IMPLEMENT FROM THIS DOCUMENT

This document is the analysis appendix behind FABLE-ROADMAP.md.
FABLE-ROADMAP.md owns product direction; where the two disagree,
FABLE-ROADMAP.md wins.

**The only active implementation plan is `DEVELOPMENTS-PLAN.md`.**

Current scope (operator direction, 2026-07-20) is the existing news
dashboard only. Nothing in this document authorizes implementation. In
particular, do NOT implement from here:

- AI Radar, Medical/Bio Radar, or Alpha Radar in any form.
- Source expansion of any kind (no AI feeds, no medical feeds).
- Navigation or product-surface changes.
- Migrations, new tables, or schema changes.
- Repo splits, new apps, or new routes.
- Surface deletions (Network, Map, watchlist, cascade-graph all stay).

The roadmap in §7 and the surface decisions in §8 are deferred future
context and require explicit operator approval before any of it becomes
work. This document exists to explain *why* the development model is shaped
the way it is — nothing more.

Planning output only. No code changes are proposed for this PR. This packet is
written to be critiqued by a second reviewer before any implementation, per
FABLE-ROADMAP.md §9–10. It narrows FABLE-ROADMAP.md's breadth into concrete
proposals; FABLE-ROADMAP.md remains the governing direction (see the note at
the top of this document).

Everything here is grounded in the codebase as of this branch. File references
are real paths; claimed capabilities and gaps were verified by reading the code.

---

## 1. Executive recommendation

**Direction: one app, one engine, developments as the unit of value.**
Evolve worlddashboard from "six ways to look at feeds" into a radar whose core
output is the **development**: a lower-frequency satellite entity + its anchor
context + a typed relationship + linked evidence + a timeline. The engine is
domain-neutral; domains (World, AI, later Bio) are source lists + ranking
weights + ontology extensions, not separate products or repos.

**First wedge: AI Radar as a domain mode inside the current app** — but only
after a small engine slice proves the development object on data already
flowing. AI is the first wedge not because it is the best business (it is the
most crowded, lowest willingness-to-pay audience imaginable) but because it is
the cheapest, fastest, highest-signal test of the strategic hypothesis:

- The builder is the first user (daily dogfooding, no customer discovery).
- Source availability is the best of any domain (arXiv, HF, GitHub, lab blogs
  — all free RSS/Atom; expansion is a JSON edit to `src/lib/sources-data.json`).
- The pipeline already extracts the discriminating field: `prominence`
  (famous/known/obscure) flows through `src/lib/server/llm-extract.ts` and
  `extract-v2.ts` in production today — it is currently used once (the famous
  auto-accept gate in `entity-ingest.ts`) and then thrown away.
- A kill verdict arrives 3–4 weeks after Level 2 starts (§7 defines the
  Level-1 exit criteria; §10 defines the gates), measurable with existing
  tables.

If the anchor/satellite wedge fails in AI — with perfect dogfooding conditions
— it fails everywhere. If it works, the engine transfers to Bio, where the
willingness to pay is proven (BioPharmCatalyst-class subscribers pay
$1,000–2,500/yr for exactly this shape of product) but the entry cost and
trust bar are higher.

**Do NOT build first:**

- Real-time breaking alerting — dead end (see §2b).
- Generic market intelligence — dead end (§2c).
- Standalone Alpha Radar — fold into a later readthrough lens (§2f).
- Medical/Bio Radar — pursue later as a narrow wedge, engine-first (§2e).
- Any further investment in the general feed as a product: personalization,
  mobile, notifications, feed polish. The feed remains the evidence substrate,
  not the product (§2a).
- A prettier Network graph or Map. Both are recommended for deletion (§8).

**The one-sentence wedge** (from the competitive analysis, §3):

> worlddashboard maintains a persistent, timestamped model of a domain's
> emerging entities and relationships, and tells you — with linked evidence —
> what changed in that model and when, without being asked and without being
> configured.

---

## 2. Idea Maze analysis

Six paths, each with an explicit verdict. Confidence noted where it matters.

### 2a. Better global news feed — FOLD INTO ENGINE (high confidence)

- **Pros:** ~80% already built; universally understood annoyance; zero
  switching cost to try; keeps the engine honest as a messy stress test; it is
  the operator's daily driver.
- **Cons:** Vitamin, not painkiller — nobody's workflow breaks when a feed is
  10% cleaner. You cannot out-free Google News/Apple News. Entity tagging is a
  commodity (Feedly Leo ships it). A general feed is anchor-dominated by
  construction — it optimizes for exactly the output the hypothesis calls
  low-value.
- **Competitors:** Google/Apple News (free, preinstalled), Feedly/Inoreader
  (own the prosumer niche), Ground News (bias angle + marketing machine),
  Techmeme (human-curated verticals), ChatGPT/Perplexity digests absorbing the
  casual "what happened today" job.
- **Risk:** Months sunk into feed-market table stakes (accounts, mobile, push)
  with no reuse value for the radar. Anchor-heavy signals train users to
  ignore the Signals tab before any vertical launches.
- **Precedent:** Artifact — Instagram's founders, elite recsys team, venture
  funding, same "cleaner AI feed" thesis — shut down in under two years
  because the opportunity was too small. That is close to a controlled trial
  of this path with a better team.
- **Verdict:** Keep running as substrate and proving ground. Zero further
  product investment. The first user for whom this is a painkiller does not
  exist.

### 2b. Real-time breaking event alerting — DEAD END (high confidence)

- **Pros:** Proven willingness to pay (Dataminr ~$100M+ ARR, Samdesk, Factal).
- **Cons:** RSS is structurally the last mile of the news cycle; this codebase
  compounds it — ingestion is a once-daily cron (`vercel.json`: `13 6 * * *`)
  plus page-load ticks gated at 2h staleness and a 10-minute lock
  (`src/lib/server/tick.ts`). Real latency is 2–24 hours in a market priced in
  seconds. Detectors run 24h windows against 14-day baselines (a 15-day
  lookback minus the 24h observation window) — none of the statistical
  machinery transfers to sub-minute detection. Serverless Next.js
  has no persistent workers, streaming, or push. The free tier (LiveUAMap,
  OSINT Telegram) is already faster than anything RSS-based can be.
- **Competitors:** Dataminr (firehose moat), Samdesk, Factal (human
  verification), LiveUAMap (free floor).
- **Risk:** A missed alert is not a bug, it is total failure of the promise —
  asymmetric liability. Building the required ingestion plane is a different
  company.
- **Verdict:** Dead end. It also violates the spine: "honest time" forbids
  pretending a daily-tick RSS radar is real-time. The product should embrace
  being deliberate — hours-to-days cadence, honestly labeled.

### 2c. Generic market intelligence — DEAD END (high confidence)

- **Pros:** Largest nominal TAM; the pipeline is generically reusable.
- **Cons:** Competes exactly where incumbents are strongest and this product
  has zero inputs: licensed content (broker research, transcripts, expert
  calls) and enterprise distribution. A public-RSS corpus is the least
  defensible content base in existence. The daily queries MI users actually
  run are unanswerable from RSS. The category's expectations (watchlists,
  boolean saved searches) directly violate zero-configuration. "Generic" also
  contradicts the product's own hypothesis: it maximizes anchor noise and
  dilutes satellite density to nothing.
- **Competitors:** AlphaSense/Tegus, Bloomberg, Koyfin (owns the prosumer
  price tier), Meltwater/Signal AI, CB Insights/PitchBook, Feedly's MI tier,
  plus LLM-native entrants saturating chat-over-market-content.
- **Risk:** Chicken-and-egg on content licensing is structurally unsolvable
  solo. The first dollar on this path plausibly never arrives.
- **Verdict:** Dead end. Nothing to salvage that doesn't already belong to the
  domain-radar wedge.

### 2d. AI Radar — PURSUE FIRST (medium confidence, deliberately)

- **Pros:** Builder is the target user. The hypothesis fits AI unusually well:
  the valuable units ARE low-frequency named things (a new model, a new
  inference startup, a new datacenter site) orbiting a handful of
  over-covered anchors. Longitudinal memory is a genuine structural gap —
  newsletters are snapshots, X is a firehose with no memory, HF trending is
  popularity-now. Sources are free and abundant. Highest buildability
  (~70% of the engine exists and transfers unchanged).
- **Cons:** Densest competitive field on earth; the audience is
  tooling-saturated with low willingness to pay; many will just ask
  ChatGPT/Perplexity. The wedge value is invisible on day one — longitudinal
  threads need weeks of accumulated history (cold-start on the
  differentiator). Entity resolution in AI naming chaos (versions,
  checkpoints, codenames) is the single biggest technical risk. arXiv-scale
  volume threatens the $5/mo LLM budget without pre-filtering. Honest count:
  today's "AI/ML" sources are mostly inference APIs, not content feeds — real
  AI content coverage is ~4 generalist tech blogs.
- **Competitors:** X circles (speed, free, no memory), newsletters (Ben's
  Bites/TLDR/Import AI/Zvi — daily digest habit, no state), HF trending /
  Papers With Code (popularity-now), arXiv tools (papers only),
  Perplexity/ChatGPT (stateless catch-up), Feedly AI/AlphaSignal (feeds, not
  entity-longitudinal).
- **Risk:** Chat-assistant commoditization of the casual segment;
  cold-start churn; solo pace vs domain velocity.
- **Verdict:** Pursue first — as hypothesis test, with monetization honestly
  uncertain. Success is a proven engine plus dogfood retention; the first
  dollar may come from vertical #2. Kill gates in §10.

### 2e. Medical/Bio Radar — PURSUE LATER (high confidence on sequencing)

- **Pros:** Highest proven individual willingness to pay of any path:
  catalyst traders and biotech investors pay $1,000–2,500/yr
  (BioPharmCatalyst-class) for structured trial/compound/catalyst data;
  Citeline at $30K/seat proves the satellite-radar shape is worth enterprise
  money when hand-curated. Sources are free and structured
  (ClinicalTrials.gov API, PubMed/bioRxiv/medRxiv RSS, FDA calendars).
  Anchor/satellite maps perfectly: Pfizer/FDA as anchors; compounds, trials,
  small biotechs as satellites whose changes are literally tradeable events.
  Patient advocates have acute, underserved pain.
- **Cons:** Biggest rebuild: ~4 health sources today; needs ontology
  extensions (compound, trial, indication, phase) and registry-delta
  ingestion beyond RSS. Extraction errors are trust-fatal (a misread trial
  phase ends the product for that user). Headline+300-char extraction
  (`llm-extract.ts` MAX_SUMMARY_CHARS) is too thin for trial endpoints. A
  solo generalist has a domain-credibility gap here that AI doesn't suffer.
  Hard safety obligations: research awareness vs medical advice must be
  separated in copy, and every item needs an evidence-maturity label
  (preclinical / clinical / trial update / review / regulatory / commercial
  claim / anecdotal / hypothesis).
- **Competitors:** Citeline/Evaluate (curated system of record, enterprise),
  BioPharmCatalyst (catalyst calendars), Elicit/Consensus/Semantic
  Scholar/ResearchRabbit (retrospective literature synthesis — "what is
  known", not "what changed this week"), PubMed/CT.gov alert tools (row
  diffs, no narrative), patient communities (anecdote-rich, unstructured).
- **Risk:** Medical misinformation liability; anecdote amplification;
  evidence-maturity mislabeling.
- **Verdict:** Pursue later, entering through the narrow wedge with the
  lowest advice-risk and highest pay-readiness: **biotech catalyst radar**
  (users are investors, not patients; events are structured and datestamped).
  Microbiome/longevity wedges are rejected as entry points — they sit closer
  to the advice line. Do not start until the AI Radar has proven the engine —
  porting a proven engine is a 2–4 month job; debugging an unproven engine in
  a trust-fatal domain is not survivable.

### 2f. Alpha Radar — FOLD INTO ANOTHER PATH (high confidence)

- **Pros:** The relation vocabulary already in production (acquisition,
  investment, funding, supply, sanction, regulation — `llm-extract.ts`,
  `migrations/005`) is exactly the grammar of a market readthrough. Signals
  are timestamped in Postgres, so a retrospective precision audit is cheap.
  Cautious, impersonal, evidence-linked "plausibly matters for X because Y"
  framing is defensible as published research, not advice.
- **Cons:** "Before consensus" is false by construction on a mainstream-RSS
  corpus — markets price Reuters headlines in seconds; pre-consensus signal
  lives in primary sources (EDGAR, FDA, procurement notices) the source list
  doesn't have. Zero market plumbing exists (no ticker master, no sector
  taxonomy, no price data — verified). Trust asymmetry is brutal: one wrong
  ticker mapping is terminal. Every fund already runs LLM-over-news
  internally.
- **Competitors:** Bloomberg/Refinitiv (speed + security master),
  AlphaSense/Tegus, fintwit/Substack (free, named reputations), Quiver-class
  alt-data, internal fund tooling, prediction markets as the consensus
  baseline.
- **Risk:** Regulatory/liability optics the moment marketing says "alpha";
  the verification trap (proving "we were early" needs point-in-time market
  data); opportunity cost — the alpha layer is seductive and would consume
  the runway the base radar needs.
- **Verdict:** Fold in. Ship later as an opt-in **market readthrough
  annotation** on domain-radar developments (AI infra chains; the
  geopolitics→commodities/supply-chain corner where ~25 of the 215 source
  entries — of ~106 actually-ingested RSS/Atom feeds — genuinely live), only
  after base-radar precision is demonstrated, and
  never marketed as alpha. Plan for it to drive retention, not the first
  dollar.

---

## 3. Competitive positioning

Where incumbents are strong — by their unit of value:

- **Feedly / Inoreader / Ground News / newsletters** — unit of value: the
  **article**. They own filtering, reading UX, and the digest habit. They
  structurally lack any persistent entity object: no first-seen, no edges,
  no diffing.
- **AlphaSense / Tegus / CB Insights** — unit of value: the **query**. They
  own licensed corpora and enterprise search. They structurally lack
  push-discovery of entities you didn't know to search, and
  change-as-narrative.
- **Dataminr / Samdesk / Factal** — unit of value: the **event**. They own
  sub-minute speed and verification ops. They structurally lack memory — an
  alert fires and dies; no trajectory, no evolution.
- **Meltwater / Signal AI** — unit of value: the **brand mention**. They own
  licensed media archives and share-of-voice analytics. They structurally
  lack an open entity universe — they only watch entities you enumerate.
- **Elicit / Consensus / Semantic Scholar / ResearchRabbit** — unit of
  value: the **paper**. They own the citation graph and retrospective
  synthesis. They structurally lack the present tense, a news-to-research
  bridge, and entity-level change detection.
- **Citeline / BioPharmCatalyst** — unit of value: the **curated row**. They
  own the pharma system of record. They structurally lack generalization
  (no Citeline-for-AI) and narrative threads over row diffs.
- **ChatGPT / Perplexity / Gemini** — unit of value: the **answer**. They
  own explanation, reach, and price. They structurally lack the four missing
  primitives below.

**Why general AI assistants — the biggest looming substitute — do not fill
the gap:** (a) no persistent entity memory across sessions: each query
re-derives the world; there is no durable "Mistral" object accumulating
observations; (b) no first_seen provenance: an assistant cannot truthfully
say "this company first appeared in the monitored corpus on July 3" because
it has no monitored corpus or ingestion log; (c) no longitudinal diffing:
"what changed since I last looked" requires stored prior state, and
assistants can only narrate changes journalists already wrote up — the
radar's value is changes nobody has written a story about; (d) no
evidence-linked change detection, and no proactive firing — they answer when
asked; a radar notices when not asked. The honest boundary: assistants will
own the "explain this development" step. Treat them as the downstream
consumer of detections, not the competitor on explanation.

**Why this must not become a Feedly/AlphaSense/Dataminr/Elicit clone:** each
clone path competes on the incumbent's moat (filtering ML, licensed content,
latency, paper-grade extraction) while abandoning the one thing none of them
have: a persistent, open-universe, timestamped entity/relationship record
with change as the unit of output. Anchor/satellite inversion is the
computable form of "surface the non-obvious" — every incumbent's ranking
amplifies volume; nobody treats "rarely mentioned, but connected to something
important" as a positive signal.

**The moat, honestly stated:** the longitudinal record itself. `first_seen`
cannot be backfilled — every week of ingestion widens a data gap a copycat
(or an assistant grown scheduled tasks + memory) cannot reconstruct. That
moat only accumulates in a domain where the sources are actually watched,
which is why the beachhead domain's source density matters more than engine
features (§7).

---

## 4. Product architecture recommendation

**Keep one app. Keep one repo. Do not split.**

- One deployable Next.js app; domains are data + configuration + ranking
  weights inside it. A domain is: a `domain` tag on sources, a set of ranking
  weights, optional ontology additions, and a domain filter on the
  development surface — not a fork of anything. AI Radar launches as a
  filter, not a route; a route-level mode (`/ai`) is a marketing decision for
  a public launch, made then, and changes nothing about the engine.
- The engine work in §7 slice 1 is domain-neutral by construction; anything
  that only makes sense for one domain (source lists, relation-type weights)
  lives in data, not in per-domain code branches.

**Criteria for staying monorepo (all true today):** one deployable app;
shared ingestion pipeline; domain behavior is data/config/ranking; one test
suite; stable shared types.

**Criteria that would justify a split (require ≥2, none true today):**
distinct deploy cadence per domain; domain ingestion large enough to
destabilize the shared pipeline; compliance/data-governance requirements
(plausible for Bio later); paid/private data that must not ship with the
public app (plausible for a readthrough tier later); domain conditionals
making simple changes risky.

If a split ever happens, the boundary is `radar-core` (ingestion, types,
scoring, evidence) + thin domain apps — but not until the core concepts are
proven in the current app. Multiple product *names* are a marketing decision,
not a repo decision.

---

## 5. Core object model

Each object is grounded in what exists; gaps are named.

- **Anchor** — a high-recognition, high-baseline entity (Russia, Trump,
  OpenAI, Nvidia, FDA). *Exists as:* entities with `prominence: famous`
  (extracted per-mention, currently discarded after the auto-accept gate in
  `entity-ingest.ts`) and/or high `entity_mentions_hourly` baseline. *Gap:*
  nothing persists the classification. *Rule:* an anchor is context and
  gravity — it may raise the score of nearby satellites but never headlines a
  development card and is never a rankable output by itself.

- **Satellite** — a lower-frequency, more specific entity (a model, startup,
  paper, compound, trial ID, datacenter site, legal mechanism). *Exists as:*
  `entity_candidates` rows are proto-satellite dossiers already carrying
  `co_entities` (the anchors it orbits), `contexts` (LLM role phrases),
  `day_count` vs `mention_count` (persistence vs burst), `source_names`,
  `sample_titles`. *Gap:* the current pipeline optimizes for the opposite of
  the hypothesis — famous entities auto-track frictionlessly while obscure
  candidates queue for manual review, and candidates rank by source count
  DESC, burying the long tail.

- **Relationship** — a directed, typed edge between entities.
  *Exists as:* `entity_relations` (13 types, first/last_seen, article_count)
  — prefer this always over undirected `entity_edges` co-occurrence, which is
  the weak fallback. *Gaps:* relations touching a name that is still an
  unresolved candidate — no `entities` row of any status by the end of the
  run — are silently dropped, not queued (`entity-ingest.ts:762-782`); these
  are exactly the anchor→new-satellite edges the wedge depends on. Each
  relation also keeps a single overwritten `evidence_article_id`, so relation
  history cannot be reconstructed. Note: `/api/entities/[id]` already serves
  typed directed relations that the UI ignores — the missing half is
  client-side only.

- **Development** — the user-facing unit of value: satellite + anchor context
  + relationship + evidence + timeline + why-shown. *Exists as:* the
  `signals` row is the chassis (dedupe_key, severity, confidence, evidence
  JSONB, state machine) — a development is a signal that (a) headlines a
  satellite, (b) carries anchor context and relation type, (c) accumulates
  updates instead of overwriting itself, (d) states its epistemic status:
  observed fact / derived pattern / hypothesis.

- **Signal thread** — the longitudinal identity of a development.
  *Gap (the single most important engine gap found):* `persistSignals`
  overwrites evidence/title/severity in place on refresh
  (`signal-store.ts:144-158`), and the partial unique index means a
  dismissed signal that re-fires after the 72h dismiss cooldown becomes a new
  row with a fresh `first_detected_at` (within the cooldown it is suppressed
  entirely) — continuity is severed either way. A thread needs: a stable
  subject key that survives dismissal, and an append-only update log (what
  changed, when, evidence snapshot per update). The existing dedupe_key
  scheme (`surge:<id>`, `novel_edge:<a>:<b>`) is the right key shape.

- **Evidence set** — the articles behind a claim, resolved at read time with
  publish time and first-seen time kept distinct. *Exists as:*
  `evidence.articleIds` (capped at 5) resolved by `loadSignals`;
  `articles.published_at` vs `first_seen_at` is already honest at the schema
  level (`migrations/001`, repaired in `003`). *Gaps:* caps are per-signal
  rather than per-update; `entity_edges` stores no article IDs at all; and —
  critically — articles are hard-deleted after 30 days
  (`ingest-writer.ts:113`), so read-time resolution alone cannot evidence any
  thread quiet longer than a month, which would forbid the paper-to-product
  and regulatory slow-burn scenarios in §9. *Decision:* each thread update
  stores a denormalized evidence snapshot (title, URL, source, publish time,
  first-seen time — up to 5 items), so evidence survives article retention.
  Cost: a few hundred bytes per update; accepted. *Rule (spine #2):* if the
  evidence can't be shown, the claim doesn't ship — a development with zero
  resolvable evidence items is suppressed, not rendered bare.

- **Hypothesis** — explicitly labeled speculation derived from observed
  developments ("if X supplies Y, Z's capacity constraint may ease").
  *Exists as:* nothing usable — `cascade-graph.ts` fabricates implications
  from a hand-coded 12-domain geopolitics table with no evidence links; it is
  the anti-pattern and should be deleted, not extended. Hypotheses must be
  generated only with their supporting developments attached and visually
  separated from observed facts.

- **Market readthrough** — a hypothesis subtype mapping a development to
  market-relevant entities (public company, sector, commodity, supply chain).
  Cautious language, evidence-linked, impersonal, never "buy/sell", never
  marketed as alpha. Deferred to the phase after domain-radar precision is
  proven (§7).

---

## 6. Ranking strategy

**Why raw mention count is dangerous — four concrete mechanisms in this
codebase:**

1. Anchors dominate by corpus construction: 66 generic News feeds guarantee
   Russia/Trump/Gaza volume every day. Volume measures coverage, not
   information.
2. The surge math structurally favors anchors: `z = (obs − base)/√(base+1)`
   (`detectors.ts:55`) fires at proportionally smaller moves for high-baseline
   entities (baseline 100→150 gives z≈5, fires; baseline 2→3 gives z≈0.6,
   silent), and severity-first ordering then floats anchor surges to the top.
3. Mention counts are inflated by cross-host duplicates: `content_hash`
   includes the link host, so one wire story from N outlets is N rows;
   title-signature grouping only catches near-identical headlines within 48h.
4. The Signals watchlist ranks purely by 24h mention volume client-side
   (`useSignalsTab.ts`) — it is a machine for surfacing exactly the entities
   the user already knows about.

**Demoting anchors:** persist the anchor classification (prominence +
baseline volume tier) on `entities`; exclude anchors from headlining any
development card, from "new entities", and from movers; an anchor surge is
only interesting for what it drags into view — rendered as a one-line context
strip on satellite cards ("unusual activity around Nvidia: 3 new satellites
this week"), shipping as part of §7 L1 item 4.

**Promoting satellites:** invert the current review economics. Auto-track a
candidate satellite when corroboration clears a bar (≥2 distinct sources AND
≥2 distinct days, OR a typed relation to a tracked anchor), keeping Review as
the audit/correction trail rather than the admission gate — this preserves
zero-configuration (accept/dismiss remains the only teaching interaction)
while unblocking the long tail that currently expires unreviewed after 14
days. Retain (queue) relations whose satellite endpoint is still a candidate
instead of dropping them.

**Development attention score — components and direction of effect:**

- **Specificity** — satellite types (product, technology, company,
  person-obscure) score up; country/region-only scores down. Grounding: the
  15-type ontology already distinguishes these.
- **Novelty** — recent true first_seen scores up; a novel typed edge scores
  up strongly. Grounding: the `first_seen`/`novel_edge` detectors exist;
  bootstrap + warm-up guards keep them honest.
- **Anchor association** — a satellite orbiting a tracked anchor scores up;
  this never boosts the anchor itself. Grounding: `co_entities`,
  `entity_relations`.
- **Relation type** — acquisition/investment/supply/regulation/sanction
  above membership, above statement_about; typed-directed above undirected
  co-occurrence. Grounding: `entity_relations` vs `entity_edges`.
- **Source spread** — distinct sources score up; distinct source categories
  (cross-category migration: tech→policy, research→business) score up
  strongly. Grounding: `source_count`, the `cross_category` detector
  pattern.
- **Persistence** — recurring across days beats a single-day burst.
  Grounding: `day_count` is already computed on candidates.
- **Evidence quality** — source tier weighting; zero resolvable evidence
  means the card is suppressed. Grounding: `source_tier` on every article
  row.
- **Domain relevance** — matches the active domain's source set. Grounding:
  requires the `domain` tag (§7, deferred).
- **Penalties** — famous standalone; country-only; generic terms;
  single-source; old news presented fresh (a publish≪first_seen gap must be
  labeled, not hidden — spine #4).

The score must be a pure, unit-tested function (the codebase's established
pattern — `scoreSurge` etc. are cleanly separated and synthetic-panel
tested). The `novelty-scorer.ts` quiet-mover bonus and source-diversity ratio
are the codebase's existing articulation of "low volume + corroborated =
interesting" — port that logic server-side; it currently lives uselessly in
browser localStorage.

---

## 7. Recommended roadmap

**Level 0 — planning only (this PR):** this packet; reviewer critique;
decision on §8 deletions. No code.

**Level 1 — first implementation slice, current World Dashboard (the engine
slice).** Smallest set of changes that makes the development object real,
each independently shippable and testable:

1. Persist `prominence` and a volume tier on `entities`; define
   anchor/satellite as data (one migration + carrying an existing field one
   step further).
2. Stop dropping anchor→candidate relations: queue relations with an
   unresolved endpoint; attach when the satellite is tracked.
3. Append-only thread updates: on signal refresh, write an update row
   (timestamp, what changed, evidence snapshot) instead of overwriting
   evidence in place; thread identity survives dismissal.
4. Satellite-first Brief: the top of Brief becomes development cards
   (satellite headline, anchor context, relation, evidence links, first-seen
   honesty); movers/new-entities sections fold into it; anchors stop
   headlining anything.
5. Ranking as a pure scored function with tests, per §6.
6. Deletions per §8 (Network tab, Map tab, client watchlist, cascade-graph)
   — the complexity budget for the additions above.
7. **Data-only, do immediately:** add the `domain` field to sources and
   begin ingesting the non-arXiv AI expansion (~30–40 feeds: HF, GitHub
   releases, lab blogs, AI newsletters with RSS — all volumes the existing
   15-item/feed cap handles) so first_seen history starts accumulating while
   the engine work proceeds. arXiv categories are explicitly deferred to
   Level 2, after the pre-LLM volume filter exists — otherwise arXiv-scale
   volume meets the $5/mo budget with no safeguard. The warm-up/bootstrap
   guards (`computeWarmupState`, `isBootstrapCohort`) already exist to keep
   the onboarding cohort honest.

**Level 1 exit criteria (gate to Level 2, expected duration 2–3 weeks):**
(a) ≥10 development cards produced from live World data whose headline is a
non-famous entity, each with resolvable evidence and honest first-seen times;
(b) ≥3 of those threads receive at least one append-only update; (c) the
operator reads Brief in preference to Feeds for one full week. If (a) or (b)
cannot be met on the World corpus, the development object is wrong — fix or
kill before any AI-specific work beyond the data-only source tag.

**Level 1 scope bounds (per FABLE-ROADMAP §9.6):**

- **Item 1 — persist prominence/tier.** Files: migration 006,
  `entity-ingest.ts` (`llm-extract.ts` unchanged — the field exists).
  Contract: `entities` gains 2 columns. Rollback: column drop, no data loss.
  Tests: entity-ingest unit + integration.
- **Item 2 — pending relations.** Files: migration 006, `entity-ingest.ts`.
  Contract: new `pending_relations` table, attach-on-track. Rollback: table
  drop. Tests: entity-ingest unit + integration.
- **Item 3 — thread updates.** Files: migration 006, `signal-store.ts`,
  `detectors.ts` (dedupe keys unchanged). Contract: new `signal_updates`
  table, append-only; `signals` semantics preserved for existing readers.
  Rollback: table drop; readers unaffected. Tests: signal-store unit +
  integration.
- **Item 4 — satellite-first Brief.** Files: `brief.ts`, `BriefTab.tsx` +
  brief sections, new ranking module. Contract: Brief JSON shape (additive).
  Rollback: revert route. Tests: brief unit; ranking pure-function tests.
- **Item 5 — ranking function.** Files: new `development-score.ts`.
  Contract: none (pure). Tests: synthetic-panel unit tests.
- **Item 6 — deletions.** Files: `NetworkTab.tsx`, `MapTab.tsx`, watchlist
  halves of the signals components, `cascade-graph.ts`,
  `geo-coordinates.ts`, plus dead dependencies (leaflet, react-force-graph).
  Contract: none. Rollback: git revert. Tests: existing suites stay green.

Explicitly out of scope for L1: `feed-fetcher.ts`, `run-ingest.ts` pipeline
stages, `tick.ts`, auth/accounts, any new tab, any mobile/notification work.

**Level 2 — first focused subproduct: AI Radar (domain mode, same app).**

- Ontology extension: `model`, `paper`, `benchmark`, `dataset` types (one
  migration following the `005` pattern + the `ENTITY_TYPES` constant and
  system prompt in `llm-extract.ts`); relation additions: `release`,
  `publication`, `benchmark_result`.
- Structured-ID extraction layers (arXiv IDs; the `CandidateLayer` priority
  system in `extract-v2.ts` makes this a small, testable addition).
- Domain-scoped ranking weights and a domain filter on the Brief/Developments
  surface.
- AI entity resolution rules (version/checkpoint collapsing) — the hardest
  genuinely new piece; budget the most risk here.
- Pre-LLM volume filtering for arXiv-scale feeds to protect the budget ledger
  and the 60s function ceiling.
- Gate: the §10 kill gates run for 3–4 weeks before any further investment.

**Level 3 — later expansions, independently gated:**

- **Bio** (gate: Level-2 kill gates passed): port the engine as a biotech
  catalyst radar (compound/trial/indication ontology; ClinicalTrials.gov
  delta ingestion; evidence-maturity labels as a hard requirement;
  research-awareness framing, no advice).
- **Alpha** (gate: a retrospective precision audit on stored signals clears
  the bar — depends on the AI radar's history, not on Bio): market
  readthrough annotations on existing developments (ticker/sector mapping
  table, cautious copy). Rendered only on development cards under an
  explicit hypothesis label, default off, one toggle — a deliberate
  liability boundary, not a preference; no other readthrough configuration
  will ever exist.

---

## 8. UI/product surface implications

Decisions, not options. Six tabs become two main surfaces — Brief and Feeds —
plus the EntityPanel thread view (a slide-over, not a tab) and an
operator-only Review. Mapping onto FABLE-ROADMAP §6's recommended nav: Brief
absorbs Developments; Feeds is Evidence; EntityPanel is Entities.

- **Brief → the product.** Becomes the development-card surface (§7.4): what
  changed, around what, evidence one click away, honest first-seen times.
  Top-stories-by-cluster-size remains only as a compact context strip — it is
  feed redisplay and must not lead. The `generatedAt` timestamp gets rendered
  (it is already fetched; honest time demands showing it).
- **Feeds → demoted, kept.** The evidence substrate every claim links into,
  and the fallback reader. No further product investment. Its dual-timestamp
  discipline (updated vs published) is already correct.
- **Signals → merged into Brief/Developments.** The managed signal cards,
  state machine, and EvidenceExpander are the development card's chassis and
  survive; the tab as a separate destination does not. The client-side
  "Watchlist Top-12" (volume-ranked anchors, no evidence links) is deleted.
- **Network → deleted.** An undirected co-occurrence hairball over a
  4-type client-side extractor, blind to the 15-type ontology and to every
  directed relation the pipeline extracts; no evidence path, no time
  dimension. Its one legitimate job — "what is this entity connected to and
  since when" — moves into the EntityPanel as a typed, directed connections
  list. The relations layer has zero UI anywhere today, though
  `/api/entities/[id]` already serves incoming/outgoing typed relations that
  EntityPanel ignores — this is a client-only change.
- **Map → deleted.** Geography is the wrong projection for satellite
  entities; urgency coloring derives from source category, not content; no
  freshness encoding. If a specific geographic development class later
  justifies it (ports, cables, datacenter sites), it returns as a module on
  those development cards, not as a global tab. Its popup evidence pattern is
  worth reusing there.
- **Review → operator view, demoted from the main nav.** It remains
  load-bearing as the audit/teaching loop (spine #3: accept/dismiss is the
  only teaching interaction), but auto-promotion (§6) removes it from the
  satellite critical path. Its one spine violation gets fixed in passing:
  sample titles must become links (evidence one click away applies to the
  operator too).
- **EntityPanel → grows into the thread view.** Dossier + sparkline +
  first-seen already exist; add typed directed relations and the append-only
  change timeline. This is where "everything that happened around X since
  first seen" lives.

Also deleted: `cascade-graph.ts` (hand-coded implication chains with no
evidence — the anti-pattern of spine #2), and the client-side duplicate
entity system feeding Network/Map/watchlist once those surfaces are gone.

---

## 9. High-alpha scenarios

Format per scenario: **appears** (satellite) / **anchor** / **evidence
required** / **relation** / **timeline behavior** / **possible readthrough**
/ **what makes it low quality**.

1. **AI infrastructure readthrough.** A regional utility or cooling supplier
   appears in datacenter coverage. Anchor: Nvidia/Microsoft/a hyperscaler.
   Evidence: ≥2 sources across categories (tech + local/energy press).
   Relation: `supply` / `partnership` / `infrastructure` siting. Timeline:
   satellite recurs across weeks as the buildout progresses; edge count
   grows. Readthrough: power/cooling constraint chains (opt-in, cautious).
   Low quality: single-source local rumor; the "supplier" is actually a
   famous entity; press-release-only sourcing.

2. **New model/tool launch.** A new model name first_seen on a lab blog or
   HF. Anchor: the releasing lab. Evidence: primary source (lab blog/HF/
   GitHub) + ≥1 independent pickup. Relation: `release` (new type, §7L2);
   `benchmark_result` edges as they appear. Timeline: hours-to-days pickup
   spread; category migration research→business within a week signals
   significance. Readthrough: open-weight releases pressure incumbent
   pricing. Low quality: version-alias fragmentation (GPT-5 vs gpt-5-turbo
   as separate entities — the resolution risk of §2d); benchmark claims with
   no independent replication.

3. **Paper-to-product transition.** A paper/method entity, first seen in
   arXiv-category sources, reappears months later in a product launch or
   funding story. Anchor: the adopting company. Evidence: the original paper
   + the commercial article, both in the thread. Relation: `publication` →
   later `investment`/`release`. Timeline: this is the thread payoff case —
   long dormancy then category migration (research→business); only a system
   with first_seen memory can show it. Readthrough: which lab's research
   pipeline is converting. Low quality: name collision between method and
   company; "transition" inferred from one co-mention.

4. **Open-source disruption.** An OSS project/model satellite accumulates
   edges (adoption, benchmark parity) against a commercial anchor's product.
   Anchor: the incumbent vendor. Evidence: GitHub/HF signals + independent
   benchmark coverage. Relation: `benchmark_result`, `statement_about`,
   competitive `supply` displacement. Timeline: sustained multi-week source
   spread growth, not a one-day HN spike. Readthrough: incumbent margin
   pressure. Low quality: star-count hype with single-category sourcing; no
   recurrence after launch week.

5. **Regulatory catalyst.** A specific legal instrument (a named act,
   docket, export-control rule) appears around industry anchors. Anchor: the
   regulator + affected companies. Evidence: primary/government-advisory
   source + trade press. Relation: `regulation`, `legal_action`. Timeline:
   slow, persistent recurrence with defined future dates — ideal thread
   material. Readthrough: compliance cost/benefit by company exposure. Low
   quality: opinion coverage about anticipated regulation with no instrument
   entity; conflating proposal with enacted rule.

6. **Biotech trial/compound signal.** A compound or NCT trial ID appears
   around a small-cap anchor, or a trial record changes state. Anchor:
   sponsor company / FDA. Evidence: registry entry or company PR + ≥1
   independent source; evidence-maturity label mandatory. Relation:
   trial-phase relation (new type, §7L3), `partnership`, `regulation`.
   Timeline: phase transitions and readout dates — datestamped catalysts.
   Readthrough: standard catalyst-trading framing (research lead, not
   advice). Low quality: PR-wire-only sourcing; phase misextraction (trust-
   fatal — precision bar is higher here than anywhere).

7. **Microbiome/longevity research signal.** A strain, compound, or
   biomarker recurs across papers and a trial update. Anchor: the
   condition/pathway and the research institutions involved. Evidence:
   preprint/journal + registry; maturity label (preclinical vs clinical)
   mandatory and prominent.
   Relation: `publication`, intervention-target edges. Timeline: slow
   accumulation across months; anecdote sources (communities) are context,
   never evidence. Readthrough: none for patients — research awareness only;
   supplement-market readthrough only under the Bio-investor lens. Low
   quality: single mouse study amplified; commercial claims laundered as
   research; anecdote counted as corroboration.

8. **Sanctions/export-control signal.** A previously unseen intermediary
   company appears in sanctions/enforcement coverage. Anchor: the sanctioned
   state/entity (Russia, Iran). Evidence: enforcement action or ≥2
   independent investigations. Relation: `sanction`, `supply`, `membership`.
   Timeline: new satellites recurring around a sanctions anchor = evasion
   network mapping over weeks — the current corpus's strongest suit.
   Readthrough: commodity flow rerouting. Low quality:
   speculative attribution from a single OSINT account; entity confusion
   among shell-company names.

9. **Commodity/supply-chain signal.** A chokepoint entity (port, strait,
   mine, refinery) gains unusual edges (conflict, weather, labor) across
   categories. Anchor: the commodity/region. Evidence: maritime/trade
   sources + general news crossing categories. Relation: `conflict`,
   `supply` disruption. Timeline: cross-category migration within days is
   the trigger; persistence separates disruption from blip. Readthrough:
   affected shippers/insurers/commodity prices, cautiously framed. Low
   quality: routine congestion reported as disruption; old news recycled
   (publish≪first_seen must flag it).

---

## 10. Validation plan

**Principle: the kill gates run on data the system already stores. No new
instrumentation is required to falsify the direction.**

**Dogfood test (weeks 1–4 of Level 2):** the builder's own retention is the
first gate. If the operator stops opening the radar daily once novelty
fades, the wedge failed under the most favorable possible conditions.
Maintain a one-line daily log: did the radar surface anything my X/newsletter
diet had not already shown me? (Target: ≥3 genuine catches/week by week 4.)

**Qualitative tests (5 users, week 4+):** recruit 5 people whose output
depends on AI awareness (newsletter writer, VC associate, devrel). Task-based,
not opinion-based: (a) "open the Brief and tell me what's new — was any of it
new *to you*?"; (b) "click through to evidence — do you believe the claim?"
(this is the belief probe; no click analytics are built); (c) one week later:
"what did you come back for?"; (d) the payment probe: "would you pay $15/mo
for this — and if not, what would it have to catch first?" Success = at least
2 of 5 unprompted return visits and at least 1 "I hadn't seen that and it
matters." The payment probe is the only willingness-to-pay signal Level 2
collects; Level-2 success is explicitly engine-proof + dogfood retention, not
revenue.

**Quantitative metrics (all computable from existing tables or the weekly
manual audit):**

- Anchor leakage: famous/high-baseline entities that evaded classification
  and headlined a development card (target ~0; the "anchors never headline"
  rule itself is enforced in code, so this measures classification quality,
  not rule compliance).
- Precision: weekly manual audit of 20 first_seen/novel_edge signals via the
  Review surface — real / junk / mis-resolved. Kill if junk+misresolved
  majority persists two consecutive weeks.
- Earliness: track 5 developments/week that later appear in Ben's Bites,
  TLDR AI, or Import AI; success bar = radar first_seen ≥2 days ahead on ≥2
  of the 5 (the recall+latency benchmark against the free alternative).
- Thread depth: % of developments that receive ≥1 append-only update after
  creation (target ≥30% by week 4 — are threads real, or is everything a
  one-shot?).

**False-positive / false-negative checks:** FP = the precision audit above,
plus entity-resolution spot checks (sample 20 satellite entities; count
fragmented aliases and mis-merges — the §2d technical risk gets its own
number). FN = take each week's top items from 3 newsletters and check
whether the radar had the entity, and when; a radar that misses what
everyone saw is worse than one that is merely late.

**Kill gates (any one sustained for 2+ weeks kills Level-2 investment, per
§2d):** (a) builder stops opening it daily; (b) majority of satellite
signals are junk/mis-resolved; (c) the radar never surfaces a satellite
before the builder's existing diet does. **Precondition:** the gate clock
starts only after the AI source cohort exits warm-up and bootstrap
suppression — concretely, ≥7 days of ingestion history (the `warmup_days`
default) on ≥80% of the AI sources — so a structurally silent warm-up period
cannot kill a healthy direction. **Middle zone:** if the dogfood target
(≥3 catches/week) is missed but no kill gate fires, extend once by 2 weeks,
then decide kill/continue on the trend — no indefinite limbo.

**How we avoid building too much before validation:** Level 1 is engine work
that improves the existing product regardless of domain outcome; the only
AI-specific spend before the gates is a source-list edit and one small
migration. Nothing in Level 3 starts before its own gate passes (§7). No
accounts, no billing, no mobile, no marketing site — none of it exists until
the kill gates have passed and the week-4 payment probe says at least one
concrete person would pay.

---

## 11. Implementation guardrails (for later — no code now)

- No code in this PR. Planning only.
- When implementing: smallest slice first; every §7 L1 item ships and is
  verified independently within its stated scope bounds.
- Repo standards per CLAUDE.md apply throughout (file re-reads before
  multi-file changes, dependency discipline, function-size limits) — not
  restated here.
- One repo until ≥2 split criteria in §4 are concretely true.
- Every derived claim ships with its evidence path or doesn't ship.
- Honest time everywhere: first-observed vs published always distinct;
  warm-up and staleness visible; new-domain onboarding uses the existing
  warm-up/bootstrap guards so "new to the radar" is never presented as "new
  to the world".
- All scoring/ranking logic as pure functions with unit tests (the
  `scoreSurge` pattern); new logic branches get tests; integration tests
  against real Postgres per repo standard.
- Update DEVLOG.md after every implementation task.
- No medical advice, ever: Bio surfaces are research-awareness only, with
  evidence-maturity labels as a blocking requirement, and copy reviewed
  against that line before shipping.
- No automated trading claims, ever: readthroughs are impersonal,
  evidence-linked research leads; no "buy/sell" language; no performance
  claims; not marketed as alpha.
- Deletions land with (not after) the additions they pay for.

---

## 12. Reviewer packet — checklist

For the second-pass reviewer. Reject or request revision if any answer is No.

- [ ] **Is the wedge sharp?** One sentence, names a capability incumbents
      structurally lack (persistent entity memory + first_seen provenance +
      longitudinal diffing + evidence-linked change), not a quality adjective.
- [ ] **Are high-noise entities demoted?** Anchors never headline cards; the
      anchor-favoring mechanisms are named with file references (surge z
      math, watchlist volume ranking, famous auto-accept) and each has a fix.
- [ ] **Are lower-frequency satellites promoted?** Concrete mechanism
      (corroboration-gated auto-tracking, pending-relation retention,
      candidate features reused as scoring inputs), not just intent.
- [ ] **Is evidence one click away?** Every object in §5 defines its evidence
      path; the no-evidence case suppresses the claim; the two current
      violations (Review titles, Network) are addressed.
- [ ] **Is the first implementation slice small?** §7 L1 is a handful of
      independently shippable items on the existing app, paid for with
      deletions; no accounts/billing/mobile/new-tabs.
- [ ] **Is repo splitting avoided unless justified?** One repo/app; split
      criteria explicit and none currently met.
- [ ] **Does the plan avoid generic dashboard/feed/search traps?** Feed,
      alerting, and generic-MI paths each have explicit dead-end/fold
      verdicts with reasons; no generic settings introduced to dodge product
      decisions.
- [ ] **Is there concrete validation before major buildout?** Kill gates
      measurable on existing tables, dated to 3–4 weeks, with explicit
      stop conditions; each Level-3 item gated on its own stated gate.
- [ ] **Honest time preserved?** Cadence honestly stated as hours-to-days;
      no real-time pretense anywhere in the plan.
- [ ] **Safety lines drawn?** Medical-advice and trading-advice prohibitions
      are structural (labels, copy, gating), not disclaimers.
