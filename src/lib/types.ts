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
