## Prime Directive
Every line of code is a liability. Prefer deletion over addition, modification over creation, simplicity over capability. Readable and concise — never verbose, never clever.

## Before Writing or Modifying Code
1. State what you are changing, which files are touched, and what assumptions those files depend on.
2. If touching >2 files, re-read each one first. Do not work from memory of file contents.
3. If a task feels complex, decompose into subtasks. Complete and verify each one before moving to the next.

## Coding Rules
- Max 50 lines per function. If longer, extract. Exception: if splitting would scatter tightly related state or logic across files in a way that hurts readability, note why in a comment and keep it together.
- No shared mutable state between modules. Data flows through arguments and return values.
- Functions do one thing. If the name needs "and", split it.
- Prefer explicit logic over clever abstractions. No ternary chains, no nested short-circuits, no implicit coercions. A new reader should parse intent in one pass.
- Fail fast and loud. No empty catch blocks. No swallowed errors. No silent fallbacks masking broken state.
- Treat all external inputs as untrusted: validate types, shapes, and bounds at module boundaries before processing.
- Prefer pure functions. Isolate side effects (network, disk, time, randomness) at module edges behind explicit interfaces.
- Async discipline: no fire-and-forget promises. Every async operation must be awaited, caught, or explicitly detached with a comment stating why.
- No new dependencies without stating why existing code or standard libraries cannot solve it.
- Type or interface changes at module boundaries are contract changes — check all consumers before modifying.

## After Writing or Modifying Code
1. Run existing tests. Fix any failures before proceeding.
2. New logic branches get tests.
3. Verify the change works in calling context, not just in isolation.

## When Stuck
If a fix attempt fails, STOP. Do not iterate blindly.
1. State what you expected vs. what happened.
2. Reduce scope — solve a smaller version of the problem first.
3. After 3 failed attempts at the same issue, surface your diagnosis and stop. Do not try a 4th approach without new information.

## DEVLOG
Maintain `DEVLOG.md` at project root. After every completed task, append a short entry:
- Date
- What changed (one line)
- What it affected
- Any gotchas or failed approaches worth remembering
