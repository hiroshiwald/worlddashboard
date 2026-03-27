import { Signal, SignalSeverity, ExtractedEntity, FeedItem } from "./types";

// ─── Impact domains ───
export type CascadeDomain =
  | "military" | "energy" | "shipping" | "commodities"
  | "financial" | "supply_chain" | "cyber" | "infrastructure"
  | "humanitarian" | "sanctions" | "diplomatic" | "health";

const DOMAIN_LABELS: Record<CascadeDomain, string> = {
  military: "MILITARY", energy: "ENERGY", shipping: "SHIPPING",
  commodities: "COMMODITIES", financial: "FINANCIAL", supply_chain: "SUPPLY CHAIN",
  cyber: "CYBER", infrastructure: "INFRASTRUCTURE", humanitarian: "HUMANITARIAN",
  sanctions: "SANCTIONS", diplomatic: "DIPLOMATIC", health: "HEALTH",
};

// ─── Static causal graph ───
const EDGES: Record<CascadeDomain, { target: CascadeDomain; label: string }[]> = {
  military:       [{ target: "energy", label: "Energy supply disruption" }, { target: "humanitarian", label: "Civilian displacement" }, { target: "sanctions", label: "Sanctions escalation" }, { target: "diplomatic", label: "Diplomatic crisis" }],
  energy:         [{ target: "shipping", label: "Shipping route repricing" }, { target: "commodities", label: "Commodity price shock" }, { target: "financial", label: "Market volatility" }, { target: "supply_chain", label: "Input cost surge" }],
  shipping:       [{ target: "supply_chain", label: "Delivery delays" }, { target: "commodities", label: "Trade flow disruption" }],
  cyber:          [{ target: "infrastructure", label: "Infrastructure degradation" }, { target: "financial", label: "Market confidence loss" }, { target: "energy", label: "Grid/pipeline vulnerability" }],
  sanctions:      [{ target: "financial", label: "Capital flow restriction" }, { target: "commodities", label: "Trade embargo effects" }, { target: "diplomatic", label: "Alliance realignment" }],
  humanitarian:   [{ target: "diplomatic", label: "International pressure" }, { target: "health", label: "Public health strain" }],
  infrastructure: [{ target: "supply_chain", label: "Logistics bottleneck" }, { target: "financial", label: "Asset repricing" }],
  commodities:    [{ target: "financial", label: "Price transmission" }, { target: "supply_chain", label: "Procurement disruption" }],
  diplomatic:     [{ target: "sanctions", label: "Sanction triggers" }, { target: "military", label: "Force posture shift" }],
  health:         [{ target: "humanitarian", label: "Aid mobilization" }, { target: "diplomatic", label: "International response" }],
  financial:      [{ target: "commodities", label: "Capital reallocation" }, { target: "diplomatic", label: "Economic pressure" }],
  supply_chain:   [{ target: "commodities", label: "Scarcity pricing" }, { target: "financial", label: "Earnings impact" }],
};

// ─── Entity → domain mapping ───
const ENTITY_DOMAINS: Record<string, CascadeDomain[]> = {
  "Strait of Hormuz": ["energy", "shipping"], "Persian Gulf": ["energy", "shipping"],
  "OPEC": ["energy"], "IAEA": ["energy"], "Red Sea": ["shipping", "military"],
  "Suez Canal": ["shipping"], "Bab el-Mandeb": ["shipping", "military"],
  "South China Sea": ["shipping", "military"], "Taiwan Strait": ["shipping", "military"],
  "NATO": ["military"], "Pentagon": ["military"], "IDF": ["military"],
  "Wagner Group": ["military"], "Hamas": ["military"], "Hezbollah": ["military"],
  "ISIS": ["military"], "Al-Qaeda": ["military"], "Houthi": ["military"],
  "IMF": ["financial"], "World Bank": ["financial"], "ECB": ["financial"],
  "WTO": ["supply_chain"], "WHO": ["health"], "UNHCR": ["humanitarian"],
  "Red Cross": ["humanitarian"], "Doctors Without Borders": ["humanitarian"],
  "Amnesty International": ["humanitarian"], "Human Rights Watch": ["humanitarian"],
};

const CATEGORY_DOMAIN: Record<string, CascadeDomain> = {
  "Conflict": "military", "Defense": "military", "OSINT": "military",
  "Military/Alerts": "military", "Military/Aviation": "military",
  "Military/Electronic Warfare": "military", "Military/Infrastructure": "military",
  "Military/Maritime": "military", "Military/Space": "military",
  "Economic/Energy": "energy", "Infrastructure/Energy": "energy",
  "Radiation": "energy", "Radiation/Nuclear": "energy",
  "Trade/Maritime": "shipping", "Supply Chain/Maritime": "shipping",
  "Economic/Markets": "financial", "Economic/Credit": "financial",
  "Crypto": "financial", "Economic/Crypto": "financial", "Prediction Markets": "financial",
  "Supply Chain": "supply_chain",
  "Cyber": "cyber", "Cyber Threats": "cyber",
  "Infrastructure": "infrastructure", "Infrastructure/Tech": "infrastructure",
  "Infrastructure/Telecom": "infrastructure", "Infrastructure/Resources": "infrastructure",
  "Humanitarian": "humanitarian", "Displacement/Humanitarian": "humanitarian",
  "Conflict/Humanitarian": "humanitarian",
  "Economic/Sanctions": "sanctions", "Sanctions": "sanctions",
  "Geopolitics": "diplomatic", "Think Tank": "diplomatic", "Government Advisory": "diplomatic",
  "Health": "health", "Food Security": "health",
  "Economic": "commodities", "Economic/Sentiment": "commodities",
  "Economic/Forecasts": "commodities", "Economic/Development": "commodities",
};

export { DOMAIN_LABELS };

// ─── Cascade chain output ───
export interface CascadeNode {
  domain: CascadeDomain;
  label: string;
  order: 0 | 1 | 2;
}

export interface CascadeChain {
  signalId: string;
  signalTitle: string;
  signalSeverity: SignalSeverity;
  triggerDomain: CascadeDomain;
  nodes: CascadeNode[];
}

function resolveDomains(
  entityNames: string[],
  items: FeedItem[],
  entityMap: Map<string, ExtractedEntity>
): CascadeDomain[] {
  const domains = new Set<CascadeDomain>();
  for (const name of entityNames) {
    const direct = ENTITY_DOMAINS[name];
    if (direct) { direct.forEach((d) => domains.add(d)); continue; }
    // Fallback: tally source categories of items mentioning this entity
    const entity = entityMap.get(name);
    if (!entity) continue;
    const catCounts = new Map<string, number>();
    for (const itemId of entity.itemIds) {
      const item = items.find((i) => i.id === itemId);
      if (item) catCounts.set(item.sourceCategory, (catCounts.get(item.sourceCategory) || 0) + 1);
    }
    let best: string | null = null, bestN = 0;
    for (const [cat, n] of catCounts) { if (n > bestN) { best = cat; bestN = n; } }
    if (best && CATEGORY_DOMAIN[best]) domains.add(CATEGORY_DOMAIN[best]);
  }
  return Array.from(domains);
}

export function computeCascades(
  signals: Signal[],
  entities: ExtractedEntity[],
  items: FeedItem[]
): CascadeChain[] {
  const entityMap = new Map(entities.map((e) => [e.name, e]));
  const chains: CascadeChain[] = [];
  const seen = new Set<string>(); // deduplicate by "triggerDomain→2ndDomain"

  for (const sig of signals) {
    if (sig.severity === "advisory") continue;
    const triggerDomains = resolveDomains(sig.entities, items, entityMap);
    if (triggerDomains.length === 0) continue;

    for (const td of triggerDomains) {
      const edges2 = EDGES[td] || [];
      for (const e2 of edges2.slice(0, 2)) {
        const key = `${td}-${e2.target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const nodes: CascadeNode[] = [
          { domain: td, label: sig.title, order: 0 },
          { domain: e2.target, label: e2.label, order: 1 },
        ];
        // 3rd order: first edge from 2nd-order domain that isn't the trigger
        const edges3 = (EDGES[e2.target] || []).filter((e) => e.target !== td);
        if (edges3.length > 0) {
          nodes.push({ domain: edges3[0].target, label: edges3[0].label, order: 2 });
        }
        chains.push({
          signalId: sig.id, signalTitle: sig.title,
          signalSeverity: sig.severity, triggerDomain: td, nodes,
        });
      }
    }
  }

  // Sort: critical first, then by number of nodes (longer chains first)
  chains.sort((a, b) => {
    if (a.signalSeverity !== b.signalSeverity) return a.signalSeverity === "critical" ? -1 : 1;
    return b.nodes.length - a.nodes.length;
  });
  return chains.slice(0, 6);
}
