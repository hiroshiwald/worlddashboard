import { buildAdjacency, connectedGroups, type PathEdge } from "../entity-paths";
import type { GrowthState } from "../entity-growth";
import { buildMergeGroups, type MergeEntity } from "../soft-merge";
import { cosineWeight, entityTopics, type ArticleTopic } from "../topic-membership";
import type { Sql, SqlRow } from "./db";
import { attachEntityRoles, type EntityRole } from "./entity-admin";
import { loadEntityFacts, type EntityFacts } from "./entity-facts";

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  status: string;
  role: EntityRole;
  clusterIds: string[];
  state: GrowthState;
  ratio: number;
  mentions14d: number;
  mergedInto: string | null;
}

export interface GraphEdge {
  a: string;
  b: string;
  articleCount: number;
  weight: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface GraphCluster {
  id: string;
  label: string;
  size: number;
  risingCount: number;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  islands: number;
  isolated: number;
  islandsWithoutContext: number;
  isolatedWithoutContext: number;
  capped: boolean;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  stats: GraphStats;
  generatedAt: string;
}

const WINDOW_DAYS = 14;
const MAX_CANDIDATES = 150;
const MAX_NODES = 300;

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(value as string).toISOString();
}

/** Pure. Drops the lowest-mentions non-tracked rows until at most `max`
 * remain. Tracked rows are never dropped, so the result can exceed `max`. */
export function capPopulation(
  rows: SqlRow[],
  mentionsById: Map<string, number>,
  max: number,
): { kept: SqlRow[]; capped: boolean } {
  if (rows.length <= max) return { kept: rows, capped: false };
  const mentions = (row: SqlRow) => mentionsById.get(String(row.id)) ?? 0;
  const droppable = rows
    .filter((row) => row.status !== "tracked")
    .sort((a, b) => mentions(a) - mentions(b) || Number(a.id) - Number(b.id));
  const dropCount = Math.min(rows.length - max, droppable.length);
  const dropped = new Set(droppable.slice(0, dropCount).map((row) => String(row.id)));
  return { kept: rows.filter((row) => !dropped.has(String(row.id))), capped: dropped.size > 0 };
}

/** Pure. Keeps edges whose ends are both in `mentionsById`; weight is cosine. */
export function toGraphEdges(edgeRows: SqlRow[], mentionsById: Map<string, number>): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const row of edgeRows) {
    const a = String(row.entity_a);
    const b = String(row.entity_b);
    const countA = mentionsById.get(a);
    const countB = mentionsById.get(b);
    if (countA === undefined || countB === undefined) continue;
    const articleCount = Number(row.article_count);
    edges.push({
      a,
      b,
      articleCount,
      weight: cosineWeight(articleCount, countA, countB),
      firstSeenAt: toIso(row.first_seen_at),
      lastSeenAt: toIso(row.last_seen_at),
    });
  }
  return edges;
}

/** Pure. id -> canonical id for non-canonical members of a merge group. */
export function mergedIntoById(entities: MergeEntity[]): Map<string, string> {
  const merged = new Map<string, string>();
  for (const group of buildMergeGroups(entities)) {
    for (const id of group.memberIds) {
      if (id !== group.canonicalId) merged.set(id, group.canonicalId);
    }
  }
  return merged;
}

/** Pure. membership: entity id -> topic labels (from entityTopics). Entities
 * without topics get no clusters; an empty membership yields no clusters. */
export function assignClusters(
  nodes: Pick<GraphNode, "id" | "state">[],
  membership: Map<string, string[]>,
): { clusters: GraphCluster[]; clusterIdsByNode: Map<string, string[]> } {
  const byTopic = new Map<string, GraphCluster>();
  const clusterIdsByNode = new Map<string, string[]>();
  for (const node of nodes) {
    const topics = membership.get(node.id) ?? [];
    clusterIdsByNode.set(node.id, topics);
    for (const topic of topics) {
      const cluster = byTopic.get(topic) ?? { id: topic, label: topic, size: 0, risingCount: 0 };
      cluster.size += 1;
      if (node.state === "Rising" || node.state === "New") cluster.risingCount += 1;
      byTopic.set(topic, cluster);
    }
  }
  const clusters = [...byTopic.values()].sort((x, y) => y.size - x.size || x.id.localeCompare(y.id));
  return { clusters, clusterIdsByNode };
}

function countGroups(ids: string[], edges: PathEdge[]): { islands: number; isolated: number } {
  const groups = connectedGroups(buildAdjacency(edges), ids);
  const isolated = groups.filter((group) => group.length === 1).length;
  return { islands: groups.length - isolated, isolated };
}

/** Pure. An island is a connected group of 2+ nodes; isolated nodes have no
 * edges. The "without context" numbers drop anchor-role nodes and their edges. */
export function buildStats(
  nodes: Pick<GraphNode, "id" | "role">[],
  edges: GraphEdge[],
  capped: boolean,
): GraphStats {
  const all = countGroups(nodes.map((n) => n.id), edges);
  const keep = new Set(nodes.filter((n) => n.role !== "anchor").map((n) => n.id));
  const keptEdges = edges.filter((e) => keep.has(e.a) && keep.has(e.b));
  const noContext = countGroups([...keep], keptEdges);
  return {
    nodes: nodes.length,
    edges: edges.length,
    islands: all.islands,
    isolated: all.isolated,
    islandsWithoutContext: noContext.islands,
    isolatedWithoutContext: noContext.isolated,
    capped,
  };
}

function factsFor(facts: Map<string, EntityFacts>, id: string): EntityFacts {
  const found = facts.get(id);
  if (!found) throw new Error(`graph: no facts for entity ${id}`);
  return found;
}

function toMergeEntity(row: SqlRow, mentions14d: number): MergeEntity {
  return {
    id: String(row.id),
    name: String(row.canonical_name),
    type: String(row.type),
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
    wikiTitle: row.wiki_title == null ? null : String(row.wiki_title),
    mentions: mentions14d,
  };
}

/** Pure. rows: entity rows already capped; roleById from attachEntityRoles. */
export function assembleGraph(
  rows: SqlRow[],
  facts: Map<string, EntityFacts>,
  roleById: Map<string, EntityRole>,
  edgeRows: SqlRow[],
  capped: boolean,
  now: Date,
  membership: Map<string, string[]>,
): GraphResponse {
  const mentionsById = new Map(rows.map((r) => [String(r.id), factsFor(facts, String(r.id)).mentions14d]));
  const merged = mergedIntoById(rows.map((r) => toMergeEntity(r, mentionsById.get(String(r.id)) ?? 0)));
  const nodes: GraphNode[] = rows.map((row) => {
    const id = String(row.id);
    const fact = factsFor(facts, id);
    return {
      id,
      name: String(row.canonical_name),
      type: String(row.type),
      status: String(row.status),
      role: roleById.get(id) ?? "satellite",
      clusterIds: [],
      state: fact.state,
      ratio: fact.ratio,
      mentions14d: fact.mentions14d,
      mergedInto: merged.get(id) ?? null,
    };
  });
  const { clusters, clusterIdsByNode } = assignClusters(nodes, membership);
  for (const node of nodes) node.clusterIds = clusterIdsByNode.get(node.id) ?? [];
  const edges = toGraphEdges(edgeRows, mentionsById);
  return { nodes, edges, clusters, stats: buildStats(nodes, edges, capped), generatedAt: now.toISOString() };
}

/** Tracked entities plus the top candidates that link to a tracked entity,
 * ranked by recent link count then distinct sources. One query. */
async function loadPopulation(sql: Sql, since: string): Promise<SqlRow[]> {
  return sql`
    WITH recent AS (
      SELECT entity_a, entity_b FROM entity_edges WHERE last_seen_at >= ${since}::timestamptz
    ), pairs AS (
      SELECT entity_a AS id, entity_b AS other FROM recent
      UNION ALL SELECT entity_b, entity_a FROM recent
    ), linked AS (
      SELECT c.id, COUNT(*) AS links
      FROM pairs p
      JOIN entities c ON c.id = p.id AND c.status = 'candidate'
      JOIN entities t ON t.id = p.other AND t.status = 'tracked'
      GROUP BY c.id
    ), top_candidates AS (
      SELECT l.id FROM linked l
      ORDER BY l.links DESC, (
        SELECT COUNT(DISTINCT a.source_name) FROM article_entities ae
        JOIN articles a ON a.id = ae.article_id
        WHERE ae.entity_id = l.id AND a.first_seen_at >= ${since}::timestamptz
      ) DESC, l.id
      LIMIT ${MAX_CANDIDATES}
    )
    SELECT id, canonical_name, type, status, aliases, fame, wiki_title FROM entities
    WHERE status = 'tracked' OR id IN (SELECT id FROM top_candidates)`;
}

async function loadEdges(sql: Sql, ids: string[], since: string): Promise<SqlRow[]> {
  if (ids.length === 0) return [];
  return sql`SELECT entity_a, entity_b, article_count, first_seen_at, last_seen_at
    FROM entity_edges
    WHERE entity_a = ANY(${ids}::bigint[]) AND entity_b = ANY(${ids}::bigint[])
      AND last_seen_at >= ${since}::timestamptz`;
}

/** One row per (article, entity) for topic-labelled articles in the window. */
async function loadTopicMembership(sql: Sql, ids: string[], since: string): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const rows = await sql`SELECT ae.article_id AS topic_article_id, a.topic AS article_topic, ae.entity_id AS topic_entity_id
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE ae.entity_id = ANY(${ids}::bigint[])
      AND a.first_seen_at >= ${since}::timestamptz
      AND a.topic IS NOT NULL`;
  const byArticle = new Map<string, ArticleTopic>();
  for (const row of rows) {
    const articleId = String(row.topic_article_id);
    const article = byArticle.get(articleId) ?? { articleId, topic: String(row.article_topic), entityIds: [] };
    article.entityIds.push(String(row.topic_entity_id));
    byArticle.set(articleId, article);
  }
  return entityTopics([...byArticle.values()]);
}

export async function loadRoleMap(sql: Sql, rows: SqlRow[]): Promise<Map<string, EntityRole>> {
  const inputs = rows.map((row) => ({
    id: Number(row.id),
    canonicalName: String(row.canonical_name),
    type: String(row.type),
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
    fame: String(row.fame),
  }));
  const classified = await attachEntityRoles(sql, inputs);
  return new Map(classified.map((e) => [String(e.id), e.role]));
}

export async function loadGraph(sql: Sql, now: Date): Promise<GraphResponse> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const population = await loadPopulation(sql, since);
  const facts = await loadEntityFacts(sql, population.map((r) => String(r.id)), now);
  const mentionsById = new Map(population.map((r) => [String(r.id), factsFor(facts, String(r.id)).mentions14d]));
  const { kept, capped } = capPopulation(population, mentionsById, MAX_NODES);
  const edgeRows = await loadEdges(sql, kept.map((r) => String(r.id)), since);
  const roleById = await loadRoleMap(sql, kept);
  const membership = await loadTopicMembership(sql, kept.map((r) => String(r.id)), since);
  return assembleGraph(kept, facts, roleById, edgeRows, capped, now, membership);
}
