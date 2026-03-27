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

export type FeedErrorType =
  | "timeout"
  | "dns"
  | "connection_refused"
  | "http_403"
  | "http_404"
  | "http_429"
  | "http_5xx"
  | "http_other"
  | "unknown";

export interface FeedDiagnostic {
  sourceName: string;
  sourceUrl: string;
  phase: "direct" | "relay" | "altUrl" | "failed";
  durationMs: number;
  error?: string;
  errorType?: FeedErrorType;
  httpStatus?: number;
  fromCache?: boolean;
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

export type SignalType =
  | "surge"
  | "sentiment_deterioration"
  | "cross_category"
  | "novel_cooccurrence"
  | "escalation";

export type SignalSeverity = "critical" | "warning" | "advisory";

export interface Signal {
  id: string;
  type: SignalType;
  severity: SignalSeverity;
  title: string;
  description: string;
  entities: string[];
  confidence: number;
  detectedAt: string;
  metric: number;
}
