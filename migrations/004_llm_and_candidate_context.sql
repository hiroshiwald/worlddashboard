-- LLM extraction budget ledger, plus candidate-context/co-occurrence columns
-- for entity_candidates (populated by the LLM extraction layer, rendered on
-- the Review tab).

CREATE TABLE llm_usage (
  month TEXT PRIMARY KEY,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  calls INT NOT NULL DEFAULT 0
);

ALTER TABLE entity_candidates ADD COLUMN contexts TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE entity_candidates ADD COLUMN co_entities TEXT[] NOT NULL DEFAULT '{}';
