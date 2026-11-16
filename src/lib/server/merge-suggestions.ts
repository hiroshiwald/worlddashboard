import { buildMergeGroups, sharesNameOrAlias, sharesWikiTitle, type MergeEntity } from "../soft-merge";
import type { Sql, SqlRow } from "./db";

export type MergeReason = "alias" | "wiki" | "alias+wiki";

export interface MergeSuggestionEntity {
  id: string;
  name: string;
  type: string;
  mentions14d: number;
}

export interface MergeSuggestionMember extends MergeSuggestionEntity {
  status: string;
}

export interface MergeSuggestionGroup {
  canonical: MergeSuggestionEntity;
  members: MergeSuggestionMember[];
  reason: MergeReason;
}

interface Candidate extends MergeEntity {
  status: string;
}

const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Pure. Why a group was suggested: some pair links by alias, some pair by
 * shared Wikipedia title, or both kinds of link occur in the group. */
export function computeReason(members: MergeEntity[]): MergeReason {
  let alias = false;
  let wiki = false;
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      alias = alias || sharesNameOrAlias(members[i], members[j]);
      wiki = wiki || sharesWikiTitle(members[i], members[j]);
    }
  }
  if (alias && wiki) {
    return "alias+wiki";
  }
  return wiki ? "wiki" : "alias";
}

function toCandidate(row: SqlRow, mentions: Map<string, number>): Candidate {
  const id = String(row.id);
  return {
    id,
    name: String(row.canonical_name),
    type: String(row.type),
    status: String(row.status),
    aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    wikiTitle: row.wiki_title == null ? null : String(row.wiki_title),
    mentions: mentions.get(id) ?? 0,
  };
}

/** Pure. entityRows: {id, canonical_name, type, status, aliases, wiki_title};
 * mentionRows: {entity_id, mentions} (distinct articles in the last 14 days). */
export function assembleMergeSuggestions(
  entityRows: SqlRow[],
  mentionRows: SqlRow[],
  limit: number,
): MergeSuggestionGroup[] {
  const mentions = new Map<string, number>();
  for (const row of mentionRows) {
    mentions.set(String(row.entity_id), Number(row.mentions));
  }
  const candidates = entityRows.map((row) => toCandidate(row, mentions));
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return buildMergeGroups(candidates)
    .slice(0, limit)
    .map((group) => {
      const members = group.memberIds.map((id) => byId.get(id) as Candidate);
      const [canonical] = members;
      return {
        canonical: { id: canonical.id, name: canonical.name, type: canonical.type, mentions14d: canonical.mentions },
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          type: m.type,
          mentions14d: m.mentions,
          status: m.status,
        })),
        reason: computeReason(members),
      };
    });
}

/** Read-only. Loads non-dismissed entities and their 14-day article counts. */
export async function loadMergeSuggestions(sql: Sql, limit: number, now: Date): Promise<MergeSuggestionGroup[]> {
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const entityRows = await sql`
    SELECT id, canonical_name, type, status, aliases, wiki_title
    FROM entities WHERE status <> 'dismissed'`;
  const mentionRows = await sql`
    SELECT ae.entity_id, COUNT(DISTINCT ae.article_id) AS mentions
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE a.first_seen_at >= ${since}::timestamptz
    GROUP BY ae.entity_id`;
  return assembleMergeSuggestions(entityRows, mentionRows, limit);
}
