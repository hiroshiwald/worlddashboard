import type { FeedItem } from "./types";

export interface StoryCluster {
  head: FeedItem; // representative item: EARLIEST published in the cluster (the original report)
  members: FeedItem[]; // all items incl. head, sorted published desc
  sourceCount: number; // distinct sourceName count
  latestAt: string; // max published ISO
}

const DEFAULT_WINDOW_HOURS = 48;

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "as", "at",
  "by", "is", "are", "was", "were", "be", "been", "with", "from", "after",
  "over", "under", "amid", "says", "say", "said", "report", "reports",
  "news", "update", "live", "breaking", "its", "his", "her", "their",
  "this", "that", "these", "those", "it", "he", "she", "they", "we", "you",
  "not", "no", "new", "us", "into", "than", "but", "will", "has", "have",
  "had",
]);

export function normalizeTitle(title: string): string {
  const lowered = title.toLowerCase();
  const decoded = lowered.replace(
    /&amp;|&lt;|&gt;|&quot;|&#39;/g,
    (entity) => HTML_ENTITIES[entity],
  );
  return decoded
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleSignature(title: string): string {
  const normalized = normalizeTitle(title);
  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 3)
    .filter((token) => !STOPWORDS.has(token));

  const uniqueSorted = Array.from(new Set(tokens)).sort();
  const signature = uniqueSorted.slice(0, 6).join("|");

  return signature.length > 0 ? signature : normalized;
}

/** titleSignature("") falls back to normalizeTitle(""), which is also "" —
 * every blank/punctuation-only title would otherwise share one signature.
 * Give each a unique key so unrelated blank-titled items stay singletons. */
function groupBySignature(items: FeedItem[]): Map<string, FeedItem[]> {
  const groups = new Map<string, FeedItem[]>();
  items.forEach((item, index) => {
    const signature = titleSignature(item.title);
    const key = signature.length > 0 ? signature : `__blank_${index}__`;
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  });
  return groups;
}

function toValidTime(item: FeedItem): number | null {
  const time = new Date(item.published).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Splits a same-signature group into time-windowed clusters. Items with
 * unparseable dates are isolated as singleton clusters. */
function splitByWindow(group: FeedItem[], windowHours: number): FeedItem[][] {
  const withTime: { item: FeedItem; time: number }[] = [];
  const clusters: FeedItem[][] = [];

  for (const item of group) {
    const time = toValidTime(item);
    if (time === null) {
      clusters.push([item]);
    } else {
      withTime.push({ item, time });
    }
  }

  withTime.sort((a, b) => a.time - b.time);

  const windowMs = windowHours * 60 * 60 * 1000;
  let current: { item: FeedItem; time: number }[] = [];
  let headTime = 0;

  for (const entry of withTime) {
    if (current.length === 0) {
      current = [entry];
      headTime = entry.time;
      continue;
    }
    if (entry.time - headTime > windowMs) {
      clusters.push(current.map((e) => e.item));
      current = [entry];
      headTime = entry.time;
    } else {
      current.push(entry);
    }
  }
  if (current.length > 0) {
    clusters.push(current.map((e) => e.item));
  }

  return clusters;
}

function buildCluster(members: FeedItem[]): StoryCluster {
  const withValidTime = members.filter((m) => toValidTime(m) !== null);
  const sorted = [...members].sort((a, b) => {
    const timeA = toValidTime(a) ?? -Infinity;
    const timeB = toValidTime(b) ?? -Infinity;
    return timeB - timeA;
  });

  const head =
    withValidTime.length > 0
      ? withValidTime.reduce((earliest, current) =>
          (toValidTime(current) as number) < (toValidTime(earliest) as number)
            ? current
            : earliest,
        )
      : members[0];

  const sourceCount = new Set(members.map((m) => m.sourceName)).size;
  const latestAt = sorted[0].published;

  return { head, members: sorted, sourceCount, latestAt };
}

export function clusterItems(
  items: FeedItem[],
  windowHours: number = DEFAULT_WINDOW_HOURS,
): StoryCluster[] {
  const groups = groupBySignature(items);
  const clusters: StoryCluster[] = [];

  for (const group of groups.values()) {
    const windowed = splitByWindow(group, windowHours);
    for (const members of windowed) {
      clusters.push(buildCluster(members));
    }
  }

  return clusters.sort((a, b) => {
    const timeA = new Date(a.latestAt).getTime();
    const timeB = new Date(b.latestAt).getTime();
    return timeB - timeA;
  });
}
