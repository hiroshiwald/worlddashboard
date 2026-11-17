import type Graph from "graphology";
import type { EmergingItem } from "@/lib/emerging-types";
import type { GraphEdge, GraphNode } from "@/lib/server/graph";
import { buildGraph, communities, type CommunityResult } from "./graph-metrics";
import type { MapData } from "./model";

const DAY_MS = 86_400_000;
const TOP_LINKS = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface NoveltyOptions {
  days: 7 | 14 | 30;
  /** null = novelty off: no top-N cut. */
  topN: number | null;
  hideFamous: boolean;
  hops: 0 | 1 | 2;
  hideHubs: boolean;
}

export interface NoveltyView {
  graph: Graph;
  communities: CommunityResult;
  reasons: Map<string, string>;
  firstSeen: Map<string, number>;
  followedCount: number;
}

export interface LinkAttrs {
  weight: number;
  firstSeenAt: string;
  articleCount: number;
}

function candidateNode(item: EmergingItem): GraphNode {
  return {
    id: item.key,
    name: item.name,
    type: item.type,
    status: "candidate",
    followed: false,
    role: "satellite",
    clusterIds: [],
    state: "New",
    ratio: 0,
    mentions14d: item.mentions,
    mergedInto: null,
  };
}

function anchorEdges(item: EmergingItem, known: Set<string>): GraphEdge[] {
  return item.anchors
    .filter((a) => known.has(a.id))
    .map((a) => ({
      a: item.key,
      b: a.id,
      articleCount: a.articleCount,
      weight: 0,
      firstSeenAt: item.firstSeenAt,
      lastSeenAt: item.firstSeenAt,
    }));
}

/** Adds each candidate as a node linked to its anchors that are in the graph. Entity items are skipped. */
export function mergeNewNames(
  nodes: GraphNode[],
  edges: GraphEdge[],
  items: EmergingItem[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const known = new Set(nodes.map((n) => n.id));
  const outNodes = [...nodes];
  const outEdges = [...edges];
  for (const item of items) {
    if (item.kind !== "candidate" || known.has(item.key)) continue;
    outNodes.push(candidateNode(item));
    outEdges.push(...anchorEdges(item, known));
  }
  return { nodes: outNodes, edges: outEdges };
}

/** Links first seen on or before asOf and last seen within `days` of asOf. */
export function windowEdges(edges: GraphEdge[], days: number, asOf: Date): GraphEdge[] {
  const end = asOf.getTime();
  const start = end - days * DAY_MS;
  return edges.filter(
    (e) => new Date(e.firstSeenAt).getTime() <= end && new Date(e.lastSeenAt).getTime() >= start,
  );
}

/** newness x log2(1 + lift) x evidence x bridge. */
export function linkSurprise(
  attrs: LinkAttrs,
  sameCommunity: boolean,
  days: number,
  asOf: Date,
): number {
  const firstSeen = new Date(attrs.firstSeenAt).getTime();
  const isNew = firstSeen >= asOf.getTime() - days * DAY_MS;
  const newness = isNew ? 1 : 0.2;
  const evidence = attrs.articleCount >= 2 ? 1 : 0.5;
  const bridge = sameCommunity ? 1 : 1.5;
  return newness * Math.log2(1 + attrs.weight) * evidence * bridge;
}

interface ScoredLink {
  other: string;
  score: number;
  attrs: LinkAttrs;
  sameCommunity: boolean;
}

function scoredLinks(
  graph: Graph,
  id: string,
  byNode: Map<string, number>,
  days: number,
  asOf: Date,
): ScoredLink[] {
  const links: ScoredLink[] = [];
  graph.forEachEdge(id, (_edge, attrs, source, target) => {
    const other = source === id ? target : source;
    const sameCommunity = byNode.get(id) === byNode.get(other);
    const linkAttrs = attrs as LinkAttrs;
    links.push({
      other,
      attrs: linkAttrs,
      sameCommunity,
      score: linkSurprise(linkAttrs, sameCommunity, days, asOf),
    });
  });
  return links.sort((x, y) => y.score - x.score);
}

/** Sum of the top 3 link scores, +1 for a new name, +0.5 when not famous. */
export function nodeScores(
  graph: Graph,
  byNode: Map<string, number>,
  days: number,
  asOf: Date,
): Map<string, number> {
  const scores = new Map<string, number>();
  graph.forEachNode((id, attrs) => {
    const top = scoredLinks(graph, id, byNode, days, asOf).slice(0, TOP_LINKS);
    let score = top.reduce((sum, l) => sum + l.score, 0);
    if (attrs.status === "candidate") score += 1;
    if (attrs.role !== "famous") score += 0.5;
    scores.set(id, score);
  });
  return scores;
}

/** Ids within `hops` of followed nodes, followed nodes included. */
export function hopsFromFollowed(graph: Graph, hops: number): Set<string> {
  let frontier: string[] = [];
  graph.forEachNode((id, attrs) => {
    if (attrs.followed === true) frontier.push(id);
  });
  const seen = new Set(frontier);
  for (let step = 0; step < hops; step++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const other of graph.neighbors(id)) {
        if (seen.has(other)) continue;
        seen.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return seen;
}

function passesFilters(graph: Graph, opts: Pick<NoveltyOptions, "hideFamous" | "hops">): string[] {
  const near = opts.hops > 0 ? hopsFromFollowed(graph, opts.hops) : null;
  return graph.filterNodes((id, attrs) => {
    if (opts.hideFamous && attrs.role === "famous") return false;
    if (near !== null && !near.has(id)) return false;
    return true;
  });
}

/** Filters, keeps the top N by score, then re-adds the anchors of kept new names. */
export function selectNovel(
  graph: Graph,
  scores: Map<string, number>,
  opts: Pick<NoveltyOptions, "topN" | "hideFamous" | "hops">,
): Set<string> {
  const ranked = passesFilters(graph, opts).sort(
    (x, y) => (scores.get(y) ?? 0) - (scores.get(x) ?? 0) || x.localeCompare(y),
  );
  const cut = opts.topN === null ? ranked : ranked.slice(0, opts.topN);
  const kept = new Set(cut);
  for (const id of cut) {
    if (graph.getNodeAttribute(id, "status") !== "candidate") continue;
    for (const anchor of graph.neighbors(id)) kept.add(anchor);
  }
  return kept;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function plural(n: number): string {
  return n === 1 ? "1 article" : `${n} articles`;
}

function nodeReason(
  graph: Graph,
  id: string,
  byNode: Map<string, number>,
  labels: Map<number, string>,
  days: number,
  asOf: Date,
): string {
  const links = scoredLinks(graph, id, byNode, days, asOf);
  const label = (other: string): string => graph.getNodeAttribute(other, "label") as string;
  if (graph.getNodeAttribute(id, "status") === "candidate") {
    const names = links.slice(0, TOP_LINKS).map((l) => label(l.other));
    const since = links.length > 0 ? `, first seen ${formatDay(links[0].attrs.firstSeenAt)}` : "";
    return names.length > 0
      ? `New name${since}, linked to ${names.join(", ")}`
      : "New name, no known links";
  }
  const windowStart = asOf.getTime() - days * DAY_MS;
  const fresh = links.find((l) => new Date(l.attrs.firstSeenAt).getTime() >= windowStart);
  if (fresh !== undefined) {
    return `New link to ${label(fresh.other)} (${plural(fresh.attrs.articleCount)})`;
  }
  const bridge = links.find((l) => !l.sameCommunity);
  if (bridge !== undefined) {
    const own = labels.get(byNode.get(id) as number);
    const far = labels.get(byNode.get(bridge.other) as number);
    return `Links the '${own}' and '${far}' groups`;
  }
  return "Known entity, no new links";
}

/** One plain line per node saying why it stands out. */
export function reasons(
  graph: Graph,
  byNode: Map<string, number>,
  labels: Map<number, string>,
  days: number,
  asOf: Date,
): Map<string, string> {
  const out = new Map<string, string>();
  graph.forEachNode((id) => out.set(id, nodeReason(graph, id, byNode, labels, days, asOf)));
  return out;
}

/** Earliest firstSeenAt (ms) of each node's links. Nodes with no links are always visible (-Infinity). */
export function firstSeen(graph: Graph): Map<string, number> {
  const out = new Map<string, number>();
  graph.forEachNode((id) => {
    let earliest = Number.NEGATIVE_INFINITY;
    let found = false;
    graph.forEachEdge(id, (_edge, attrs) => {
      const t = new Date(attrs.firstSeenAt as string).getTime();
      if (!found || t < earliest) earliest = t;
      found = true;
    });
    out.set(id, earliest);
  });
  return out;
}

function subgraph(graph: Graph, keep: Set<string>): Graph {
  const sub = graph.copy();
  for (const id of graph.nodes()) {
    if (!keep.has(id)) sub.dropNode(id);
  }
  return sub;
}

/** A new name whose anchors are hidden (hubs) or missing has no link; it stays in the side panel lists only. */
export function dropLoneNewNames(graph: Graph): void {
  const lone = graph.filterNodes((id, attrs) => attrs.status === "candidate" && graph.degree(id) === 0);
  for (const id of lone) graph.dropNode(id);
}

function countFollowed(graph: Graph): number {
  return graph.filterNodes((_id, attrs) => attrs.followed === true).length;
}

/** Merge new names, window, build, cluster, score, select. */
export function noveltyView(
  data: MapData,
  items: EmergingItem[],
  opts: NoveltyOptions,
  now: Date,
): NoveltyView {
  const merged = mergeNewNames(data.nodes, data.edges, items);
  const edges = windowEdges(merged.edges, opts.days, now);
  const graph = buildGraph(merged.nodes, edges, { hideHubs: opts.hideHubs }, now);
  dropLoneNewNames(graph);
  const followedCount = countFollowed(graph);
  const result = communities(graph);
  const scores = nodeScores(graph, result.byNode, opts.days, now);
  // With nothing tracked the hops filter would empty the map; the view shows a hint instead.
  const hops = followedCount === 0 ? 0 : opts.hops;
  const keep = selectNovel(graph, scores, { ...opts, hops });
  const sub = subgraph(graph, keep);
  return {
    graph: sub,
    communities: result,
    reasons: reasons(sub, result.byNode, result.labels, opts.days, now),
    firstSeen: firstSeen(sub),
    followedCount,
  };
}
