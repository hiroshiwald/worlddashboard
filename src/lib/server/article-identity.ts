import { createHash } from "node:crypto";

function normalizeTitleForHash(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractHost(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return link;
  }
}

/** Stable identity for an article: sha256 of normalized title + link host.
 * Used as the unique key for de-duplicating articles across feeds. */
export function contentHash(title: string, link: string): string {
  const normalized = `${normalizeTitleForHash(title)}|${extractHost(link)}`;
  return createHash("sha256").update(normalized).digest("hex");
}
