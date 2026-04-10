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

// Immutable after module load — frozen to enforce read-only access.
Object.freeze(LOOKUP_MAP);

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
    if (term.length < 3) continue;
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

// Words that when present in a candidate phrase, disqualify it as a person name
const NON_PERSON_WORDS = new Set([
  // Media/source words
  "post", "times", "news", "zone", "journal", "monitor", "tribune",
  "herald", "gazette", "observer", "telegraph", "intercept", "briefing",
  "digest", "report", "review", "service", "english",
  // Organizations/institutions
  "force", "forces", "security", "organization", "organisation", "programme",
  "program", "affairs", "council", "committee", "ministry", "bureau",
  "agency", "command", "corps", "division", "department", "commission",
  "authority", "institute", "association", "foundation", "federation",
  // Places/things
  "airport", "material", "materials", "plants", "plant", "nuclear",
  "vulnerability", "vulnerabilities", "exploited", "fleet", "awards",
  "network", "operating", "innovation", "revolution", "operations",
  // Common non-person headline words
  "war", "article", "full", "read", "says", "adds", "known", "linked",
  "uses", "stealthy", "morning", "afternoon", "evening", "update",
  "special", "general", "fury", "hawk", "leaving",
  // Title/role words that create fragments
  "international", "humanitarian", "population", "world",
]);

// Title prefixes to strip for deduplication
const TITLE_PREFIXES = [
  "president", "vice president", "director", "secretary", "minister",
  "prime minister", "senator", "governor", "ambassador", "chairman",
  "general", "admiral", "colonel", "major", "captain", "commander",
  "chief", "state", "deputy", "former",
];

/**
 * Extract likely person names: sequences of 2-3 capitalized words.
 * Excludes anything already matched by dictionaries or in the stopword list.
 * Uses multiple heuristics to filter false positives.
 */
function matchPersonNames(
  text: string,
  knownEntities: Set<string>,
  sourceNames: Set<string>
): Set<string> {
  const found = new Set<string>();
  // Match 2-3 consecutive capitalized words (first letter uppercase, rest lowercase)
  const regex = /\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){1,2})\b/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const candidate = match[1];
    const candidateLower = candidate.toLowerCase();

    // Skip if it's a known dictionary entity or alias
    if (knownEntities.has(candidate)) continue;

    // Skip if it's in stopwords
    if (STOP_LOWER.has(candidateLower)) continue;

    // Skip single common words that got paired with something
    const words = candidate.split(/\s+/);
    if (words.length < 2) continue;

    // Basic quality filter: each word should be 2+ chars
    if (words.some((w) => w.length < 2)) continue;

    // Skip if any word is a non-person indicator word
    const lowerWords = words.map((w) => w.toLowerCase());
    if (lowerWords.some((w) => NON_PERSON_WORDS.has(w))) continue;

    // Skip if the candidate matches a source name (e.g. "Bangkok Post", "The Hill")
    if (sourceNames.has(candidateLower)) continue;

    // Skip if candidate contains a known dictionary entity name
    // (catches "Iran War", "China On", "Trump Iran", etc.)
    let containsKnownEntity = false;
    for (const entity of knownEntities) {
      if (candidateLower.includes(entity.toLowerCase()) && candidate !== entity) {
        containsKnownEntity = true;
        break;
      }
    }
    if (containsKnownEntity) continue;

    // Skip if candidate is only 2 words and one is a very common word
    // (catches "Why Pakistan", "India On", etc.)
    const FILLER_WORDS = new Set([
      "the", "on", "in", "at", "of", "for", "and", "or", "but", "why",
      "how", "who", "what", "when", "where", "its", "his", "her", "our",
      "their", "this", "that", "one", "two", "most", "some", "all", "any",
      "new", "old", "big", "very", "just", "also", "than", "each",
    ]);
    if (lowerWords.some((w) => FILLER_WORDS.has(w))) continue;

    found.add(candidate);
  }

  // Deduplicate title-prefixed variants: "President Donald Trump" → keep "Donald Trump"
  const deduped = new Set<string>();
  for (const name of found) {
    let stripped = name;
    const nameLower = name.toLowerCase();
    for (const prefix of TITLE_PREFIXES) {
      if (nameLower.startsWith(prefix + " ")) {
        stripped = name.slice(prefix.length + 1);
        break;
      }
    }
    // Only keep the stripped version if it's at least 2 words
    const strippedWords = stripped.split(/\s+/);
    if (strippedWords.length >= 2 && strippedWords.every((w) => w.length >= 2)) {
      deduped.add(stripped);
    } else {
      deduped.add(name);
    }
  }

  return deduped;
}

// Lightweight sentiment scoring for news headlines
const NEG_WORDS = new Set([
  "kill","killed","killing","dead","death","dies","died","war","attack","bomb","bombing",
  "strike","missile","terror","terrorist","terrorism","explosion","crash","crisis","threat",
  "threaten","conflict","violence","violent","destroy","destroyed","destruction","collapse",
  "sanctions","sanction","condemn","condemned","arrest","arrested","fraud","corruption",
  "scandal","protest","riots","riot","flee","fled","refugees","famine","drought","flood",
  "earthquake","hurricane","tornado","devastat","catastroph","emergency","victim","victims",
  "shoot","shooting","shot","hostage","kidnap","torture","abuse","massacre","genocide",
  "invasion","invaded","nuclear","weapon","casualties","wounded","injured","suffer",
  "fail","failed","failure","recession","downturn","unemployment","poverty","hunger",
  "disease","pandemic","epidemic","outbreak","infection","contamination",
]);
const POS_WORDS = new Set([
  "peace","ceasefire","agreement","deal","treaty","accord","cooperation","aid","help",
  "rescue","rescued","relief","recovery","recover","growth","prosper","success",
  "elect","elected","democratic","freedom","liberat","reform","progress","improve",
  "breakthrough","milestone","achievement","victory","win","won","celebrate","hope",
  "safe","secure","security","protect","humanitarian","donate","donation","support",
  "build","rebuild","develop","development","summit","diplomacy","diplomatic","negotiate",
  "resolution","resolve","reconciliation","reunite","alliance","partner","partnership",
]);

function scoreSentiment(text: string): number {
  const words = text.toLowerCase().split(/\W+/);
  let score = 0;
  for (const w of words) {
    if (NEG_WORDS.has(w)) score -= 1;
    else if (POS_WORDS.has(w)) score += 1;
    else {
      // Check prefix matches for stemmed words
      for (const neg of NEG_WORDS) {
        if (neg.length >= 6 && w.startsWith(neg)) { score -= 1; break; }
      }
      for (const pos of POS_WORDS) {
        if (pos.length >= 6 && w.startsWith(pos)) { score += 1; break; }
      }
    }
  }
  // Normalize to -1..+1
  if (words.length === 0) return 0;
  return Math.max(-1, Math.min(1, score / Math.max(1, Math.sqrt(words.length))));
}
interface EntityAccumulator {
  name: string;
  type: "country" | "organization" | "region" | "person";
  mentions: number;
  itemIds: string[];
  urgency: Record<UrgencyLevel, number>;
  lastSeen: number;
  recentHour: number;
  recentSixHour: number;
  recentDay: number;
  sentimentSum: number;
  sentimentCount: number;
}

interface TimeThresholds {
  now: number;
  oneHour: number;
  sixHours: number;
  oneDay: number;
}

function collectSourceNames(items: FeedItem[]): Set<string> {
  const names = new Set<string>();
  for (const item of items) {
    names.add(item.sourceName.toLowerCase());
    const parts = item.sourceName.split(/\s*[-–—|:]\s*/);
    for (const part of parts) {
      names.add(part.trim().toLowerCase());
    }
  }
  return names;
}

function accumulateEntityMatch(
  entityMap: Map<string, EntityAccumulator>,
  name: string,
  defaultType: EntityAccumulator["type"],
  itemId: string,
  urgency: UrgencyLevel,
  itemTime: number,
  age: number,
  t: TimeThresholds,
  sentiment: number,
): void {
  const entry = entityMap.get(name);
  if (entry) {
    entry.mentions++;
    entry.itemIds.push(itemId);
    entry.urgency[urgency]++;
    if (itemTime > entry.lastSeen) entry.lastSeen = itemTime;
    if (age <= t.oneHour) entry.recentHour++;
    if (age <= t.sixHours) entry.recentSixHour++;
    if (age <= t.oneDay) entry.recentDay++;
    entry.sentimentSum += sentiment;
    entry.sentimentCount++;
  } else {
    entityMap.set(name, {
      name,
      type: defaultType,
      mentions: 1,
      itemIds: [itemId],
      urgency: { ...emptyUrgency(), [urgency]: 1 },
      lastSeen: itemTime,
      recentHour: age <= t.oneHour ? 1 : 0,
      recentSixHour: age <= t.sixHours ? 1 : 0,
      recentDay: age <= t.oneDay ? 1 : 0,
      sentimentSum: sentiment,
      sentimentCount: 1,
    });
  }
}

function computeCooccurrences(
  itemEntities: Map<string, Set<string>>,
): Map<string, Map<string, number>> {
  const coMap = new Map<string, Map<string, number>>();
  for (const entities of itemEntities.values()) {
    const arr = Array.from(entities);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        if (!coMap.has(a)) coMap.set(a, new Map());
        if (!coMap.has(b)) coMap.set(b, new Map());
        coMap.get(a)!.set(b, (coMap.get(a)!.get(b) || 0) + 1);
        coMap.get(b)!.set(a, (coMap.get(b)!.get(a) || 0) + 1);
      }
    }
  }
  return coMap;
}

function buildEntityResults(
  entityMap: Map<string, EntityAccumulator>,
  cooccurrenceMap: Map<string, Map<string, number>>,
): ExtractedEntity[] {
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
      sentiment: entry.sentimentCount > 0
        ? Math.round((entry.sentimentSum / entry.sentimentCount) * 100) / 100
        : 0,
    });
  }
  results.sort((a, b) => b.mentions - a.mentions);
  return results;
}

export function extractEntities(items: FeedItem[]): ExtractedEntity[] {
  const now = Date.now();
  const thresholds: TimeThresholds = {
    now,
    oneHour: 60 * 60 * 1000,
    sixHours: 6 * 60 * 60 * 1000,
    oneDay: 24 * 60 * 60 * 1000,
  };

  const sourceNames = collectSourceNames(items);
  const entityMap = new Map<string, EntityAccumulator>();
  const itemEntities = new Map<string, Set<string>>();

  for (const item of items) {
    const text = item.title + " " + item.summary;
    const urgency = getUrgencyLevel(item.sourceCategory);
    const itemTime = new Date(item.published).getTime();
    const age = now - itemTime;
    const itemSentiment = scoreSentiment(text);

    const dictMatches = matchDictionary(text);
    const personMatches = matchPersonNames(text, dictMatches, sourceNames);
    const allEntities = new Set<string>();

    for (const name of dictMatches) {
      allEntities.add(name);
      const lookup = LOOKUP_MAP.get(name.toLowerCase());
      accumulateEntityMatch(
        entityMap, name, lookup?.type || "country",
        item.id, urgency, itemTime, age, thresholds, itemSentiment,
      );
    }

    for (const name of personMatches) {
      allEntities.add(name);
      accumulateEntityMatch(
        entityMap, name, "person",
        item.id, urgency, itemTime, age, thresholds, itemSentiment,
      );
    }

    itemEntities.set(item.id, allEntities);
  }

  const cooccurrenceMap = computeCooccurrences(itemEntities);
  return buildEntityResults(entityMap, cooccurrenceMap);
}
