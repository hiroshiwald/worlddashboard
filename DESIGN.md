# DESIGN.md — Design Is How It Works

This file governs every screen, interaction, and piece of copy in worlddashboard.
CLAUDE.md owns code discipline; this file owns experience discipline.

## The definition

Jobs, 2003: "Most people make the mistake of thinking design is what it looks
like. That's not what we think design is. It's not just what it looks like and
feels like. Design is how it works."

Design is not styling. Design is the shape of the decisions that determine what
the product is. Visual treatment is a consequence of those decisions, not a
substitute for them. Never produce veneer and call it design.

## The product's spine

These four decisions are fixed. Every screen serves them; a change that breaks
one is wrong even if it looks good. Do not re-derive intent per task — inherit it.

1. **Surface the non-obvious.** Every tab must show the user something they could
   not have noticed by scanning headlines themselves: a deviation from an
   entity's own normal, a new connection, a pattern across sources. A screen that
   merely re-displays feeds must justify its existence.
2. **Evidence one click away.** Every derived claim — an entity, a signal, a
   relation, a trend — must click through to the articles that produced it.
   No black boxes. If the evidence can't be shown, the claim doesn't ship.
3. **Zero configuration.** The system watches; the user never programs it.
   Accept/dismiss in Review is the only teaching interaction. Adding a setting,
   threshold, or toggle to avoid making a decision is a design failure.
4. **Honest time.** Publish time and arrival time are different facts; never
   conflate them or imply freshness that isn't real. Show warm-up states, show
   staleness, show "updated X ago" from real arrivals. A stale system must look
   stale — that honesty is what makes the fresh state trustworthy.

## How to work

**Start at intent, not at the component.** Name what the user is trying to
accomplish in human terms, then build toward it. If the intent is genuinely
unclear and the answer would change this PR, ask the operator one question —
one, not a checklist. If the answer wouldn't change this PR, state your
assumption in the PR description and proceed.

**Absorb complexity; don't hide it.** Before adding an option, ask whether the
choice needs to exist. Make the decision, ship the opinion. Options are where
designers defer decisions they should make.

**Care about what the user will never see.** The empty state, the loading
state, the error state, the first-run path, keyboard behavior, screen-reader
output. These are the product, not polish. Any screen you touch, you own its
empty/loading/error states by default, even if the task didn't list them.

**Pursue inevitability, not novelty.** The target reaction is "of course," not
"wow." Prefer a familiar pattern used correctly over a novel one used
ambitiously, unless the novel one materially serves the spine.

**Prototype, don't just render.** In this repo "it works" is machine-checked:
new logic branches get tests, integration tests run against real Postgres in
CI, and UI behavior is verified by driving it (Playwright with route
interception). A change that only looks right is a proposal, not a design.

## Working inside a scoped task

Task prompts from the orchestrator define WHAT; this file governs HOW. If the
task as specified would violate the spine, say so at the top of the PR
description and ask before building an alternative — do not silently expand or
rewrite scope. Fighting for the spine is your job; doing it unilaterally is not.

## How to hand off work

Describe the architecture, not the cosmetics: the intent you built toward, the
load-bearing decisions, what you cut or declined and why, what complexity you
absorbed invisibly, and what is proven working vs. proposal. Skip the tour of
colors and spacing. The reader can see the colors.

## Refusals

Do not: produce visual work before intent is named when intent is non-obvious;
add a setting that exists to avoid a decision; ship a surface that hides
complexity the user will hit later; use dark patterns; call something done when
its empty/error/loading states are missing; treat "make it look like Apple" as
a styling request — it is a request about how the thing works.

## The trap

The failure mode of this file is adopting its vocabulary without changing
behavior — writing "the intent is…" above the same component-first work you
would have produced anyway. The check: if your framing could be deleted without
changing the output, you performed the method instead of using it. Redo it.
