import { ExtractedEntity } from "./types";

export const MUTE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
export const SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function loadMutedEntities(): Map<string, number> {
  try {
    const raw = localStorage.getItem("wd-muted-entities");
    if (!raw) return new Map();
    const arr: [string, number][] = JSON.parse(raw);
    const now = Date.now();
    return new Map(arr.filter(([, expiry]) => expiry > now));
  } catch {
    return new Map();
  }
}

export function saveMutedEntities(muted: Map<string, number>) {
  localStorage.setItem(
    "wd-muted-entities",
    JSON.stringify(Array.from(muted.entries()))
  );
}

export function loadPreviousEntityNames(): Set<string> {
  try {
    const raw = localStorage.getItem("wd-entity-snapshot");
    if (!raw) return new Set();
    const { names, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > 2 * 60 * 60 * 1000) return new Set();
    return new Set(names);
  } catch {
    return new Set();
  }
}

export function saveEntitySnapshot(entities: ExtractedEntity[]) {
  const names = entities.map((e) => e.name);
  localStorage.setItem(
    "wd-entity-snapshot",
    JSON.stringify({ names, timestamp: Date.now() })
  );
}
