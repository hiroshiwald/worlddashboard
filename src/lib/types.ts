export interface FeedItem {
  id: string;
  title: string;
  link: string;
  published: string;
  summary: string;
  sourceName: string;
  sourceCategory: string;
  sourceTier: string;
  imageUrl: string;
}

export interface SourceMeta {
  name: string;
  category: string;
  tier: string;
  url: string;
  type: string;
  altUrl?: string;
}

export interface FeedDiagnostic {
  sourceName: string;
  sourceUrl: string;
  phase: "direct" | "relay" | "altUrl" | "failed";
  durationMs: number;
  error?: string;
}

export type SortDirection = "asc" | "desc";

export interface SortConfig {
  key: keyof FeedItem;
  direction: SortDirection;
}

export type UrgencyLevel =
  | "critical"
  | "warning"
  | "advisory"
  | "monitoring"
  | "system"
  | "neutral";

export type EntityType = "country" | "organization" | "region" | "person";

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  mentions: number;
  itemIds: string[];
  urgencyBreakdown: Record<UrgencyLevel, number>;
  lastSeen: string;
  recentMentions: { hour: number; sixHour: number; day: number };
  cooccurrences: [string, number][];
  sentiment: number; // -1 (negative) to +1 (positive)
}
