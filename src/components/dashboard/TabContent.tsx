import dynamic from "next/dynamic";
import { FeedItem } from "@/lib/types";
import IntelTab from "../IntelTab";

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

const DiscoveryTab = dynamic(() => import("../DiscoveryTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400">Loading discovery view...</p>
    </div>
  ),
});

interface TabContentProps {
  activeTab: string;
  items: FeedItem[];
  filteredItems: FeedItem[];
  dark: boolean;
  onEntityClick: (name: string) => void;
}

export default function TabContent({ activeTab, items, filteredItems, dark, onEntityClick }: TabContentProps) {
  if (activeTab === "feeds" || items.length === 0) return null;

  switch (activeTab) {
    case "map":
      return <MapTab items={filteredItems} dark={dark} onEntityClick={onEntityClick} />;
    case "network":
      return <NetworkTab items={items} dark={dark} onEntityClick={onEntityClick} />;
    case "intel":
      return <IntelTab items={items} dark={dark} onEntityClick={onEntityClick} />;
    case "signals":
      return <SignalsTab items={items} dark={dark} onEntityClick={onEntityClick} />;
    case "discovery":
      return <DiscoveryTab items={items} dark={dark} onEntityClick={onEntityClick} />;
    default:
      return null;
  }
}
