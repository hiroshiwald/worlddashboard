-- Human fame overrides: a manual verdict must survive the automated sweep.
-- fame_locked=true marks an entity whose fame column was last set by a
-- human (PATCH /api/entities/[id]) rather than fame-sweep.ts's periodic
-- Wikidata check. selectSweepBatch (fame-sweep.ts) excludes locked rows
-- from every selection branch, so a corrected verdict (e.g. "Anthony
-- Joshua" wrongly landing on not_famous because Wikidata's search returned
-- nothing) is never silently overwritten by the next sweep. Setting fame
-- via the PATCH endpoint sets fame_locked=true automatically; an explicit
-- {fameLocked: false} PATCH releases the entity back to the sweep. Every
-- existing row defaults to fame_locked=false, identical to an entity the
-- sweep has always been free to (re)check.

ALTER TABLE entities ADD COLUMN fame_locked BOOLEAN NOT NULL DEFAULT false;
