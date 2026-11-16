// Read-time link between untracked names (entity_candidates, which has no
// article link) and article text. A name matches only when it appears in the
// title or summary as a whole word, so the claim is visible in the text itself.

export interface CandidateName {
  nameNorm: string;
  displayName: string;
}

const MIN_NAME_LENGTH = 3;

export function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wholeWordPattern(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "u");
}

export interface CandidateMatcher<T extends CandidateName> {
  match(text: string, exclude: Set<string>): T[];
}

/** Builds one pattern per name once, so a page of articles reuses them.
 * Names shorter than 3 characters are dropped: "US" or "EU" would match too much. */
export function buildCandidateMatcher<T extends CandidateName>(candidates: T[]): CandidateMatcher<T> {
  const compiled: { candidate: T; folded: string; pattern: RegExp }[] = [];
  for (const candidate of candidates) {
    const folded = foldText(candidate.displayName.trim());
    if (folded.length >= MIN_NAME_LENGTH) {
      compiled.push({ candidate, folded, pattern: wholeWordPattern(folded) });
    }
  }
  return {
    match(text: string, exclude: Set<string>): T[] {
      const haystack = foldText(text);
      const found: T[] = [];
      for (const entry of compiled) {
        if (exclude.has(entry.folded)) continue;
        if (haystack.includes(entry.folded) && entry.pattern.test(haystack)) found.push(entry.candidate);
      }
      return found;
    },
  };
}
