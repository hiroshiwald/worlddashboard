export interface DashboardSource {
  id: number;
  name: string;
  category: string;
  type: string;
  tier: string;
  url: string;
  notes: string;
  status: "live" | "static" | "unknown";
}

export type SortDirection = "asc" | "desc";

export interface SortConfig {
  key: keyof DashboardSource;
  direction: SortDirection;
}

export type UrgencyLevel =
  | "critical"
  | "warning"
  | "advisory"
  | "monitoring"
  | "system"
  | "neutral";
