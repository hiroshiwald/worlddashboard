"use client";

import type { EntityMapState } from "@/hooks/useEntityMap";
import type { EmergingState } from "@/hooks/useEmerging";
import type { EmergingItem } from "@/lib/emerging-types";
import { useIsAdmin } from "@/components/AdminContext";
import { NO_ANCHOR_LABEL } from "./universe";

const BTN = "rounded border px-2 py-1 disabled:opacity-50";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

interface ListProps {
  emerging: EmergingState;
  state: EntityMapState;
  muted: string;
}


/** One new name: what it is, the evidence, and Track or Ignore. */
export function NameCard({ emerging, state, muted }: ListProps) {
  const item = emerging.load.status === "ready" ? emerging.load.data.items.find((i) => i.key === state.selected) : undefined;
  if (item === undefined) return <p className={muted}>This name is no longer listed.</p>;
  const others = item.anchors.slice(1);
  return (
    <div data-testid="name-card">
      <button type="button" className={`mb-2 text-xs hover:underline ${muted}`} onClick={state.up}>Back to the list (Esc)</button>
      <h3 className="text-base font-semibold">{item.name} <span className={`text-sm font-normal ${muted}`}>{item.type}</span></h3>
      <p className="mt-1" data-testid="name-context">{item.context ?? <span className={muted}>No description yet.</span>}</p>
      <p className={`mt-2 ${muted}`}>First seen {item.firstSeenAt.slice(0, 10)}, {plural(item.mentions, "mention")}</p>
      {item.anchors.length === 0 && <p className={muted}>{NO_ANCHOR_LABEL}</p>}
      {others.length > 0 && <p className={muted}>Also near {others.map((a) => a.name).join(", ")}</p>}
      <Headlines item={item} muted={muted} />
      <Actions item={item} emerging={emerging} />
    </div>
  );
}

function Headlines({ item, muted }: { item: EmergingItem; muted: string }) {
  if (item.sampleTitles.length === 0) return null;
  return (
    <ul className="mt-2 list-disc pl-4" data-testid="name-headlines">
      {item.sampleTitles.map((title, i) => (
        <li key={title}>
          {item.links[i] ? <a className="text-sky-600 hover:underline" href={item.links[i]} target="_blank" rel="noopener noreferrer">{title}</a> : <span className={muted}>{title}</span>}
        </li>
      ))}
    </ul>
  );
}

function Actions({ item, emerging }: { item: EmergingItem; emerging: EmergingState }) {
  const isAdmin = useIsAdmin();
  if (!isAdmin) return null;
  const done = emerging.resolved[item.key];
  if (done !== undefined) {
    return <p className="mt-3 font-medium" role="status" data-testid="name-resolved">{done === "tracked" ? "Tracked." : "Ignored."}</p>;
  }
  const busy = emerging.busy === item.key;
  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <button type="button" className={`${BTN} bg-sky-600 text-white`} disabled={busy} onClick={() => emerging.resolve(item, "track")}>Track</button>
        <button type="button" className={BTN} disabled={busy} onClick={() => emerging.resolve(item, "ignore")}>Ignore</button>
      </div>
      {emerging.actionError !== null && <p className="mt-1 text-red-600" role="alert">{emerging.actionError}</p>}
    </div>
  );
}
