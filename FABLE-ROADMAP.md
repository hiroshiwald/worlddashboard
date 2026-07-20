# FABLE-ROADMAP.md — Radar Strategy Planning Brief

This document is written for Claude Code Fable, the primary planning agent for
worlddashboard. It is a product strategy and planning contract, not an
implementation request.

Do not treat this as permission to add broad capability. The project rules still
apply: every line of code is a liability, design is how the product works, and a
screen that merely redisplays feeds must justify its existence.

## 1. Strategic Reframe

The dashboard should evolve from a generic news dashboard into a reusable radar
engine for emerging entities, relationships, and evidence-backed developments.

The original product intent remains valid:

- Provide a better global news feed than clickbait-heavy news sites.
- Track named entities over time.
- Help users notice early dots before they become obvious.

The adjustment is that high-volume entities such as countries, famous politicians,
and major institutions should usually be context, not the main signal. The value
is in lower-frequency satellites and relationships around those anchors.

Preferred product promise:

> Radar tracks emerging entities and relationships across fast-moving domains,
> showing what changed, why it matters, and the evidence behind it.

## 2. Core Product Spine

Preserve the existing DESIGN.md spine:

1. Surface the non-obvious.
2. Keep evidence one click away.
3. Require zero configuration from ordinary users.
4. Be honest about time, freshness, warm-up, and staleness.

Apply these rules more strictly than before. A tab, card, or module that only
shows article volume, a generic entity list, a map marker, or a graph node is not
enough. It must answer:

- What changed?
- Why is this non-obvious?
- What specific entity or relationship matters?
- What evidence supports it?
- Is this observed fact, derived pattern, or hypothesis?

## 3. Product Family

Think of the repo as housing a shared radar engine plus possible vertical
products.

### 3.1 Core Radar Engine

Reusable primitives:

- Sources.
- Articles/documents.
- Entities.
- Anchors.
- Satellites.
- Directed relationships.
- Developments.
- Signal threads.
- Evidence sets.
- Human review actions.
- Domain-specific ranking rules.

### 3.2 World Radar

World Radar is the continuation of the current dashboard. It should remain useful
as the general global-news product and as the platform proving ground.

Do not make broad World Radar the first major commercial wedge. It is likely less
differentiated than focused verticals.

### 3.3 AI Radar

AI Radar should be considered the first serious subproduct. It has the strongest
combination of user pain, information velocity, source availability, lower safety
risk, domain-specific entities, and alpha adjacency.

Track:

- AI models.
- Tools and products.
- Companies and labs.
- People and researchers.
- Research papers.
- Benchmarks and datasets.
- Chips, cloud, data centers, power, cooling, and other infrastructure.
- Regulation, lawsuits, standards, and export controls.

Primary user promise:

> Stay ahead of AI by tracking new models, tools, papers, companies, people,
> benchmarks, infrastructure signals, and market readthroughs as they emerge.

### 3.4 Medical Radar

Medical Radar is promising but should come later or start as a narrow wedge. It
has higher trust and safety requirements.

Possible narrow wedges:

- Microbiome research radar.
- Longevity compound radar.
- GLP-1/metabolic disease radar.
- Disease-specific patient advocate radar.
- Biotech catalyst radar.

Medical Radar must clearly separate:

- Preclinical findings.
- Clinical findings.
- Trial updates.
- Regulatory updates.
- Review papers.
- Commercial claims.
- Patient anecdotes.
- Hypotheses.

It must not provide medical advice.

### 3.5 Alpha Radar

Alpha Radar should not launch first as a broad product. Start with market
readthroughs inside AI Radar, then expand once signal quality is proven.

Alpha requires mapping developments to:

- Public companies.
- Tickers.
- Sectors.
- Commodities.
- Supply chains.
- Customers and suppliers.
- Regulations and catalysts.

Do not claim automated alpha. Present evidence-backed research leads and possible
readthroughs.

## 4. Core Object Model

Fable should plan around developments, not raw entities.

### 4.1 Anchor

A high-recognition entity that provides context. Examples: Russia, China, Trump,
OpenAI, Nvidia, Microsoft, FDA, WHO, NATO.

Anchors should usually be demoted as standalone cards. They are useful as gravity
wells for lower-frequency entities.

### 4.2 Satellite

A more specific lower-frequency entity associated with an anchor. Examples:

- A new AI model.
- A small supplier.
- A drug candidate.
- A trial identifier.
- A port, cable, mine, refinery, or data center.
- A research paper.
- A scientist.
- A legal mechanism.
- A benchmark.

Satellites should be promoted when they are new, recurring, relation-backed, or
crossing source categories.

### 4.3 Relationship

A directed or inferred connection between entities. Prefer the existing directed
relationship model over undirected co-occurrence whenever possible.

### 4.4 Development

The user-facing unit of value:

> satellite + anchor context + relationship + evidence + timeline + why shown

Examples:

- New supplier appears in Russia sanctions coverage.
- New AI model moves from technical sources to policy sources.
- New compound appears in papers and a trial update.
- New data center region appears with power-grid constraints.

### 4.5 Signal Thread

A longitudinal development object. It records:

- First seen.
- Last updated.
- New evidence since last view.
- Related entities added or removed.
- Relationship changes.
- Source spread.
- Category migration.
- Current status.
- Observed facts, derived patterns, and hypotheses.

## 5. Ranking Philosophy

Never rank primarily by raw mention count.

Preferred attention score components:

- Specificity.
- Novelty.
- Anchor association.
- Directed relationship strength.
- Source spread.
- Cross-category migration.
- Persistence across days.
- Evidence quality.
- Role/context clarity.
- Market or domain relevance.

Penalize:

- Famous standalone entities.
- Country-only signals.
- Generic topic terms.
- Single-source noise.
- Claims without evidence.
- Old news presented as fresh.

High-volume entities can raise the importance of nearby satellites, but should
not automatically headline the card.

## 6. Revised Navigation Direction

Avoid adding more tabs. Prefer deleting, merging, or demoting surfaces.

Recommended long-term navigation:

1. Brief.
2. Developments.
3. Evidence.
4. Entities.
5. Review only when useful or operator-visible.

Network and Map should not remain generic standalone visualizations unless they
surface non-obvious developments. Prefer:

- Connections instead of Network.
- Hotspots instead of Map.
- Entity profile modules instead of global graph/map tabs.

## 7. Competitive Positioning

Avoid these dead ends:

- Generic AI news feed.
- Real-time breaking news alerting.
- Generic market intelligence search.
- Generic medical literature search.
- Unsupported prediction engine.

The defensible wedge is persistent memory of emerging entities and relationships
inside a domain.

Compete by answering:

- What new thing entered this topic's orbit?
- What changed since yesterday?
- Which lower-frequency entities are recurring?
- Which relationships are new or strengthening?
- What evidence supports the development?
- What are the plausible implications?

## 8. Repository Split Considerations

Do not split the repo prematurely. Splitting increases coordination cost and can
hide complexity rather than remove it.

### 8.1 Keep one repo while:

- There is one deployable app.
- The ingestion pipeline is shared.
- Domain-specific behavior is mostly data/configuration/ranking.
- Tests can still run in one suite.
- Shared types remain stable.

### 8.2 Consider splitting only if at least two of these become true:

- AI Radar or Medical Radar needs a distinct deploy cadence.
- Domain-specific ingestion becomes large enough to slow or destabilize World Radar.
- Medical Radar requires stricter compliance, safety review, or data governance.
- Alpha Radar needs private market mappings or paid data that should not ship with
  the public app.
- The shared app starts accumulating domain-specific conditionals that make simple
  changes risky.

### 8.3 Preferred split if needed

If splitting becomes necessary, prefer a small package/app boundary:

- `radar-core`: shared ingestion, entity/relation types, scoring primitives,
  evidence models, and tests.
- `world-radar`: current broad news app.
- `ai-radar`: AI-specific sources, ontology overlay, ranking, and UI modules.
- `medical-radar`: medical-specific sources, ontology overlay, evidence maturity,
  and safety copy.

Do not split until the core concepts are proven in the current app.

## 9. Planning Output Required From Fable

Before coding a major roadmap change, Fable should produce a review packet for a
second-pass reviewer.

The packet should include:

### 9.1 Product decision

- What product direction is being proposed?
- Which user/job is primary?
- Which vertical is in scope?
- Which verticals are explicitly out of scope?

### 9.2 Design-spine check

For every proposed surface:

- What non-obvious thing does it surface?
- What is the one-click evidence path?
- What decisions did the system make instead of adding settings?
- How does it represent time, warm-up, freshness, and staleness honestly?

### 9.3 Entity/noise plan

- Which entities are anchors?
- Which entities are satellites?
- How are high-volume entities demoted as standalone subjects?
- How are lower-frequency entities promoted when associated with anchors?
- How are generic topic terms and famous-entity noise suppressed?

### 9.4 Development/thread model

- What is the proposed development object?
- How are developments deduped?
- How are updates attached over time?
- How are observed facts, derived patterns, and hypotheses separated?

### 9.5 Evidence model

- What evidence is shown for every derived claim?
- How many articles are shown?
- Are article publish time and first-seen time distinct?
- What happens when evidence is missing?

### 9.6 Implementation scope

- Files expected to change.
- Files explicitly not expected to change.
- New types or API contract changes.
- Migration needs, if any.
- Test plan.
- Rollback plan.

### 9.7 Complexity budget

- What code is deleted or simplified?
- What existing tab/module is merged or demoted?
- Why is any new abstraction necessary?
- What would make this PR too large?

### 9.8 Repo split assessment

- Keep one repo or split?
- Why now or why not?
- What coupling exists between domains?
- What would be the minimal split boundary if required later?

## 10. Review Gate

After Fable creates the packet, a second-pass reviewer should check alignment
against this document before implementation.

The reviewer should reject or ask for revision if:

- The plan is just a nicer news feed.
- High-volume entities remain the main outputs.
- Network or Map remain generic visualizations.
- Signals do not become evidence-backed developments or threads.
- Medical content lacks evidence maturity and safety separation.
- Alpha claims lack market mapping and cautious language.
- The repo is split before there is a concrete complexity reason.
- The plan adds settings instead of making product decisions.
- The plan does not explain what will be deleted, merged, or demoted.

## 11. Preferred First Roadmap Slice

Recommended first implementation slice for Fable to plan:

1. Keep the current app as World Radar.
2. Introduce anchor/satellite/development concepts at the product level.
3. Convert Brief toward development cards.
4. Demote high-volume famous entities as standalone outputs.
5. Promote lower-frequency satellites associated with anchors.
6. Replace generic Network thinking with Connections thinking.
7. Keep all changes in one repo.
8. Produce a review packet before coding.

Recommended second slice:

1. Prototype AI Radar as a domain mode or separate route inside the same repo.
2. Add AI-specific sources and ranking rules.
3. Track models, tools, papers, companies, people, benchmarks, infrastructure,
   and policy.
4. Add a cautious market-readthrough section, not automated trading advice.

## 12. Non-Goals For Now

- Do not build a full Palantir-like enterprise ontology platform.
- Do not build a generic AlphaSense competitor.
- Do not build a Dataminr-style real-time alerting product.
- Do not build a generic medical advice product.
- Do not split the repo only because multiple product names exist.
- Do not add a large configuration UI.
- Do not ship ungrounded inference.

## 13. Definition of a Good Plan

A good Fable plan should make the dashboard feel less like:

> Here are six ways to look at feeds.

And more like:

> Here are the specific new entities and relationships entering important
> domains, how they are changing, why they may matter, and the evidence behind
> them.
