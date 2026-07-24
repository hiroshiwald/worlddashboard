-- Wikidata/Wikipedia fame layer: was the world already watching this entity
-- before local ingest ever saw it? Every column is additive and optional —
-- ingest must never depend on it (FABLE-ROADMAP.md §14), so every existing
-- row simply defaults to fame='unknown', the same verdict a brand-new
-- entity gets before its first sweep check.
--
-- fame='famous' is permanent (fame-sweep.ts never re-checks it);
-- 'not_famous' is re-checked periodically (a rising entity can graduate to
-- famous); 'unknown' covers both "never checked" and "lookup failed" —
-- fame_checked_at still advances on a failed lookup, so the retry queue
-- rotates instead of head-of-line blocking on one entity. wiki_title is
-- stored whenever a Wikidata match occurred, independent of the verdict, so
-- a wrong match (name collision with someone famous) stays visible and
-- human-correctable later.

ALTER TABLE entities ADD COLUMN fame TEXT NOT NULL DEFAULT 'unknown'
  CHECK (fame IN ('unknown', 'not_famous', 'famous'));
ALTER TABLE entities ADD COLUMN wiki_title TEXT;
ALTER TABLE entities ADD COLUMN wiki_sitelinks INT;
ALTER TABLE entities ADD COLUMN wiki_pageviews_monthly INT;
ALTER TABLE entities ADD COLUMN fame_checked_at TIMESTAMPTZ;
