import dynamic from "next/dynamic";
import { FeedItem } from "@/lib/types";
import type { MapFocus } from "@/hooks/useDashboardTable";

const BriefTab = dynamic(() => import("../BriefTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400">Loading brief...</p>
    </div>
  ),
});

const MapTab = dynamic(() => import("../MapTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400">Loading map...</p>
    </div>
  ),
});

const NetworkTab = dynamic(() => import("../NetworkTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400">Loading network...</p>
    </div>
  ),
});

const DevelopmentsTab = dynamic(() => import("../DevelopmentsTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400">Analyzing developments...</p>
    </div>
  ),
});

const EntitiesTab = dynamic(() => import("../EntitiesTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400">Loading entities...</p>
    </div>
  ),
});

function tabLoading(label: string) {
  function TabLoading() {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-gray-400">Loading {label}...</p>
      </div>
    );
  }
  return TabLoading;
}

const NewsfeedTab = dynamic(() => import("../newsfeed/NewsfeedTab"), { ssr: false, loading: tabLoading("newsfeed") });
const EntityMapTab = dynamic(() => import("../entitymap/EntityMapTab"), { ssr: false, loading: tabLoading("entity map") });

interface TabContentProps {
  activeTab: string;
  items: FeedItem[];
  filteredItems: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
  onEntitySelect: (id: number) => void;
  onCandidatesChanged: (count: number) => void;
  mapFocus: MapFocus;
  onOpenMap: (focus: MapFocus) => void;
}

export default function TabContent({ activeTab, items, filteredItems, dark, onEntityClick, onEntitySelect, onCandidatesChanged, mapFocus, onOpenMap }: TabContentProps) {
  if (activeTab === "feeds") return null;
  // Brief, Developments, and Entities are DB-backed, independent of the
  // live feed items array, so they aren't gated behind items.length like
  // the tabs below. Entities absorbs the former Review tab's candidate
  // queue.
  if (activeTab === "brief") return <BriefTab dark={dark} onEntityClick={onEntityClick} />;
  if (activeTab === "developments") return <DevelopmentsTab dark={dark} onEntityClick={onEntityClick} />;
  if (activeTab === "entities") {
    return <EntitiesTab dark={dark} onEntitySelect={onEntitySelect} onCandidatesChanged={onCandidatesChanged} onOpenMap={onOpenMap} />;
  }
  if (activeTab === "newsfeed") return <NewsfeedTab dark={dark} onOpenMap={onOpenMap} />;
  if (activeTab === "entitymap") return <EntityMapTab dark={dark} focus={mapFocus} />;
  if (items.length === 0) return null;

  switch (activeTab) {
    case "map":
      return <MapTab items={filteredItems} dark={dark} onEntityClick={onEntityClick} />;
    case "network":
      return <NetworkTab items={items} dark={dark} onEntityClick={onEntityClick} />;
    default:
      return null;
  }
}
