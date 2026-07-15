export interface SignalCardData {
  id: number;
  dedupeKey: string;
  type: string;
  severity: "critical" | "warning" | "advisory";
  state: string;
  title: string;
  entityIds: number[];
  entityNames: string[];
  confidence: number;
  evidence: Record<string, unknown>;
  articles: { id: number; title: string; link: string; sourceName: string }[];
  lastEvidenceAt: string;
}

export type SignalAction = "seen" | "dismissed" | "promoted" | "reopen";
