// Pure model for the Entity map: filtering and trace.
import type { GraphEdge, GraphNode, GraphResponse } from "@/lib/server/graph";
import { buildAdjacency, shortestPath, type Adjacency } from "@/lib/entity-paths";


export interface MapData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  byId: Map<string, GraphNode>;
  adj: Adjacency;
}

export function isGrowing(n: GraphNode): boolean {
  return n.state === "New" || n.state === "Rising";
}

export function isContext(n: GraphNode): boolean {
  return n.role === "anchor";
}

/** Throws unless `raw` has the GET /api/graph shape this tab reads. */
export function parseGraph(raw: unknown): GraphResponse {
  const g = raw as Partial<GraphResponse> | null;
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges) || !Array.isArray(g.clusters) || !g.stats) {
    throw new Error("Unexpected response from /api/graph");
  }
  return g as GraphResponse;
}

/** Every live (not merged) entity and the edges between them: the whole universe the endpoint returned. */
export function liveGraph(all: GraphNode[], allEdges: GraphEdge[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = all.filter((n) => n.mergedInto === null);
  const live = new Set(nodes.map((n) => n.id));
  return { nodes, edges: allEdges.filter((e) => e.a !== e.b && live.has(e.a) && live.has(e.b)) };
}

/** The shown graph as lookup tables. */
export function buildMapData(nodes: GraphNode[], edges: GraphEdge[]): MapData {
  return { nodes, edges, byId: new Map(nodes.map((n) => [n.id, n])), adj: buildAdjacency(edges) };
}

export function growingFastest(data: MapData, limit: number = 8): GraphNode[] {
  return data.nodes
    .filter((n) => isGrowing(n) && !isContext(n) && n.mergedInto === null)
    .sort((a, b) => b.ratio - a.ratio || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function otherEnd(e: GraphEdge, id: string): string | null {
  if (e.a === id) return e.b;
  if (e.b === id) return e.a;
  return null;
}

export function neighboursOf(data: MapData, id: string): Array<{ node: GraphNode; edge: GraphEdge }> {
  const out: Array<{ node: GraphNode; edge: GraphEdge }> = [];
  for (const edge of data.edges) {
    const other = otherEnd(edge, id);
    if (other !== null) out.push({ node: data.byId.get(other)!, edge });
  }
  return out.sort((a, b) => b.edge.articleCount - a.edge.articleCount);
}

export type TraceResult =
  | { kind: "none" }
  | { kind: "path"; path: string[]; viaContext: boolean }
  | { kind: "unreachable" };

/** Shortest path between two shown entities; flags paths that exist only through context entities. */
export function traceConnection(data: MapData, from: string, to: string): TraceResult {
  if (from === "" || to === "" || from === to) return { kind: "none" };
  const path = shortestPath(data.adj, from, to);
  if (path === null) return { kind: "unreachable" };
  const context = new Set(data.nodes.filter(isContext).map((n) => n.id));
  context.delete(from);
  context.delete(to);
  const clean = shortestPath(data.adj, from, to, context);
  return { kind: "path", path, viaContext: clean === null };
}

export function edgeBetween(data: MapData, a: string, b: string): GraphEdge | undefined {
  return data.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

const TWO_DAYS_MS = 2 * 24 * 3600 * 1000;

export function isNewLink(edge: GraphEdge, generatedAt: string): boolean {
  return Date.parse(generatedAt) - Date.parse(edge.firstSeenAt) < TWO_DAYS_MS;
}
