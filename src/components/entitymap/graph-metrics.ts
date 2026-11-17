import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import betweenness from "graphology-metrics/centrality/betweenness";
import type { GraphEdge, GraphNode } from "@/lib/server/graph";

const DAY_MS = 86_400_000;
const NEW_EDGE_DAYS = 7;
const HUB_TYPES = new Set(["country", "region", "city"]);
const HUB_MIN_NODES = 5;
const SIZE_MIN = 3;
const SIZE_MAX = 20;

export interface Broker {
  id: string;
  name: string;
  now: number;
  before: number;
}

export interface CommunityResult {
  byNode: Map<string, number>;
  labels: Map<number, string>;
}

/** observed / expected co-mentions. Mentions floor at 1 so expected is never 0. */
export function liftWeight(
  coMentions: number,
  mentionsA: number,
  mentionsB: number,
  totalMentions: number,
): number {
  const expected = (Math.max(mentionsA, 1) * Math.max(mentionsB, 1)) / Math.max(totalMentions, 1);
  return coMentions / expected;
}

export function isNewEdge(edge: GraphEdge, now: Date): boolean {
  const age = now.getTime() - new Date(edge.firstSeenAt).getTime();
  return age <= NEW_EDGE_DAYS * DAY_MS;
}

/** Edges first seen within 7 days of now, newest first. */
export function newEdges(edges: GraphEdge[], now: Date): GraphEdge[] {
  return edges
    .filter((e) => isNewEdge(e, now))
    .sort((x, y) => new Date(y.firstSeenAt).getTime() - new Date(x.firstSeenAt).getTime());
}

/** Ids of country/region/city nodes plus the top 1% by degree (at least 5 nodes). */
export function hubIds(nodes: GraphNode[], edges: GraphEdge[]): Set<string> {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const topCount = Math.max(HUB_MIN_NODES, Math.ceil(nodes.length * 0.01));
  const byDegree = [...nodes].sort((x, y) => (degree.get(y.id) ?? 0) - (degree.get(x.id) ?? 0));
  const ids = new Set(byDegree.slice(0, topCount).map((n) => n.id));
  for (const n of nodes) {
    if (HUB_TYPES.has(n.type)) ids.add(n.id);
  }
  return ids;
}

function nodeSize(mentions: number, maxMentions: number): number {
  if (maxMentions <= 0) return SIZE_MIN;
  const ratio = Math.sqrt(Math.max(mentions, 0) / maxMentions);
  return SIZE_MIN + ratio * (SIZE_MAX - SIZE_MIN);
}

function addNodes(graph: Graph, nodes: GraphNode[]): void {
  const maxMentions = Math.max(0, ...nodes.map((n) => n.mentions14d));
  for (const n of nodes) {
    graph.addNode(n.id, {
      label: n.name,
      size: nodeSize(n.mentions14d, maxMentions),
      type: n.type,
      followed: n.followed,
      state: n.state,
      mentions: n.mentions14d,
    });
  }
}

function addEdges(graph: Graph, edges: GraphEdge[], now: Date): void {
  const totalMentions = graph.reduceNodes((sum, _, a) => sum + (a.mentions as number), 0);
  for (const e of edges) {
    if (!graph.hasNode(e.a) || !graph.hasNode(e.b) || e.a === e.b) continue;
    if (graph.hasEdge(e.a, e.b)) continue;
    const weight = liftWeight(
      e.articleCount,
      graph.getNodeAttribute(e.a, "mentions"),
      graph.getNodeAttribute(e.b, "mentions"),
      totalMentions,
    );
    graph.addUndirectedEdge(e.a, e.b, {
      weight,
      isNew: isNewEdge(e, now),
      firstSeenAt: e.firstSeenAt,
    });
  }
}

/** Undirected graph; edges touching hubs are dropped when hideHubs is set. */
export function buildGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: { hideHubs: boolean },
  now: Date,
): Graph {
  const hidden = opts.hideHubs ? hubIds(nodes, edges) : new Set<string>();
  const graph = new Graph({ type: "undirected" });
  addNodes(graph, nodes.filter((n) => !hidden.has(n.id)));
  addEdges(graph, edges, now);
  return graph;
}

function communityLabel(graph: Graph, ids: string[]): string {
  return ids
    .sort((x, y) => graph.getNodeAttribute(y, "mentions") - graph.getNodeAttribute(x, "mentions"))
    .slice(0, 3)
    .map((id) => graph.getNodeAttribute(id, "label"))
    .join(", ");
}

/** Weighted Louvain. Labels are the top 3 names by mentions per community. */
export function communities(graph: Graph): CommunityResult {
  const byNode = new Map<string, number>();
  const labels = new Map<number, string>();
  if (graph.order === 0) return { byNode, labels };
  const assignment = louvain(graph, { getEdgeWeight: "weight" });
  const members = new Map<number, string[]>();
  for (const [id, c] of Object.entries(assignment)) {
    byNode.set(id, c);
    members.set(c, [...(members.get(c) ?? []), id]);
  }
  for (const [c, ids] of members) labels.set(c, communityLabel(graph, ids));
  return { byNode, labels };
}

/** Betweenness (unweighted) with and without edges first seen in the last 7 days. */
export function brokers(graph: Graph, now: Date, limit = 10): Broker[] {
  const old = graph.copy();
  old.forEachEdge((edge, attrs) => {
    const created = new Date(attrs.firstSeenAt as string).getTime();
    if (now.getTime() - created <= NEW_EDGE_DAYS * DAY_MS) old.dropEdge(edge);
  });
  const after = betweenness(graph, { getEdgeWeight: null });
  const before = betweenness(old, { getEdgeWeight: null });
  return graph
    .mapNodes((id, attrs) => ({
      id,
      name: attrs.label as string,
      now: after[id],
      before: before[id],
    }))
    .sort((x, y) => y.now - y.before - (x.now - x.before))
    .slice(0, limit);
}
