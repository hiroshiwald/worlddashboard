import dynamic from "next/dynamic";
import { FeedItem } from "@/lib/types";

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

const SignalsTab = dynamic(() => import("../SignalsTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400">Analyzing signals...</p>
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

interface TabContentProps {
  activeTab: string;
  items: FeedItem[];
  filteredItems: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
  onEntitySelect: (id: number) => void;
  onCandidatesChanged: (count: number) => void;
}

export default function TabContent({ activeTab, items, filteredItems, dark, onEntityClick, onEntitySelect, onCandidatesChanged }: TabContentProps) {
  if (activeTab === "feeds") return null;
  // Brief, Signals, and Entities are DB-backed, independent of the live feed
  // items array, so they aren't gated behind items.length like the tabs
  // below. Entities absorbs the former Review tab's candidate queue.
  if (activeTab === "brief") return <BriefTab dark={dark} onEntityClick={onEntityClick} />;
  if (activeTab === "signals") return <SignalsTab dark={dark} onEntityClick={onEntityClick} />;
  if (activeTab === "entities") {
    return <EntitiesTab dark={dark} onEntitySelect={onEntitySelect} onCandidatesChanged={onCandidatesChanged} />;
  }
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
