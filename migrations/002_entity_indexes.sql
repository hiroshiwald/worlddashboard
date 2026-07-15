-- entity_id-first lookup for entity->articles queries; the article_entities
-- PK (article_id, entity_id) only covers article_id-first lookups.
CREATE INDEX article_entities_entity_idx ON article_entities (entity_id);

-- Explicit processed marker for the entity ingest pass, replacing a
-- NOT EXISTS(article_entities) check. An article whose extracted names are
-- ALL unresolved candidates never gets an article_entities row, so under the
-- old NOT EXISTS gate it was re-selected (and re-accumulated into
-- entity_candidates) every run for its whole 6h lookback window. A plain
-- column set once, unconditionally, at the end of a run fixes that.
ALTER TABLE articles ADD COLUMN entities_processed_at TIMESTAMPTZ;

-- entity_b-first lookup for entity->edges queries; the entity_edges PK
-- (entity_a, entity_b) only covers entity_a-first lookups.
CREATE INDEX entity_edges_entity_b_idx ON entity_edges (entity_b);
