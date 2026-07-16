import nlp from "compromise";
import { PERSON_STOPWORDS } from "../entity-dictionaries";
import { matchDictionaryEntries, isDictionaryTerm } from "../entity-extractor";

export type TypeHint =
  | "person" | "company" | "organization" | "government_body" | "armed_group"
  | "political_party" | "country" | "region" | "city" | "product" | "technology"
  | "financial_asset" | "disease" | "infrastructure" | "other";
export type CandidateLayer = "dictionary" | "llm" | "compromise" | "acronym" | "person-regex" | "product-pattern";
/** LLM's judgment of how widely known an entity is to a general news
 * reader — a 'famous' candidate skips the review queue (see
 * entity-ingest.ts's famous-entity auto-accept). Only the LLM layer ever
 * sets this. */
export type Prominence = "famous" | "known" | "obscure";

export interface Candidate {
  display: string;
  norm: string;
  typeHint: TypeHint;
  layer: CandidateLayer;
  /** Short role/context phrase from the LLM layer (e.g. "former IRGC
   * commander"), carried through entity-ingest's rollup into
   * entity_candidates.contexts. Undefined for every heuristic layer. */
  roleContext?: string;
  /** Undefined for every heuristic layer — see Prominence. */
  prominence?: Prominence;
}

const CORPORATE_SUFFIXES = new Set(["inc", "ltd", "llc", "corp", "plc", "ag", "gmbh"]);

/** NFKD-fold diacritics, lowercase, collapse whitespace, strip one trailing
 * corporate suffix (optional period) so "Veltrax Industries Inc." and
 * "Veltrax Industries" resolve to the same candidate. */
export function normalizeName(raw: string): string {
  const folded = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!folded) return folded;

  const words = folded.split(" ");
  const lastWord = words[words.length - 1].replace(/\.$/, "");
  if (words.length > 1 && CORPORATE_SUFFIXES.has(lastWord)) {
    words.pop();
  }
  return words.join(" ");
}

const STOP_LOWER = new Set(Array.from(PERSON_STOPWORDS).map((s) => s.toLowerCase()));

// Topic-word acronyms (not actors) plus role/unit words — kept as a single
// alphabetically sorted set.
const ACRONYM_STOPLIST = new Set([
  "AI", "AKA", "AM", "APP", "ASAP", "BST", "CEO", "CFO", "COO", "CPI", "CTO",
  "DIY", "ETA", "EUR", "EV", "FAQ", "FYI", "GDP", "GMT", "GPS", "HR", "ID",
  "IPO", "IT", "JR", "ML", "NEW", "OK", "PDF", "PM", "PR", "Q1", "Q2", "Q3",
  "Q4", "SR", "TV", "URL", "USD", "VIP", "VP", "VPN",
]);

// Higher number = more trusted. A norm collision must never let a
// lower-priority layer demote an existing higher-priority one's layer/
// typeHint (e.g. a dictionary hit "Veltrax" losing its layer to a same-norm
// compromise match "Veltrax Inc" just because the latter's display is
// longer — that demotion used to send a known dictionary entity into the
// human review queue instead of auto-tracking it). 'llm' sits just below
// 'dictionary' (the dictionary stays the canonical anchor per entity-ingest's
// LLM-path union) and 'product-pattern' is the lowest-trust free fallback
// floor, used only when the LLM is unavailable.
const LAYER_PRIORITY: Record<CandidateLayer, number> = {
  dictionary: 5,
  llm: 4,
  compromise: 3,
  acronym: 2,
  "person-regex": 1,
  "product-pattern": 0,
};

export function addCandidate(
  map: Map<string, Candidate>,
  display: string,
  typeHint: TypeHint,
  layer: CandidateLayer,
  roleContext?: string,
  prominence?: Prominence,
): void {
  const norm = normalizeName(display);
  if (!norm) return;
  const existing = map.get(norm);
  if (!existing) {
    map.set(norm, {
      display, norm, typeHint, layer,
      ...(roleContext ? { roleContext } : {}),
      ...(prominence ? { prominence } : {}),
    });
    return;
  }

  const newRank = LAYER_PRIORITY[layer];
  const existingRank = LAYER_PRIORITY[existing.layer];
  const winner = newRank > existingRank ? { typeHint, layer } : { typeHint: existing.typeHint, layer: existing.layer };
  const longestDisplay = newRank >= existingRank && display.length > existing.display.length ? display : existing.display;
  const winnerRoleContext = newRank > existingRank ? roleContext : existing.roleContext;
  const winnerProminence = newRank > existingRank ? prominence : existing.prominence;

  map.set(norm, {
    display: longestDisplay,
    norm,
    typeHint: winner.typeHint,
    layer: winner.layer,
    ...(winnerRoleContext ? { roleContext: winnerRoleContext } : {}),
    ...(winnerProminence ? { prominence: winnerProminence } : {}),
  });
}

function extractDictionaryCandidates(text: string, map: Map<string, Candidate>): void {
  for (const entry of matchDictionaryEntries(text)) {
    addCandidate(map, entry.name, entry.type, "dictionary");
  }
}

/** Dictionary layer only, for entity-ingest's LLM path: when an article's
 * LLM extraction succeeds, its candidates are unioned with JUST this layer
 * (the dictionary stays the canonical anchor; compromise/acronym/
 * person-regex/product-pattern are the heuristic fallback for when the LLM
 * is unavailable or fails, not a supplement to it). */
export function extractDictionaryOnlyCandidates(title: string, summary: string): Candidate[] {
  const map = new Map<string, Candidate>();
  extractDictionaryCandidates(`${title} ${summary}`, map);
  return Array.from(map.values());
}

// compromise sometimes trails a phrase with punctuation from the source
// sentence (e.g. "Northgate Strait,") — trim it before it becomes a name.
function cleanCompromiseMatch(raw: string): string {
  return raw.replace(/[.,;:!?]+$/, "").trim();
}

function extractCompromiseCandidates(text: string, map: Map<string, Candidate>): void {
  const doc = nlp(text);

  for (const raw of doc.people().out("array") as string[]) {
    const cleaned = cleanCompromiseMatch(raw);
    if (cleaned.split(/\s+/).length >= 2) addCandidate(map, cleaned, "person", "compromise");
  }
  for (const raw of doc.organizations().out("array") as string[]) {
    const cleaned = cleanCompromiseMatch(raw);
    if (cleaned) addCandidate(map, cleaned, "organization", "compromise");
  }
  for (const raw of doc.places().out("array") as string[]) {
    const cleaned = cleanCompromiseMatch(raw);
    if (cleaned) addCandidate(map, cleaned, "region", "compromise");
  }
}

function extractAcronymCandidates(text: string, map: Map<string, Candidate>): void {
  const regex = /\b[A-Z][A-Z0-9]{1,4}\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const acronym = match[0];
    if (ACRONYM_STOPLIST.has(acronym)) continue;
    if (isDictionaryTerm(acronym)) continue;
    addCandidate(map, acronym, "organization", "acronym");
  }
}

function extractPersonRegexCandidates(text: string, map: Map<string, Candidate>): void {
  const regex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const candidate = match[1];
    if (STOP_LOWER.has(candidate.toLowerCase())) continue;
    addCandidate(map, candidate, "person", "person-regex");
  }
}

// Common capitalized+digit/interior-caps shapes that read as products/models
// but are really dates, holidays, or diseases — kept out of the free
// fallback floor so it doesn't need the LLM to stay quiet on them.
const PRODUCT_PATTERN_STOPLIST = new Set(["covid-19", "covid19", "24/7", "9/11", "401k", "y2k"]);
const MIN_DIGIT_TOKEN_LENGTH = 3;

function isStoplistedProduct(token: string): boolean {
  return PRODUCT_PATTERN_STOPLIST.has(token.toLowerCase());
}

// The free, no-LLM fallback for product/model names: a capitalized token
// containing a digit (GPT-5o, A320neo) or a word with a second interior
// capital (DeepSeek). Deliberately conservative — dictionary-owned and
// stoplisted shapes are dropped, and the LLM layer is the primary source for
// this entity class when configured.
function extractProductPatternCandidates(text: string, map: Map<string, Candidate>): void {
  const tokens = new Set<string>();

  const digitTokenRegex = /\b[A-Z][a-zA-Z0-9-]*[0-9][a-zA-Z0-9-]*\b/g;
  let match: RegExpExecArray | null;
  while ((match = digitTokenRegex.exec(text)) !== null) {
    if (match[0].length >= MIN_DIGIT_TOKEN_LENGTH) tokens.add(match[0]);
  }

  const interiorCapsRegex = /\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b/g;
  while ((match = interiorCapsRegex.exec(text)) !== null) {
    tokens.add(match[0]);
  }

  for (const token of tokens) {
    if (isStoplistedProduct(token) || isDictionaryTerm(token)) continue;
    addCandidate(map, token, "other", "product-pattern");
  }
}

/** Pure candidate extraction: dictionary match, compromise NLP, ALL-CAPS
 * acronyms, a 2-3-capitalized-word person heuristic, and a product/model
 * name shape — in that order, so ties (same normalized name) resolve to the
 * earlier, more trustworthy layer. Dedup is by normalized name; the longest
 * display form wins. This is the full heuristic stack, used when the LLM
 * layer is unavailable or fails (see entity-ingest.ts's LLM-path union,
 * which uses only the dictionary layer instead). */
export function extractCandidates(title: string, summary: string): Candidate[] {
  const text = `${title} ${summary}`;
  const map = new Map<string, Candidate>();

  extractDictionaryCandidates(text, map);
  extractCompromiseCandidates(text, map);
  extractAcronymCandidates(text, map);
  extractPersonRegexCandidates(text, map);
  extractProductPatternCandidates(text, map);

  return Array.from(map.values());
}
