-- English translation of the headline, for the Newsfeed.
-- Contract: nullable; written when an LLM batch is applied, and only when the
-- model judged the title non-English (publisher suffix removed, max 300 chars).
-- NULL means the title is English, or the article was never LLM-extracted.
ALTER TABLE articles ADD COLUMN title_en TEXT;
