"use client";

import { useMemo, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { FeedItem, UrgencyLevel } from "@/lib/types";
import { extractEntities } from "@/lib/entity-extractor";
import { getCoordinates } from "@/lib/geo-coordinates";

interface MapTabProps {
  items: FeedItem[];
  dark: boolean;
  onEntityClick?: (name: string) => void;
}

interface MapMarkerData {
  name: string;
  lat: number;
  lng: number;
  mentions: number;
  maxUrgency: UrgencyLevel;
  urgencyBreakdown: Record<UrgencyLevel, number>;
  headlines: { title: string; link: string }[];
}

const URGENCY_COLORS: Record<UrgencyLevel, string> = {
  critical: "#ef4444",
  warning: "#f59e0b",
  advisory: "#eab308",
  monitoring: "#0ea5e9",
  system: "#64748b",
  neutral: "#94a3b8",
};

const URGENCY_PRIORITY: UrgencyLevel[] = [
  "critical",
  "warning",
  "advisory",
  "monitoring",
  "system",
  "neutral",
];

const DARK_TILES =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const LIGHT_TILES =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

function TileSwapper({ dark }: { dark: boolean }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
  }, [map]);
  return (
    <TileLayer
      key={dark ? "dark" : "light"}
      attribution={TILE_ATTR}
      url={dark ? DARK_TILES : LIGHT_TILES}
    />
  );
}

function getRadius(mentions: number, maxMentions: number): number {
  const min = 6;
  const max = 28;
  if (maxMentions <= 1) return min;
  const ratio = Math.sqrt(mentions) / Math.sqrt(maxMentions);
  return min + ratio * (max - min);
}

export default function MapTab({ items, dark, onEntityClick }: MapTabProps) {
  const markers: MapMarkerData[] = useMemo(() => {
    const entities = extractEntities(items);
    const result: MapMarkerData[] = [];

    for (const entity of entities) {
      if (entity.type !== "country" && entity.type !== "region") continue;
      const coords = getCoordinates(entity.name);
      if (!coords) continue;

      let maxUrgency: UrgencyLevel = "neutral";
      for (const level of URGENCY_PRIORITY) {
        if (entity.urgencyBreakdown[level] > 0) {
          maxUrgency = level;
          break;
        }
      }

      const headlines: { title: string; link: string }[] = [];
      for (const id of entity.itemIds.slice(0, 5)) {
        const item = items.find((i) => i.id === id);
        if (item) headlines.push({ title: item.title, link: item.link });
      }

      result.push({
        name: entity.name,
        lat: coords.lat,
        lng: coords.lng,
        mentions: entity.mentions,
        maxUrgency,
        urgencyBreakdown: entity.urgencyBreakdown,
        headlines,
      });
    }

    return result;
  }, [items]);

  const maxMentions = useMemo(
    () => Math.max(1, ...markers.map((m) => m.mentions)),
    [markers]
  );

  const t = {
    popupBg: dark ? "bg-slate-900 text-slate-100" : "bg-white text-gray-900",
    headlineLink: dark
      ? "text-blue-400 hover:text-blue-300"
      : "text-blue-600 hover:text-blue-700",
    subText: dark ? "text-slate-400" : "text-gray-500",
  };

  return (
    <div className="w-full h-full">
      <MapContainer
        center={[20, 0]}
        zoom={2}
        minZoom={2}
        maxZoom={10}
        className="w-full h-full"
        style={{ background: dark ? "#0f172a" : "#f9fafb" }}
        worldCopyJump={true}
      >
        <TileSwapper dark={dark} />
        {markers.map((m) => (
          <CircleMarker
            key={m.name}
            center={[m.lat, m.lng]}
            radius={getRadius(m.mentions, maxMentions)}
            pathOptions={{
              color: URGENCY_COLORS[m.maxUrgency],
              fillColor: URGENCY_COLORS[m.maxUrgency],
              fillOpacity: 0.5,
              weight: 2,
              opacity: 0.85,
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -8]}
              className={dark ? "map-tooltip-dark" : "map-tooltip"}
            >
              <span className="text-xs font-semibold">
                {m.name}
              </span>
              <span className="text-xs ml-1.5 opacity-60">
                {m.mentions} mention{m.mentions !== 1 ? "s" : ""}
              </span>
            </Tooltip>
            <Popup className={dark ? "map-popup map-popup-dark" : "map-popup"} maxWidth={320} minWidth={220}>
              <div className={`${t.popupBg} -m-[13px] -mt-[12px] p-4 rounded-xl shadow-lg`}>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-sm font-bold tracking-wide">
                    {m.name}
                  </span>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                    style={{
                      backgroundColor: URGENCY_COLORS[m.maxUrgency] + "20",
                      color: URGENCY_COLORS[m.maxUrgency],
                    }}
                  >
                    {m.maxUrgency.toUpperCase()}
                  </span>
                </div>

                {/* Urgency breakdown bar */}
                <div className="flex h-2 rounded-full overflow-hidden mb-2.5 gap-px">
                  {URGENCY_PRIORITY.filter(
                    (l) => m.urgencyBreakdown[l] > 0
                  ).map((level) => (
                    <div
                      key={level}
                      style={{
                        backgroundColor: URGENCY_COLORS[level],
                        flex: m.urgencyBreakdown[level],
                      }}
                      title={`${level}: ${m.urgencyBreakdown[level]}`}
                    />
                  ))}
                </div>

                <div className={`text-xs mb-2.5 ${t.subText}`}>
                  {m.mentions} mention{m.mentions !== 1 ? "s" : ""} across{" "}
                  {m.headlines.length}+ stories
                </div>

                {/* Headlines */}
                <div className="space-y-2">
                  {m.headlines.map((h, i) => (
                    <a
                      key={i}
                      href={h.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`block text-xs leading-snug hover:underline ${t.headlineLink}`}
                    >
                      {h.title.length > 80
                        ? h.title.slice(0, 80) + "..."
                        : h.title}
                    </a>
                  ))}
                </div>

                {onEntityClick && (
                  <button
                    onClick={() => onEntityClick(m.name)}
                    className={`mt-3 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                      dark
                        ? "bg-slate-800 hover:bg-slate-700 text-slate-300"
                        : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                    }`}
                  >
                    View in Feeds &rarr;
                  </button>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
