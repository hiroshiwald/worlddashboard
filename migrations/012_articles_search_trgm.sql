-- Trigram indexes for the Newsfeed search (feed.ts searchArticlePage).
-- A leading-wildcard ILIKE ('%term%') cannot use a btree index, so without
-- these a rare term scans every article. GIN trigram indexes serve ILIKE
-- directly. Entities and their aliases are a small table and are scanned.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS articles_title_trgm_idx ON articles USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS articles_title_en_trgm_idx ON articles USING gin (title_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS articles_summary_trgm_idx ON articles USING gin (summary gin_trgm_ops);
