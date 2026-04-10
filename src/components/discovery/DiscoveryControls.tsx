import { EntityType } from "@/lib/types";
import { EdgeMode, DiscoveryTabTheme } from "@/hooks/useDiscoveryTab";

interface DiscoveryControlsProps {
  edgeMode: EdgeMode;
  setEdgeMode: (mode: EdgeMode) => void;
  typeFilter: Set<EntityType>;
  toggleType: (type: EntityType) => void;
  minMentions: number;
  setMinMentions: (n: number) => void;
  entityTypes: EntityType[];
  t: DiscoveryTabTheme;
}

export default function DiscoveryControls({
  edgeMode, setEdgeMode, typeFilter, toggleType,
  minMentions, setMinMentions, entityTypes, t,
}: DiscoveryControlsProps) {
  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-3 mb-4 rounded-xl border ${t.controlBg}`}>
      <div className="flex items-center gap-1">
        <span className={`text-[10px] font-semibold uppercase mr-1.5 ${t.textMuted}`}>Edges</span>
        {(["all", "novel", "none"] as EdgeMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setEdgeMode(mode)}
            className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
              edgeMode === mode ? t.controlActive : t.controlInactive
            }`}
          >
            {mode === "novel" ? "Novel only" : mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 ml-2">
        <span className={`text-[10px] font-semibold uppercase mr-1.5 ${t.textMuted}`}>Type</span>
        {entityTypes.map((type) => (
          <button
            key={type}
            onClick={() => toggleType(type)}
            className={`text-xs px-2.5 py-1 rounded-lg transition-colors capitalize ${
              typeFilter.has(type) ? t.controlActive : t.controlInactive
            }`}
          >
            {type === "organization" ? "Org" : type}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <span className={`text-[10px] font-semibold uppercase ${t.textMuted}`}>Min mentions</span>
        <input
          type="range"
          min={2}
          max={20}
          value={minMentions}
          onChange={(e) => setMinMentions(Number(e.target.value))}
          className="w-20 accent-emerald-500"
        />
        <span className={`text-xs font-semibold w-5 ${t.text}`}>{minMentions}</span>
      </div>
    </div>
  );
}
