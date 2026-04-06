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

// ── Edge History ──

import { EdgeHistoryEntry } from "./types";

const EDGE_HISTORY_KEY = "wd-edge-history";
const EDGE_HISTORY_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

export function edgeKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export function loadEdgeHistory(): Map<string, EdgeHistoryEntry> {
  try {
    const raw = localStorage.getItem(EDGE_HISTORY_KEY);
    if (!raw) return new Map();
    const data: { edges: Record<string, EdgeHistoryEntry>; lastUpdated: string } = JSON.parse(raw);
    const now = Date.now();
    const result = new Map<string, EdgeHistoryEntry>();
    for (const [key, entry] of Object.entries(data.edges)) {
      if (now - new Date(entry.lastSeen).getTime() < EDGE_HISTORY_MAX_AGE) {
        result.set(key, entry);
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

export function saveEdgeHistory(
  currentEdges: Map<string, number>
): void {
  try {
    const existing = loadEdgeHistory();
    const now = new Date().toISOString();
    for (const [key, count] of currentEdges) {
      const prev = existing.get(key);
      if (prev) {
        existing.set(key, {
          firstSeen: prev.firstSeen,
          lastSeen: now,
          count: prev.count + count,
        });
      } else {
        existing.set(key, { firstSeen: now, lastSeen: now, count });
      }
    }
    // Prune old entries
    const cutoff = Date.now() - EDGE_HISTORY_MAX_AGE;
    const edges: Record<string, EdgeHistoryEntry> = {};
    for (const [key, entry] of existing) {
      if (new Date(entry.lastSeen).getTime() > cutoff) {
        edges[key] = entry;
      }
    }
    localStorage.setItem(EDGE_HISTORY_KEY, JSON.stringify({ edges, lastUpdated: now }));
  } catch {
    // localStorage full or unavailable — degrade gracefully
  }
}

// ── Entity Baselines ──

const ENTITY_BASELINE_KEY = "wd-entity-baselines";
const BASELINE_WINDOW = 7 * 24; // 7 days of hourly slots

export interface EntityBaseline {
  hourlyMentions: number[];
  lastUpdated: string;
}

export function loadEntityBaselines(): Map<string, EntityBaseline> {
  try {
    const raw = localStorage.getItem(ENTITY_BASELINE_KEY);
    if (!raw) return new Map();
    const data: Record<string, EntityBaseline> = JSON.parse(raw);
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

export function updateEntityBaselines(
  entities: { name: string; mentions: number }[]
): void {
  try {
    const baselines = loadEntityBaselines();
    const now = Date.now();

    // Throttle: only update if >55 minutes since any entity's lastUpdated
    const anyEntry = baselines.values().next().value;
    if (anyEntry && now - new Date(anyEntry.lastUpdated).getTime() < 55 * 60 * 1000) {
      return;
    }

    const nowIso = new Date().toISOString();
    for (const { name, mentions } of entities) {
      const existing = baselines.get(name);
      const hourly = existing ? [...existing.hourlyMentions, mentions] : [mentions];
      if (hourly.length > BASELINE_WINDOW) {
        hourly.splice(0, hourly.length - BASELINE_WINDOW);
      }
      baselines.set(name, { hourlyMentions: hourly, lastUpdated: nowIso });
    }

    const obj: Record<string, EntityBaseline> = {};
    for (const [key, val] of baselines) {
      obj[key] = val;
    }
    localStorage.setItem(ENTITY_BASELINE_KEY, JSON.stringify(obj));
  } catch {
    // localStorage full or unavailable
  }
}

export function getBaselineRate(
  baselines: Map<string, EntityBaseline>,
  entityName: string
): number {
  const entry = baselines.get(entityName);
  if (!entry || entry.hourlyMentions.length === 0) return 0;
  const sum = entry.hourlyMentions.reduce((a, b) => a + b, 0);
  return sum / entry.hourlyMentions.length;
}
