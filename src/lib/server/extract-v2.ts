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

const ACRONYM_STOPLIST = new Set([
  "CEO", "CFO", "CTO", "COO", "GDP", "TV", "PM", "AM",
  "Q1", "Q2", "Q3", "Q4", "USD", "EUR", "GMT", "BST",
  "FAQ", "DIY", "OK", "NEW", "VIP", "ASAP", "ETA", "FYI",
  "AKA", "ID", "IT", "PR", "HR", "VP", "JR", "SR",
]);

function addCandidate(
  map: Map<string, Candidate>,
  display: string,
  typeHint: TypeHint,
  layer: CandidateLayer,
): void {
  const norm = normalizeName(display);
  if (!norm) return;
  const existing = map.get(norm);
  if (!existing || display.length > existing.display.length) {
    map.set(norm, { display, norm, typeHint, layer });
  }
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
