import { DiscoveryTabTheme } from "@/hooks/useDiscoveryTab";
import { TYPE_DOT_COLORS } from "./utils";

interface DiscoveryLegendProps {
  dark: boolean;
  t: DiscoveryTabTheme;
}

const LEGEND_ITEMS: { key: string; label: string }[] = [
  { key: "novel_edge", label: "Novel Link" },
  { key: "entity_emergence", label: "New Entity" },
  { key: "category_crossover", label: "Cross-Category" },
  { key: "quiet_mover", label: "Quiet Mover" },
  { key: "baseline_surprise", label: "Spiking" },
  { key: "default", label: "Established" },
];

export default function DiscoveryLegend({ dark, t }: DiscoveryLegendProps) {
  return (
    <div className={`flex flex-wrap items-center gap-4 mt-3 px-4 py-2 rounded-lg text-[10px] ${t.legendBg} ${t.textMuted}`}>
      {LEGEND_ITEMS.map(({ key, label }) => (
        <span key={key} className="flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: dark ? TYPE_DOT_COLORS[key].dark : TYPE_DOT_COLORS[key].light }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}
