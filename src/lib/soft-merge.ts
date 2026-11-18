export interface MergeEntity {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  wikiTitle: string | null;
  mentions: number;
}

export interface MergeGroup {
  canonicalId: string;
  memberIds: string[];
  otherNames: string[];
}

const ROMAN_NUMERAL = /\b(?:VIII|VII|VI|IV|IX|III|II|V|X|I)\b/gi;

function normalizeName(name: string): string {
  return name.replace(/\./g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Folds country abbreviations so "US Navy" and "United States Navy" compare equal.
// Used for name/alias comparison only, never for Wikipedia titles.
function foldCountry(name: string): string {
  const normalized = normalizeName(name);
  if (normalized === "us" || normalized === "usa" || normalized === "u s") {
    return "united states";
  }
  if (normalized === "uk") {
    return "united kingdom";
  }
  return normalized.replace(/^(?:us|u s) /, "united states ").replace(/^uk /, "united kingdom ");
}

function stripNumbers(name: string): string {
  const withoutDigits = name.replace(/\d/g, "");
  const withoutNumerals = withoutDigits.replace(ROMAN_NUMERAL, "");
  return normalizeName(withoutNumerals);
}

export function namesDifferOnlyByNumber(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    throw new Error("soft-merge: names must be strings");
  }
  if (normalizeName(a) === normalizeName(b)) {
    return false;
  }
  return stripNumbers(a) === stripNumbers(b);
}

function requireValid(valid: boolean, field: string): void {
  if (!valid) {
    throw new Error(`soft-merge: invalid entity field "${field}"`);
  }
}

function assertValidEntity(e: MergeEntity): void {
  requireValid(typeof e.id === "string" && e.id.length > 0, "id");
  requireValid(typeof e.name === "string" && normalizeName(e.name).length > 0, "name");
  requireValid(typeof e.type === "string", "type");
  requireValid(
    Array.isArray(e.aliases) && e.aliases.every((alias) => typeof alias === "string"),
    "aliases",
  );
  requireValid(e.wikiTitle === null || typeof e.wikiTitle === "string", "wikiTitle");
  requireValid(
    typeof e.mentions === "number" && Number.isFinite(e.mentions) && e.mentions >= 0,
    "mentions",
  );
}

function assertUniqueIds(entities: MergeEntity[]): void {
  const seen = new Set<string>();
  for (const e of entities) {
    if (seen.has(e.id)) {
      throw new Error(`soft-merge: duplicate entity id "${e.id}"`);
    }
    seen.add(e.id);
  }
}

export function sharesNameOrAlias(a: MergeEntity, b: MergeEntity): boolean {
  const aName = foldCountry(a.name);
  const bName = foldCountry(b.name);
  const aAliases = a.aliases.map((alias) => foldCountry(alias));
  const bAliases = b.aliases.map((alias) => foldCountry(alias));
  return aAliases.includes(bName) || bAliases.includes(aName);
}

function sharesFoldedName(a: MergeEntity, b: MergeEntity): boolean {
  return foldCountry(a.name) === foldCountry(b.name);
}

export function sharesWikiTitle(a: MergeEntity, b: MergeEntity): boolean {
  if (a.wikiTitle === null || b.wikiTitle === null) {
    return false;
  }
  const title = normalizeName(a.wikiTitle);
  return title.length > 0 && title === normalizeName(b.wikiTitle);
}

function canJoin(a: MergeEntity, b: MergeEntity): boolean {
  if (a.type !== b.type) {
    return false;
  }
  const linked = sharesFoldedName(a, b) || sharesNameOrAlias(a, b) || sharesWikiTitle(a, b);
  return linked && !namesDifferOnlyByNumber(a.name, b.name);
}

function findRoot(parent: number[], index: number): number {
  let node = index;
  while (parent[node] !== node) {
    parent[node] = parent[parent[node]];
    node = parent[node];
  }
  return node;
}

function addToBucket(buckets: Map<string, number[]>, key: string, index: number): void {
  const bucket = buckets.get(key);
  if (bucket === undefined) {
    buckets.set(key, [index]);
  } else {
    bucket.push(index);
  }
}

function bucketPairs(buckets: Map<string, number[]>): [number, number][] {
  const pairs: [number, number][] = [];
  for (const bucket of buckets.values()) {
    for (let x = 0; x < bucket.length; x += 1) {
      for (let y = x + 1; y < bucket.length; y += 1) {
        pairs.push([bucket[x], bucket[y]]);
      }
    }
  }
  return pairs;
}

// Candidate pairs cover canJoin's link rules: same folded name, same wiki title,
// or an alias of one equal to the name of the other. Keys include type.
function candidatePairs(entities: MergeEntity[]): [number, number][] {
  const names = new Map<string, number[]>();
  const wikis = new Map<string, number[]>();
  const foldedAliases = entities.map((e) => e.aliases.map((alias) => foldCountry(alias)));
  entities.forEach((e, i) => {
    addToBucket(names, `${e.type}\u0000${foldCountry(e.name)}`, i);
    const title = e.wikiTitle === null ? "" : normalizeName(e.wikiTitle);
    if (title.length > 0) {
      addToBucket(wikis, `${e.type}\u0000${title}`, i);
    }
  });
  const pairs = [...bucketPairs(names), ...bucketPairs(wikis)];
  entities.forEach((e, i) => {
    for (const alias of foldedAliases[i]) {
      for (const j of names.get(`${e.type}\u0000${alias}`) ?? []) {
        if (j !== i) {
          pairs.push([i, j]);
        }
      }
    }
  });
  return pairs;
}

function findComponents(entities: MergeEntity[]): MergeEntity[][] {
  const parent = entities.map((_, i) => i);
  for (const [i, j] of candidatePairs(entities)) {
    if (canJoin(entities[i], entities[j])) {
      parent[findRoot(parent, i)] = findRoot(parent, j);
    }
  }
  const byRoot = new Map<number, MergeEntity[]>();
  entities.forEach((entity, i) => {
    const root = findRoot(parent, i);
    const members = byRoot.get(root) ?? [];
    members.push(entity);
    byRoot.set(root, members);
  });
  return [...byRoot.values()];
}

function isConsistent(members: MergeEntity[]): boolean {
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      if (namesDifferOnlyByNumber(members[i].name, members[j].name)) {
        return false;
      }
    }
  }
  return true;
}

function compareCanonical(a: MergeEntity, b: MergeEntity): number {
  if (a.mentions !== b.mentions) {
    return b.mentions - a.mentions;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

function toMergeGroup(ranked: MergeEntity[]): MergeGroup {
  const [canonical, ...rest] = ranked;
  return {
    canonicalId: canonical.id,
    memberIds: [canonical.id, ...rest.map((e) => e.id).sort()],
    otherNames: rest.map((e) => e.name).sort(),
  };
}

export function buildMergeGroups(entities: MergeEntity[]): MergeGroup[] {
  entities.forEach((e) => assertValidEntity(e));
  assertUniqueIds(entities);
  return findComponents(entities)
    .filter((members) => members.length >= 2 && isConsistent(members))
    .map((members) => [...members].sort(compareCanonical))
    .sort((a, b) => compareCanonical(a[0], b[0]))
    .map(toMergeGroup);
}
