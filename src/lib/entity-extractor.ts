import { FeedItem, ExtractedEntity, UrgencyLevel } from "./types";
import { getUrgencyLevel } from "./urgency";
import {
  DictEntry,
  COUNTRY_DICT,
  ORG_DICT,
  REGION_DICT,
  PERSON_STOPWORDS,
} from "./entity-dictionaries";

// Build a case-insensitive lookup: lowercased term -> { canonical name, type }
interface LookupEntry {
  name: string;
  type: "country" | "organization" | "region";
}

const LOOKUP_MAP = new Map<string, LookupEntry>();

function addToLookup(entries: DictEntry[]) {
  for (const entry of entries) {
    LOOKUP_MAP.set(entry.name.toLowerCase(), {
      name: entry.name,
      type: entry.type as "country" | "organization" | "region",
    });
    for (const alias of entry.aliases) {
      LOOKUP_MAP.set(alias.toLowerCase(), {
        name: entry.name,
        type: entry.type as "country" | "organization" | "region",
      });
    }
  }
}

addToLookup(COUNTRY_DICT);
addToLookup(ORG_DICT);
addToLookup(REGION_DICT);

// Sort lookup keys by length descending so longer matches take priority
const SORTED_TERMS = Array.from(LOOKUP_MAP.keys()).sort(
  (a, b) => b.length - a.length
);

// Lowercase stopwords for comparison
const STOP_LOWER = new Set(
  Array.from(PERSON_STOPWORDS).map((s) => s.toLowerCase())
);

function emptyUrgency(): Record<UrgencyLevel, number> {
  return {
    critical: 0,
    warning: 0,
    advisory: 0,
    monitoring: 0,
    system: 0,
    neutral: 0,
  };
}

/**
 * Extract dictionary-matched entities from text.
 * Returns a Set of canonical entity names found.
 */
function matchDictionary(text: string): Set<string> {
  const found = new Set<string>();
  const lower = text.toLowerCase();

  for (const term of SORTED_TERMS) {
    if (term.length < 2) continue;
    const idx = lower.indexOf(term);
    if (idx === -1) continue;

    // Basic word-boundary check: character before and after should not be a letter
    const before = idx > 0 ? lower[idx - 1] : " ";
    const after =
      idx + term.length < lower.length ? lower[idx + term.length] : " ";
    const isWordBound =
      !/[a-z]/.test(before) && !/[a-z]/.test(after);

    if (isWordBound) {
      const entry = LOOKUP_MAP.get(term)!;
      found.add(entry.name);
    }
  }

  return found;
}

/**
 * Extract likely person names: sequences of 2-3 capitalized words.
 * Excludes anything already matched by dictionaries or in the stopword list.
 */
function matchPersonNames(
  text: string,
  knownEntities: Set<string>
): Set<string> {
  const found = new Set<string>();
  // Match 2-3 consecutive capitalized words (first letter uppercase, rest lowercase)
  const regex = /\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){1,2})\b/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const candidate = match[1];

    // Skip if it's a known dictionary entity or alias
    if (knownEntities.has(candidate)) continue;

    // Skip if it's in stopwords
    if (STOP_LOWER.has(candidate.toLowerCase())) continue;

    // Skip single common words that got paired with something
    const words = candidate.split(/\s+/);
    if (words.length < 2) continue;

    // Basic quality filter: each word should be 2+ chars
    if (words.some((w) => w.length < 2)) continue;

    found.add(candidate);
  }

  return found;
}

export function extractEntities(items: FeedItem[]): ExtractedEntity[] {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const SIX_HOURS = 6 * ONE_HOUR;
  const ONE_DAY = 24 * ONE_HOUR;

  // entity name -> accumulator
  const entityMap = new Map<
    string,
    {
      name: string;
      type: "country" | "organization" | "region" | "person";
      mentions: number;
      itemIds: string[];
      urgency: Record<UrgencyLevel, number>;
      lastSeen: number;
      recentHour: number;
      recentSixHour: number;
      recentDay: number;
    }
  >();

  // Track which entities appear in each item (for co-occurrence)
  const itemEntities: Map<string, Set<string>> = new Map();

  for (const item of items) {
    const text = item.title + " " + item.summary;
    const urgency = getUrgencyLevel(item.sourceCategory);
    const itemTime = new Date(item.published).getTime();
    const age = now - itemTime;

    // Dictionary matches
    const dictMatches = matchDictionary(text);

    // Person name matches
    const personMatches = matchPersonNames(text, dictMatches);

    // Combine all entities for this item
    const allEntities = new Set<string>();

    for (const name of dictMatches) {
      allEntities.add(name);
      const entry = entityMap.get(name);
      if (entry) {
        entry.mentions++;
        entry.itemIds.push(item.id);
        entry.urgency[urgency]++;
        if (itemTime > entry.lastSeen) entry.lastSeen = itemTime;
        if (age <= ONE_HOUR) entry.recentHour++;
        if (age <= SIX_HOURS) entry.recentSixHour++;
        if (age <= ONE_DAY) entry.recentDay++;
      } else {
        const lookup = LOOKUP_MAP.get(name.toLowerCase());
        entityMap.set(name, {
          name,
          type: lookup?.type || "country",
          mentions: 1,
          itemIds: [item.id],
          urgency: { ...emptyUrgency(), [urgency]: 1 },
          lastSeen: itemTime,
          recentHour: age <= ONE_HOUR ? 1 : 0,
          recentSixHour: age <= SIX_HOURS ? 1 : 0,
          recentDay: age <= ONE_DAY ? 1 : 0,
        });
      }
    }

    for (const name of personMatches) {
      allEntities.add(name);
      const entry = entityMap.get(name);
      if (entry) {
        entry.mentions++;
        entry.itemIds.push(item.id);
        entry.urgency[urgency]++;
        if (itemTime > entry.lastSeen) entry.lastSeen = itemTime;
        if (age <= ONE_HOUR) entry.recentHour++;
        if (age <= SIX_HOURS) entry.recentSixHour++;
        if (age <= ONE_DAY) entry.recentDay++;
      } else {
        entityMap.set(name, {
          name,
          type: "person",
          mentions: 1,
          itemIds: [item.id],
          urgency: { ...emptyUrgency(), [urgency]: 1 },
          lastSeen: itemTime,
          recentHour: age <= ONE_HOUR ? 1 : 0,
          recentSixHour: age <= SIX_HOURS ? 1 : 0,
          recentDay: age <= ONE_DAY ? 1 : 0,
        });
      }
    }

    itemEntities.set(item.id, allEntities);
  }

  // Compute co-occurrences
  const cooccurrenceMap = new Map<string, Map<string, number>>();

  for (const entities of itemEntities.values()) {
    const arr = Array.from(entities);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];

        if (!cooccurrenceMap.has(a)) cooccurrenceMap.set(a, new Map());
        if (!cooccurrenceMap.has(b)) cooccurrenceMap.set(b, new Map());

        cooccurrenceMap.get(a)!.set(b, (cooccurrenceMap.get(a)!.get(b) || 0) + 1);
        cooccurrenceMap.get(b)!.set(a, (cooccurrenceMap.get(b)!.get(a) || 0) + 1);
      }
    }
  }

  // Build final array, filtering to 2+ mentions
  const results: ExtractedEntity[] = [];

  for (const entry of entityMap.values()) {
    if (entry.mentions < 2) continue;

    const cooc = cooccurrenceMap.get(entry.name);
    const topCooccurrences: [string, number][] = cooc
      ? Array.from(cooc.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
      : [];

    results.push({
      name: entry.name,
      type: entry.type,
      mentions: entry.mentions,
      itemIds: entry.itemIds,
      urgencyBreakdown: entry.urgency,
      lastSeen: new Date(entry.lastSeen).toISOString(),
      recentMentions: {
        hour: entry.recentHour,
        sixHour: entry.recentSixHour,
        day: entry.recentDay,
      },
      cooccurrences: topCooccurrences,
    });
  }

  // Sort by mentions descending
  results.sort((a, b) => b.mentions - a.mentions);

  return results;
}
