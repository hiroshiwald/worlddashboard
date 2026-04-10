"use client";

import { FeedItem } from "@/lib/types";
import { useDiscoveryTab } from "@/hooks/useDiscoveryTab";
import { DiscoveryControls, ScatterPlot, DiscoveryLegend } from "./discovery";

interface DiscoveryTabProps {
  items: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

export default function DiscoveryTab({ items, dark, onEntityClick }: DiscoveryTabProps) {
  const {
    filteredEntities, entityPositions, edges,
    edgeMode, setEdgeMode, typeFilter, toggleType,
    minMentions, setMinMentions,
    hoveredEntity, hoveredEntityData, hoveredLatestArticle,
    tooltipPos, handleDotHover, entityTypes, t,
  } = useDiscoveryTab({ items, dark, onEntityClick });

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      <DiscoveryControls
        edgeMode={edgeMode}
        setEdgeMode={setEdgeMode}
        typeFilter={typeFilter}
        toggleType={toggleType}
        minMentions={minMentions}
        setMinMentions={setMinMentions}
        entityTypes={entityTypes}
        t={t}
      />

      <ScatterPlot
        filteredEntities={filteredEntities}
        entityPositions={entityPositions}
        edges={edges}
        hoveredEntity={hoveredEntity}
        hoveredEntityData={hoveredEntityData}
        hoveredLatestArticle={hoveredLatestArticle}
        tooltipPos={tooltipPos}
        handleDotHover={handleDotHover}
        onEntityClick={onEntityClick}
        dark={dark}
        t={t}
      />

      <DiscoveryLegend dark={dark} t={t} />
    </div>
  );
}
