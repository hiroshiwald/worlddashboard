-- One-time repair: recomputes entity/edge first_seen_at/last_seen_at from
-- ARRIVAL time (articles.first_seen_at) instead of the publish-date-derived
-- values the pre-repair engine used, and clears every signal the
-- miscalibrated engine produced. Static, no-ops on an empty database (every
-- statement below affects zero rows when its source table is empty).

-- entities.first_seen_at/last_seen_at <- MIN/MAX(articles.first_seen_at) via
-- surviving article_entities links. An entity with no linked article (e.g.
-- dismissed before any link survived retention) is simply absent from the
-- `sub` join below and keeps its current values.
UPDATE entities e
SET first_seen_at = sub.min_first_seen,
    last_seen_at = sub.max_first_seen
FROM (
  SELECT ae.entity_id,
         MIN(a.first_seen_at) AS min_first_seen,
         MAX(a.first_seen_at) AS max_first_seen
  FROM article_entities ae
  JOIN articles a ON a.id = ae.article_id
  GROUP BY ae.entity_id
) sub
WHERE e.id = sub.entity_id;

-- entity_edges.first_seen_at/last_seen_at can't predate the system's
-- earliest possible observation (MIN(articles.first_seen_at)) — clamp
-- upward. Guarded by the WHERE so an empty articles table (MIN is NULL)
-- is a no-op instead of NULLing out a NOT NULL column.
UPDATE entity_edges
SET first_seen_at = GREATEST(first_seen_at, (SELECT MIN(first_seen_at) FROM articles)),
    last_seen_at = GREATEST(last_seen_at, (SELECT MIN(first_seen_at) FROM articles))
WHERE (SELECT MIN(first_seen_at) FROM articles) IS NOT NULL;

-- Every existing signal is an artifact of the miscalibrated engine.
DELETE FROM signals;
