// Pure model for the Entity map: filtering, trace, entity-level layout.
import type { GraphEdge, GraphNode, GraphResponse } from "@/lib/server/graph";
import { ratioText } from "@/lib/entity-growth";
import { buildAdjacency, shortestPath, type Adjacency } from "@/lib/entity-paths";
import type { Point } from "@/lib/map-layout";

const ENTITY_RING = 190;
const MAX_IN_BUBBLE = 12;
export const LINKED_ID = "linked";
export const CONTEXT_ID = "ctx";

export interface MapData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  byId: Map<string, GraphNode>;
  adj: Adjacency;
}

export function isGrowing(n: GraphNode): boolean {
  return n.state === "New" || n.state === "Rising";
}

export function labelText(n: GraphNode): string {
  return isGrowing(n) ? `${n.name} ▲ ×${ratioText(n.ratio)}` : n.name;
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

export interface Bubble {
  gid: string;
  label: string;
  x: number;
  y: number;
  r: number;
  members: Array<{ id: string; x: number; y: number }>;
  more: number;
}

export interface EntityLayout {
  center: Point;
  bubbles: Bubble[];
  width: number;
  height: number;
}

function bubbleOf(gid: string, ids: string[], at: Point): Bubble {
  const shown = ids.slice(0, MAX_IN_BUBBLE);
  const r = 34 + shown.length * 4;
  const members = shown.map((id, i) => {
    const a = (2 * Math.PI * i) / shown.length - Math.PI / 2;
    const ring = shown.length === 1 ? 0 : r - 16;
    return { id, x: at.x + ring * Math.cos(a), y: at.y + ring * Math.sin(a) };
  });
  const label = gid === CONTEXT_ID ? "Context" : "Linked";
  return { gid, label, x: at.x, y: at.y, r, members, more: ids.length - shown.length };
}

/** Entity at the centre; context neighbours in one bubble, the rest in another. */
export function layoutEntity(data: MapData, id: string, width: number): EntityLayout {
  const buckets = new Map<string, string[]>();
  for (const { node } of neighboursOf(data, id)) {
    const gid = isContext(node) ? CONTEXT_ID : LINKED_ID;
    buckets.set(gid, [...(buckets.get(gid) ?? []), node.id]);
  }
  const height = 2 * (ENTITY_RING + 110);
  const center = { x: width / 2, y: height / 2 };
  const entries = [...buckets];
  const bubbles = entries.map(([gid, ids], i) => {
    const a = (2 * Math.PI * i) / entries.length - Math.PI / 2;
    const at = { x: center.x + ENTITY_RING * Math.cos(a) * 1.3, y: center.y + ENTITY_RING * Math.sin(a) };
    return bubbleOf(gid, ids, at);
  });
  return { center, bubbles, width, height };
}
