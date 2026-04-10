import { EnrichedEntity } from "@/lib/types";

export const TYPE_DOT_COLORS: Record<string, { dark: string; light: string }> = {
  novel_edge: { dark: "#2dd4bf", light: "#0d9488" },
  entity_emergence: { dark: "#fbbf24", light: "#d97706" },
  category_crossover: { dark: "#fb923c", light: "#ea580c" },
  quiet_mover: { dark: "#a78bfa", light: "#7c3aed" },
  baseline_surprise: { dark: "#60a5fa", light: "#2563eb" },
  negative: { dark: "#f87171", light: "#dc2626" },
  default: { dark: "#64748b", light: "#94a3b8" },
};

export function getDotColor(entity: EnrichedEntity, dark: boolean): string {
  if (entity.noveltyReasons.length > 0) {
    const topType = entity.noveltyReasons[0].type;
    const colors = TYPE_DOT_COLORS[topType] || TYPE_DOT_COLORS.default;
    return dark ? colors.dark : colors.light;
  }
  if (entity.sentiment < -0.3) {
    return dark ? TYPE_DOT_COLORS.negative.dark : TYPE_DOT_COLORS.negative.light;
  }
  return dark ? TYPE_DOT_COLORS.default.dark : TYPE_DOT_COLORS.default.light;
}
