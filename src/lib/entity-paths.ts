export interface PathNode {
  id: string;
  tracked: boolean;
  context: boolean;
}

export interface PathEdge {
  a: string;
  b: string;
  articleCount: number;
}

export type Adjacency = Map<string, string[]>;

export interface NearestTrackedResult {
  id: string;
  hops: number;
  path: string[];
}

// Builds an undirected adjacency map. Duplicate pairs add their counts; self-loops are dropped.
// Each neighbor list is sorted by combined articleCount (descending), then id (ascending).
export function buildAdjacency(edges: PathEdge[]): Adjacency {
  const counts = new Map<string, Map<string, number>>();
  for (const edge of edges) {
    assertEdge(edge);
    if (edge.a === edge.b) continue;
    addCount(counts, edge.a, edge.b, edge.articleCount);
    addCount(counts, edge.b, edge.a, edge.articleCount);
  }
  const adj: Adjacency = new Map();
  for (const [id, neighbors] of counts) {
    const sorted = [...neighbors.entries()].sort(compareNeighbors);
    adj.set(
      id,
      sorted.map(([neighborId]) => neighborId),
    );
  }
  return adj;
}

// BFS shortest path. Includes both ends. Returns null for unknown ids, avoided ends, or no path.
export function shortestPath(
  adj: Adjacency,
  from: string,
  to: string,
  avoid: Set<string> = new Set(),
): string[] | null {
  if (!adj.has(from) || !adj.has(to)) return null;
  if (avoid.has(from) || avoid.has(to)) return null;
  if (from === to) return [from];
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === to) break;
    for (const next of neighborsOf(adj, current)) {
      if (avoid.has(next) || prev.has(next)) continue;
      prev.set(next, current);
      queue.push(next);
    }
  }
  if (!prev.has(to)) return null;
  return rebuildPath(prev, to);
}

// BFS from start to the nearest tracked, non-context nodes. Context nodes are traversed but
// never returned. Targets are not expanded further. Returns at most `limit` targets in BFS order.
export function nearestTracked(
  adj: Adjacency,
  nodes: Map<string, PathNode>,
  start: string,
  limit: number = 3,
): NearestTrackedResult[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`nearestTracked: limit must be a positive integer, got ${limit}`);
  }
  const prev = new Map<string, string | null>([[start, null]]);
  const dist = new Map<string, number>([[start, 0]]);
  const queue = [start];
  const found: string[] = [];
  let cutoff = Infinity;
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const currentDist = dist.get(current) ?? 0;
    if (currentDist >= cutoff) break;
    for (const next of neighborsOf(adj, current)) {
      if (dist.has(next)) continue;
      dist.set(next, currentDist + 1);
      prev.set(next, current);
      if (isTarget(nodeOf(nodes, next))) {
        cutoff = currentDist + 1;
        found.push(next);
      } else {
        queue.push(next);
      }
    }
  }
  return found.slice(0, limit).map((id) => ({
    id,
    hops: dist.get(id) ?? 0,
    path: rebuildPath(prev, id),
  }));
}

// Direct neighbors that are tracked and not context, in adjacency order.
export function trackedNeighbors(
  adj: Adjacency,
  nodes: Map<string, PathNode>,
  start: string,
): string[] {
  return neighborsOf(adj, start).filter((id) => isTarget(nodeOf(nodes, id)));
}

// Connected components restricted to `ids`. Ids with no edges are singleton groups.
// Each group is sorted by id; groups are sorted by size (descending), then first id.
export function connectedGroups(adj: Adjacency, ids: string[]): string[][] {
  const wanted = new Set(ids);
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const id of wanted) {
    if (seen.has(id)) continue;
    groups.push(collectGroup(adj, wanted, seen, id));
  }
  return groups.sort(compareGroups);
}

function assertEdge(edge: PathEdge): void {
  if (typeof edge.a !== "string" || edge.a.length === 0) {
    throw new Error(`buildAdjacency: invalid edge endpoint a: ${String(edge.a)}`);
  }
  if (typeof edge.b !== "string" || edge.b.length === 0) {
    throw new Error(`buildAdjacency: invalid edge endpoint b: ${String(edge.b)}`);
  }
  if (!Number.isFinite(edge.articleCount) || edge.articleCount < 0) {
    throw new Error(`buildAdjacency: invalid articleCount: ${edge.articleCount}`);
  }
}

function addCount(
  counts: Map<string, Map<string, number>>,
  from: string,
  to: string,
  amount: number,
): void {
  const row = counts.get(from) ?? new Map<string, number>();
  row.set(to, (row.get(to) ?? 0) + amount);
  counts.set(from, row);
}

function compareNeighbors(x: [string, number], y: [string, number]): number {
  if (x[1] !== y[1]) return y[1] - x[1];
  return compareText(x[0], y[0]);
}

function compareGroups(x: string[], y: string[]): number {
  if (x.length !== y.length) return y.length - x.length;
  return compareText(x[0], y[0]);
}

function compareText(x: string, y: string): number {
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

// Ids absent from the map have no edges, so they have no neighbors.
function neighborsOf(adj: Adjacency, id: string): string[] {
  return adj.get(id) ?? [];
}

function nodeOf(nodes: Map<string, PathNode>, id: string): PathNode {
  const node = nodes.get(id);
  if (node === undefined) {
    throw new Error(`entity-paths: node "${id}" has edges but no entry in nodes`);
  }
  return node;
}

function isTarget(node: PathNode): boolean {
  return node.tracked && !node.context;
}

function rebuildPath(prev: Map<string, string | null>, end: string): string[] {
  const path: string[] = [];
  let cursor: string | null = end;
  while (cursor !== null) {
    path.unshift(cursor);
    const parent = prev.get(cursor);
    if (parent === undefined) {
      throw new Error(`entity-paths: no predecessor recorded for "${cursor}"`);
    }
    cursor = parent;
  }
  return path;
}

function collectGroup(
  adj: Adjacency,
  wanted: Set<string>,
  seen: Set<string>,
  root: string,
): string[] {
  const members: string[] = [];
  const stack = [root];
  seen.add(root);
  let current = stack.pop();
  while (current !== undefined) {
    members.push(current);
    for (const next of neighborsOf(adj, current)) {
      if (!wanted.has(next) || seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
    current = stack.pop();
  }
  return members.sort(compareText);
}
