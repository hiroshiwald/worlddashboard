// Read-time link between untracked names (entity_candidates, which has no
// article link) and article text. A name matches only when it appears in the
// title or summary as a whole word, so the claim is visible in the text itself.

export interface CandidateName {
  nameNorm: string;
  displayName: string;
}

const MIN_NAME_LENGTH = 3;
const MIN_SINGLE_WORD_LENGTH = 4;
// Feed titles often end in " - Publisher". The publisher is not news content.
const PUBLISHER_SUFFIX = /\s[-–—|]\s[^-–—|]+$/u;

export function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wholeWordPattern(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "u");
}

function stripAccents(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "");
}

function isSingleWord(name: string): boolean {
  return !/\s/u.test(name.trim());
}

/** Rejects names that are junk in the candidate table: no capital letter
 * ("administration"), led by punctuation ("- BBC"), one short word ("The",
 * "DIE"), or HTML codes left in ("OutKick&nbsp;Fox News"). */
export function isMatchableName(name: string): boolean {
  const trimmed = name.trim();
  if (!/^[\p{L}\p{N}]/u.test(trimmed)) return false;
  if (!/\p{Lu}/u.test(trimmed)) return false;
  if (/&[a-z#0-9]+;/i.test(trimmed)) return false;
  const singleWord = !/\s/u.test(trimmed);
  const minLength = singleWord ? MIN_SINGLE_WORD_LENGTH : MIN_NAME_LENGTH;
  return foldText(trimmed).length >= minLength;
}

export function stripPublisherSuffix(title: string): string {
  return title.replace(PUBLISHER_SUFFIX, "");
}

/** The " - Publisher" text at the end of a title, or null. */
export function publisherSuffix(title: string): string | null {
  const match = PUBLISHER_SUFFIX.exec(title);
  if (match === null) return null;
  return match[0].replace(/^\s[-–—|]\s/u, "").trim();
}

/** Drops a match whose name sits inside a longer matched or excluded name
 * ("Daily News" inside "Hurriyet Daily News"). */
function keepLongest<T>(found: { candidate: T; folded: string }[], exclude: Set<string>): T[] {
  const covering = [...found.map((entry) => entry.folded), ...exclude];
  return found
    .filter((entry) => !covering.some((other) => other.length > entry.folded.length && other.includes(entry.folded)))
    .map((entry) => entry.candidate);
}

export interface CandidateMatcher<T extends CandidateName> {
  match(text: string, exclude: Set<string>): T[];
}

/** Builds one pattern per name once, so a page of articles reuses them.
 * Names that fail isMatchableName are dropped. */
export function buildCandidateMatcher<T extends CandidateName>(candidates: T[]): CandidateMatcher<T> {
  // One-word names match with their own capitals ("EAST" must not match
  // "Middle East"); longer names ignore case.
  const compiled: { candidate: T; folded: string; exact: boolean; pattern: RegExp }[] = [];
  for (const candidate of candidates) {
    const name = candidate.displayName.trim();
    const folded = foldText(name);
    const exact = isSingleWord(name);
    if (isMatchableName(name)) {
      compiled.push({ candidate, folded, exact, pattern: wholeWordPattern(exact ? stripAccents(name) : folded) });
    }
  }
  return {
    match(text: string, exclude: Set<string>): T[] {
      const haystack = foldText(text);
      const caseKept = stripAccents(text);
      const found: { candidate: T; folded: string }[] = [];
      for (const entry of compiled) {
        if (exclude.has(entry.folded)) continue;
        if (!haystack.includes(entry.folded)) continue;
        if (entry.pattern.test(entry.exact ? caseKept : haystack)) found.push(entry);
      }
      return keepLongest(found, exclude);
    },
  };
}
