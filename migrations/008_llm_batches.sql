-- Batches API: entity extraction now submits async batches instead of live
-- /v1/messages calls, billed at half the live per-token rate for an
-- identical request (see llm-extract.ts's BATCH_INPUT_USD_PER_MTOK /
-- BATCH_OUTPUT_USD_PER_MTOK). Results can land one ingest tick later than
-- article arrival — DESIGN.md's honest-time spine: articles.first_seen_at
-- (watch-time) is untouched by this, only extraction-derived data moves.
--
-- llm_batches holds the single pending batch. Invariant, enforced by
-- entity-ingest.ts (not by this schema): at most one row exists at a time.
-- article_ids are the cluster-head articles this batch covers, in the exact
-- order they were chunked and submitted — entity-ingest.ts re-derives the
-- same chunking from this array to align a result line's custom_id (chunk
-- index) back to its articles. While a row exists, those article ids stay
-- excluded from the next tick's head selection.
CREATE TABLE llm_batches (
  batch_id TEXT PRIMARY KEY,
  submitted_at TIMESTAMPTZ NOT NULL,
  article_ids BIGINT[] NOT NULL
);

-- Batched tokens are billed at half live-call rates — kept as separate
-- columns (rather than repricing input_tokens/output_tokens) so August's
-- already-recorded live spend keeps its live pricing forever.
ALTER TABLE llm_usage ADD COLUMN batch_input_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE llm_usage ADD COLUMN batch_output_tokens BIGINT NOT NULL DEFAULT 0;
