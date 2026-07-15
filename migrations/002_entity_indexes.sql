-- entity_id-first lookup for entity->articles queries; the article_entities
-- PK (article_id, entity_id) only covers article_id-first lookups.
CREATE INDEX article_entities_entity_idx ON article_entities (entity_id);
