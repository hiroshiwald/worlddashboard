-- Schema v1: core article ingest + entity/signal tables.
-- entities, article_entities, entity_mentions_hourly, entity_edges,
-- entity_candidates, and signals are wired by later tasks; they are
-- created now so there is exactly one core migration.

CREATE TABLE articles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  title_signature TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  published_at TIMESTAMPTZ NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_name TEXT NOT NULL,
  source_category TEXT NOT NULL,
  source_tier TEXT NOT NULL,
  summary TEXT,
  image_url TEXT,
  dup_group_id BIGINT REFERENCES articles(id) ON DELETE SET NULL
);

CREATE INDEX articles_first_seen_at_idx ON articles (first_seen_at);
CREATE INDEX articles_title_signature_first_seen_at_idx ON articles (title_signature, first_seen_at);

CREATE TABLE entities (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('country', 'organization', 'region', 'person', 'other')),
  aliases TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'tracked' CHECK (status IN ('candidate', 'tracked', 'dismissed')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  notes TEXT
);

CREATE TABLE article_entities (
  article_id BIGINT REFERENCES articles(id) ON DELETE CASCADE,
  entity_id BIGINT REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, entity_id)
);

CREATE TABLE entity_mentions_hourly (
  entity_id BIGINT REFERENCES entities(id) ON DELETE CASCADE,
  bucket TIMESTAMPTZ NOT NULL,
  mentions INT NOT NULL,
  source_count INT NOT NULL,
  sentiment_sum REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_id, bucket)
);

CREATE TABLE entity_edges (
  entity_a BIGINT NOT NULL,
  entity_b BIGINT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  article_count INT NOT NULL,
  PRIMARY KEY (entity_a, entity_b),
  CHECK (entity_a < entity_b)
);

CREATE TABLE entity_candidates (
  name_norm TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  type_hint TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  mention_count INT NOT NULL,
  source_names TEXT[] NOT NULL,
  day_count INT NOT NULL,
  sample_titles TEXT[] NOT NULL
);

CREATE TABLE signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dedupe_key TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'seen', 'dismissed', 'promoted')),
  title TEXT NOT NULL,
  entity_ids BIGINT[] NOT NULL,
  confidence REAL NOT NULL,
  evidence JSONB NOT NULL,
  first_detected_at TIMESTAMPTZ NOT NULL,
  last_evidence_at TIMESTAMPTZ NOT NULL,
  state_changed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX signals_dedupe_key_active_idx ON signals (dedupe_key) WHERE state IN ('new', 'seen', 'promoted');

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
