-- Entity ontology upgrade: expand entities.type from 5 coarse types to a
-- working ontology, and add directed typed relationships between entities.
-- Every existing production value ('country', 'organization', 'region',
-- 'person', 'other') remains valid under the new constraint — no data
-- migration needed.

ALTER TABLE entities DROP CONSTRAINT entities_type_check;
ALTER TABLE entities ADD CONSTRAINT entities_type_check CHECK (type IN (
  'person', 'company', 'organization', 'government_body', 'armed_group',
  'political_party', 'country', 'region', 'city', 'product', 'technology',
  'financial_asset', 'disease', 'infrastructure', 'other'
));

-- Directed, typed relationships extracted between entities (e.g. Hyundai
-- -acquisition-> Boston Dynamics), evidence-linked to the article that most
-- recently supported them. Undirected co-occurrence (entity_edges) is
-- unaffected — this is a separate, additive layer.
CREATE TABLE entity_relations (
  source_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN (
    'acquisition', 'investment', 'appointment', 'partnership', 'funding',
    'sanction', 'legal_action', 'conflict', 'regulation', 'supply',
    'membership', 'statement_about', 'other'
  )),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  article_count INT NOT NULL,
  evidence_article_id BIGINT REFERENCES articles(id) ON DELETE SET NULL,
  PRIMARY KEY (source_id, target_id, relation),
  CHECK (source_id <> target_id)
);

CREATE INDEX entity_relations_target_idx ON entity_relations (target_id);
