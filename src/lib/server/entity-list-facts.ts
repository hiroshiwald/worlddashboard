import { buildAdjacency, nearestTracked, trackedNeighbors } from "../entity-paths";
import type { PathEdge, PathNode } from "../entity-paths";
import { ratioText } from "../entity-growth";
import type { DiversityLabel, GrowthState } from "../entity-growth";
import { isAnchor } from "./developments";
import type { Sql, SqlRow } from "./db";
import type { EntityFacts } from "./entity-facts";

// Extra per-row fields for GET /api/entities list mode: growth, source
// diversity and the nearest tracked entities. SQL stays in loadNearestTracked;
// everything else here is pure.

export type FactSort = "growth" | "diversity" | "mentions";

export interface NearestTrackedRef {
  id: string;
  name: string;
  hops: number;
}

export interface EntityListFacts {
  growth: { state: GrowthState; ratio: number; ratioText: string; daily: number[] };
  sources: { count: number; label: DiversityLabel; top: string[] };
  nearestTracked: NearestTrackedRef[];
}

export interface AnchorInputs {
  anchorThreshold: number;
  baselineDailyById: Map<number, number>;
}

const EDGE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const NEAREST_LIMIT = 3;

export function isFactSort(sort: string): sort is FactSort {
  return sort === "growth" || sort === "diversity" || sort === "mentions";
}

export function toListFacts(facts: EntityFacts, nearest: NearestTrackedRef[]): EntityListFacts {
  return {
    growth: { state: facts.state, ratio: facts.ratio, ratioText: ratioText(facts.ratio), daily: facts.daily },
    sources: facts.sources,
    nearestTracked: nearest,
  };
}

// New first, WarmingUp last, everything else between.
function growthRank(state: GrowthState): number {
  if (state === "New") return 0;
  if (state === "WarmingUp") return 2;
  return 1;
}

/** Descending comparator for the facts-based sorts. */
export function compareByFacts(a: EntityFacts, b: EntityFacts, sort: FactSort): number {
  if (sort === "diversity") return b.sources.count - a.sources.count;
  if (sort === "mentions") return b.mentions14d - a.mentions14d;
  return growthRank(a.state) - growthRank(b.state) || b.ratio - a.ratio;
}

function toPathNodes(nodeRows: SqlRow[], anchors: AnchorInputs): Map<string, PathNode> {
  const nodes = new Map<string, PathNode>();
  for (const row of nodeRows) {
    const baseline = anchors.baselineDailyById.get(Number(row.id)) ?? 0;
    nodes.set(String(row.id), {
      id: String(row.id),
      tracked: row.status === "tracked",
      context: isAnchor(String(row.type), baseline, anchors.anchorThreshold),
    });
  }
  return nodes;
}

/** Pure. edgeRows {entity_a,entity_b,article_count}; nodeRows {id,canonical_name,
 * type,status} for every edge endpoint. Anchor-role nodes are traversed as
 * context, never returned. Tracked starts get direct tracked neighbors
 * (hops 1); other starts get the BFS-nearest tracked entities. */
export function computeNearestTracked(
  edgeRows: SqlRow[],
  nodeRows: SqlRow[],
  anchors: AnchorInputs,
  startIds: string[],
): Map<string, NearestTrackedRef[]> {
  const edges: PathEdge[] = edgeRows.map((row) => ({
    a: String(row.entity_a),
    b: String(row.entity_b),
    articleCount: Number(row.article_count),
  }));
  const adj = buildAdjacency(edges);
  const nodes = toPathNodes(nodeRows, anchors);
  const names = new Map(nodeRows.map((row) => [String(row.id), String(row.canonical_name)]));
  const refOf = (id: string, hops: number): NearestTrackedRef => ({ id, name: names.get(id) ?? id, hops });
  const result = new Map<string, NearestTrackedRef[]>();
  for (const start of startIds) {
    if (!adj.has(start)) continue;
    const refs =
      nodes.get(start)?.tracked === true
        ? trackedNeighbors(adj, nodes, start).map((id) => refOf(id, 1))
        : nearestTracked(adj, nodes, start, NEAREST_LIMIT).map((hit) => refOf(hit.id, hit.hops));
    result.set(start, refs.slice(0, NEAREST_LIMIT));
  }
  return result;
}

/** Two queries total: 14-day edges, then the entities at their endpoints. */
export async function loadNearestTracked(
  sql: Sql,
  startIds: string[],
  anchors: AnchorInputs,
  now: Date,
): Promise<Map<string, NearestTrackedRef[]>> {
  const since = new Date(now.getTime() - EDGE_WINDOW_MS).toISOString();
  const edgeRows = await sql`
    SELECT entity_a, entity_b, article_count
    FROM entity_edges WHERE last_seen_at >= ${since}::timestamptz`;
  if (edgeRows.length === 0) return new Map();
  const nodeIds = [...new Set(edgeRows.flatMap((row) => [String(row.entity_a), String(row.entity_b)]))];
  const nodeRows = await sql`
    SELECT id, canonical_name, type, status
    FROM entities WHERE id = ANY(${nodeIds}::bigint[])`;
  return computeNearestTracked(edgeRows, nodeRows, anchors, startIds);
}
