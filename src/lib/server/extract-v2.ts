import nlp from "compromise";
import { PERSON_STOPWORDS } from "../entity-dictionaries";
import { matchDictionaryEntries, isDictionaryTerm } from "../entity-extractor";

export type TypeHint = "country" | "organization" | "region" | "person" | "other";
export type CandidateLayer = "dictionary" | "compromise" | "acronym" | "person-regex";

export interface Candidate {
  display: string;
  norm: string;
  typeHint: TypeHint;
  layer: CandidateLayer;
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
// human review queue instead of auto-tracking it).
const LAYER_PRIORITY: Record<CandidateLayer, number> = {
  dictionary: 3,
  compromise: 2,
  acronym: 1,
  "person-regex": 0,
};

export function addCandidate(
  map: Map<string, Candidate>,
  display: string,
  typeHint: TypeHint,
  layer: CandidateLayer,
): void {
  const norm = normalizeName(display);
  if (!norm) return;
  const existing = map.get(norm);
  if (!existing) {
    map.set(norm, { display, norm, typeHint, layer });
    return;
  }

  const newRank = LAYER_PRIORITY[layer];
  const existingRank = LAYER_PRIORITY[existing.layer];
  const winner = newRank > existingRank ? { typeHint, layer } : { typeHint: existing.typeHint, layer: existing.layer };
  const longestDisplay = newRank >= existingRank && display.length > existing.display.length ? display : existing.display;

  map.set(norm, { display: longestDisplay, norm, typeHint: winner.typeHint, layer: winner.layer });
}

function extractDictionaryCandidates(text: string, map: Map<string, Candidate>): void {
  for (const entry of matchDictionaryEntries(text)) {
    addCandidate(map, entry.name, entry.type, "dictionary");
  }
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

/** Pure candidate extraction: dictionary match, compromise NLP, ALL-CAPS
 * acronyms, and a 2-3-capitalized-word person heuristic — in that order, so
 * ties (same normalized name) resolve to the earlier, more trustworthy
 * layer. Dedup is by normalized name; the longest display form wins. */
export function extractCandidates(title: string, summary: string): Candidate[] {
  const text = `${title} ${summary}`;
  const map = new Map<string, Candidate>();

  extractDictionaryCandidates(text, map);
  extractCompromiseCandidates(text, map);
  extractAcronymCandidates(text, map);
  extractPersonRegexCandidates(text, map);

  return Array.from(map.values());
}
