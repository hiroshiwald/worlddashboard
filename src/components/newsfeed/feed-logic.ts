import { stripPublisherSuffix } from "@/lib/candidate-match";
import type { FeedArticle, FeedCandidate, FeedEntity, FeedResponse } from "@/lib/server/feed";

export type { FeedArticle, FeedCandidate, FeedEntity, FeedResponse };
export type FeedFilter = "all" | "tracked" | "untracked" | "new";

const HOUR_MS = 60 * 60 * 1000;
const NEW_ENTITY_MS = 24 * HOUR_MS;
const PUBLISH_LAG_MS = 6 * HOUR_MS;
const STALE_MS = 2 * HOUR_MS;

/** Headline text, plus the original title when it was translated (shown on hover with a "Translated" tag). */
export function headline(article: FeedArticle): { text: string; original: string | null } {
  if (article.titleEn) return { text: article.titleEn, original: article.title };
  return { text: stripPublisherSuffix(article.title), original: null };
}

/** One entity-or-candidate line in an article's third column. */
export interface RowEntity {
  key: string;
  name: string;
  status: "tracked" | "candidate" | "dismissed";
  entity: FeedEntity | null;
  candidate: FeedCandidate | null;
}

export const FILTER_LABELS: Record<FeedFilter, string> = {
  all: "All",
  tracked: "Mentions a tracked entity",
  untracked: "Has untracked entities",
  new: "New to us",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertArticle(raw: unknown): FeedArticle {
  if (!isObject(raw)) throw new Error("feed: item is not an object");
  const ok =
    typeof raw.id === "string" &&
    typeof raw.title === "string" &&
    typeof raw.link === "string" &&
    typeof raw.firstSeenAt === "string" &&
    Array.isArray(raw.entities) &&
    Array.isArray(raw.candidates);
  if (!ok) throw new Error("feed: item has an unexpected shape");
  return raw as unknown as FeedArticle;
}

/** Validates the /api/feed body at the module boundary. Throws on bad shape. */
export function parseFeedResponse(raw: unknown): FeedResponse {
  if (!isObject(raw) || !Array.isArray(raw.items)) throw new Error("feed: response has no items array");
  const nextCursor = typeof raw.nextCursor === "string" ? raw.nextCursor : null;
  const lastIngestAt = typeof raw.lastIngestAt === "string" ? raw.lastIngestAt : null;
  return { items: raw.items.map(assertArticle), nextCursor, lastIngestAt };
}

/** Same format as the server's encodeCursor: base64url of "<ISO>|<id>". */
export function cursorOf(article: FeedArticle): string {
  const bytes = new TextEncoder().encode(`${article.firstSeenAt}|${article.id}`);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isContext(entity: FeedEntity): boolean {
  return entity.role === "famous" || entity.role === "anchor";
}

const STATUS_ORDER = { tracked: 0, candidate: 1, dismissed: 2 };

/** Tracked first, then untracked (entities, then candidates), then dismissed. */
export function rowEntities(article: FeedArticle): RowEntity[] {
  const fromEntities: RowEntity[] = article.entities.map((entity) => ({
    key: `e${entity.id}`,
    name: entity.name,
    status: entity.status,
    entity,
    candidate: null,
  }));
  const fromCandidates: RowEntity[] = article.candidates.map((candidate) => ({
    key: `c${candidate.nameNorm}`,
    name: candidate.name,
    status: "candidate",
    entity: null,
    candidate,
  }));
  const all = [...fromEntities, ...fromCandidates];
  return all.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

/** The box under a headline: how the story touches the tracked world. */
export function worldNote(article: FeedArticle): { inWorld: string[]; notTracked: string[] } {
  const rows = rowEntities(article);
  return {
    inWorld: rows.filter((r) => r.status === "tracked").map((r) => r.name),
    notTracked: rows.filter((r) => r.status === "candidate").map((r) => r.name),
  };
}

function isRecent(iso: string, now: Date): boolean {
  return now.getTime() - new Date(iso).getTime() < NEW_ENTITY_MS;
}

export function matchesFilter(article: FeedArticle, filter: FeedFilter, now: Date): boolean {
  if (filter === "all") return true;
  const note = worldNote(article);
  if (filter === "tracked") return note.inWorld.length > 0;
  if (filter === "untracked") return note.notTracked.length > 0;
  const entityIsNew = article.entities.some((e) => e.status !== "dismissed" && isRecent(e.firstSeenAt, now));
  return entityIsNew || article.candidates.some((c) => isRecent(c.firstSeenAt, now));
}

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Case- and accent-insensitive match on headline (original and English), source, entity and candidate names. Blank query matches all. */
export function matchesSearch(article: FeedArticle, query: string): boolean {
  const needle = fold(query.trim());
  if (needle === "") return true;
  const fields = [
    article.title,
    article.titleEn ?? "",
    article.sourceName,
    ...article.entities.map((e) => e.name),
    ...article.candidates.map((c) => c.name),
  ];
  return fields.some((field) => fold(field).includes(needle));
}

export function countByFilter(items: FeedArticle[], now: Date): Record<FeedFilter, number> {
  const filters = Object.keys(FILTER_LABELS) as FeedFilter[];
  const counts = { all: 0, tracked: 0, untracked: 0, new: 0 };
  for (const filter of filters) counts[filter] = items.filter((a) => matchesFilter(a, filter, now)).length;
  return counts;
}

export function formatAgo(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Arrival first; publish time only when it lags arrival by 6 hours or more. */
export function timeLabel(article: FeedArticle, now: Date): string {
  const arrived = `Arrived ${formatAgo(article.firstSeenAt, now)}`;
  if (article.publishedAt === null) return arrived;
  const lag = new Date(article.firstSeenAt).getTime() - new Date(article.publishedAt).getTime();
  if (lag < PUBLISH_LAG_MS) return arrived;
  return `${arrived} · published ${formatAgo(article.publishedAt, now)}`;
}

export function sourceHost(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return link;
  }
}

export function isStale(lastIngestAt: string | null, now: Date): boolean {
  if (lastIngestAt === null) return true;
  return now.getTime() - new Date(lastIngestAt).getTime() > STALE_MS;
}

export type StatusChange = { entityId: string; status: "tracked" | "dismissed" };

/** Pure: sets one entity's status in every article. */
export function applyEntityStatus(items: FeedArticle[], change: StatusChange): FeedArticle[] {
  return items.map((article) => ({
    ...article,
    entities: article.entities.map((e) => (e.id === change.entityId ? { ...e, status: change.status } : e)),
  }));
}

/** Pure: moves a candidate into `entities` with the given status, in every article. */
export function applyCandidateStatus(
  items: FeedArticle[],
  candidate: FeedCandidate,
  status: "tracked" | "dismissed",
): FeedArticle[] {
  return items.map((article) => {
    if (!article.candidates.some((c) => c.nameNorm === candidate.nameNorm)) return article;
    const promoted: FeedEntity = {
      id: `cand:${candidate.nameNorm}`,
      name: candidate.name,
      type: candidate.typeHint,
      status,
      role: "satellite",
      firstSeenAt: candidate.firstSeenAt,
    };
    return {
      ...article,
      entities: [...article.entities, promoted],
      candidates: article.candidates.filter((c) => c.nameNorm !== candidate.nameNorm),
    };
  });
}

/** Newest-first merge of held articles above the list, skipping ids already shown. */
export function mergeNewer(items: FeedArticle[], newer: FeedArticle[]): FeedArticle[] {
  const seen = new Set(items.map((a) => a.id));
  return [...newer.filter((a) => !seen.has(a.id)), ...items];
}
