-- Model-written topic per article (BUILD-GUIDE-INTERFACE-V2.md 6.5, option B).
-- Contract: nullable; a short label (max 60 chars) written when an LLM batch
-- is applied; "Other" when the model could not place the article. NULL means
-- the article was never LLM-extracted (heuristic fallback, or pre-009 rows).
ALTER TABLE articles ADD COLUMN topic TEXT;

CREATE INDEX articles_topic_first_seen_at_idx ON articles (topic, first_seen_at) WHERE topic IS NOT NULL;
