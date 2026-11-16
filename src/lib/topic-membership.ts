export const OTHER_TOPIC = "Other";

const MIN_ARTICLES_PER_TOPIC = 2;

export interface ArticleTopic {
  articleId: string;
  topic: string;
  entityIds: string[];
}

export interface TopicLink {
  a: string;
  b: string;
  sharedEntities: number;
  weight: number;
}

function assertNonEmptyString(value: unknown, label: string): void {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  if (value.trim() === "") {
    throw new Error(`${label} must not be empty`);
  }
}

function validateArticle(article: ArticleTopic): void {
  assertNonEmptyString(article.articleId, "articleId");
  if (typeof article.topic !== "string") {
    throw new Error("topic must be a string");
  }
  if (!Array.isArray(article.entityIds)) {
    throw new Error("entityIds must be an array");
  }
  for (const entityId of article.entityIds) {
    assertNonEmptyString(entityId, "entityId");
  }
}

function normalizeTopic(topic: string): string {
  const trimmed = topic.trim();
  if (trimmed === "") {
    return OTHER_TOPIC;
  }
  return trimmed;
}

function addId(index: Map<string, Set<string>>, key: string, id: string): void {
  const ids = index.get(key) ?? new Set<string>();
  ids.add(id);
  index.set(key, ids);
}

function requireCount(counts: Map<string, number>, key: string): number {
  const count = counts.get(key);
  if (count === undefined) {
    throw new Error(`no count for "${key}"`);
  }
  return count;
}

function compareNames(x: string, y: string): number {
  if (x < y) {
    return -1;
  }
  if (x > y) {
    return 1;
  }
  return 0;
}

function compareByCount(x: string, y: string, counts: Map<string, number>): number {
  const diff = requireCount(counts, y) - requireCount(counts, x);
  if (diff !== 0) {
    return diff;
  }
  return compareNames(x, y);
}

function rankByCount(names: string[], counts: Map<string, number>): string[] {
  return [...names].sort((x, y) => compareByCount(x, y, counts));
}

// Distinct article count per normalized topic, across all input articles.
function topicTotals(articles: ArticleTopic[]): Map<string, number> {
  const ids = new Map<string, Set<string>>();
  for (const article of articles) {
    addId(ids, normalizeTopic(article.topic), article.articleId);
  }
  const totals = new Map<string, number>();
  for (const [topic, articleIds] of ids) {
    totals.set(topic, articleIds.size);
  }
  return totals;
}

// entity -> topic -> distinct article ids in which the entity appears under that topic.
function collectEntityTopics(
  articles: ArticleTopic[],
): Map<string, Map<string, Set<string>>> {
  const index = new Map<string, Map<string, Set<string>>>();
  for (const article of articles) {
    const topic = normalizeTopic(article.topic);
    for (const entityId of article.entityIds) {
      const topics = index.get(entityId) ?? new Map<string, Set<string>>();
      addId(topics, topic, article.articleId);
      index.set(entityId, topics);
    }
  }
  return index;
}

function qualifyingTopics(topics: Map<string, Set<string>>): string[] {
  const qualifying: string[] = [];
  for (const [topic, articleIds] of topics) {
    if (topic !== OTHER_TOPIC && articleIds.size >= MIN_ARTICLES_PER_TOPIC) {
      qualifying.push(topic);
    }
  }
  return qualifying;
}

// Falls back to the single most common topic (Other included) when none qualifies.
function pickEntityTopics(
  topics: Map<string, Set<string>>,
  totals: Map<string, number>,
): string[] {
  const qualifying = qualifyingTopics(topics);
  if (qualifying.length > 0) {
    return rankByCount(qualifying, totals);
  }
  const entityCounts = new Map<string, number>();
  for (const [topic, articleIds] of topics) {
    entityCounts.set(topic, articleIds.size);
  }
  const ranked = rankByCount([...topics.keys()], entityCounts);
  return [ranked[0]];
}

export function entityTopics(articles: ArticleTopic[]): Map<string, string[]> {
  for (const article of articles) {
    validateArticle(article);
  }
  const index = collectEntityTopics(articles);
  const totals = topicTotals(articles);
  const result = new Map<string, string[]>();
  for (const [entityId, topics] of index) {
    result.set(entityId, pickEntityTopics(topics, totals));
  }
  return result;
}

export function cosineWeight(shared: number, countA: number, countB: number): number {
  assertNonNegative(shared, "shared");
  assertNonNegative(countA, "countA");
  assertNonNegative(countB, "countB");
  if (shared === 0 || countA === 0 || countB === 0) {
    return 0;
  }
  return shared / Math.sqrt(countA * countB);
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (value < 0) {
    throw new Error(`${label} must not be negative`);
  }
}

function increment(index: Map<string, Map<string, number>>, a: string, b: string): void {
  const inner = index.get(a) ?? new Map<string, number>();
  inner.set(b, (inner.get(b) ?? 0) + 1);
  index.set(a, inner);
}

function orderPair(x: string, y: string): [string, string] {
  if (x < y) {
    return [x, y];
  }
  return [y, x];
}

function countPairs(shared: Map<string, Map<string, number>>, topics: string[]): void {
  for (let i = 0; i < topics.length; i += 1) {
    for (let j = i + 1; j < topics.length; j += 1) {
      const [a, b] = orderPair(topics[i], topics[j]);
      increment(shared, a, b);
    }
  }
}

function compareLinks(x: TopicLink, y: TopicLink): number {
  const diff = y.weight - x.weight;
  if (diff !== 0) {
    return diff;
  }
  const byA = compareNames(x.a, y.a);
  if (byA !== 0) {
    return byA;
  }
  return compareNames(x.b, y.b);
}

function buildLinks(
  sizes: Map<string, number>,
  shared: Map<string, Map<string, number>>,
): TopicLink[] {
  const links: TopicLink[] = [];
  for (const [a, inner] of shared) {
    for (const [b, count] of inner) {
      const weight = cosineWeight(count, requireCount(sizes, a), requireCount(sizes, b));
      links.push({ a, b, sharedEntities: count, weight });
    }
  }
  return links.sort(compareLinks);
}

export function topicLinks(membership: Map<string, string[]>): TopicLink[] {
  const sizes = new Map<string, number>();
  const shared = new Map<string, Map<string, number>>();
  for (const topics of membership.values()) {
    for (const topic of topics) {
      sizes.set(topic, (sizes.get(topic) ?? 0) + 1);
    }
    countPairs(shared, topics);
  }
  return buildLinks(sizes, shared);
}
