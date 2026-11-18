"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// Last loaded data per key, held in DashboardTable's state. Tabs unmount on
// switch; on return they draw this copy at once, then reload as before.
// Updates replace the record; nothing is mutated in place.
interface Snapshots {
  saved: Readonly<Record<string, unknown>>;
  remember: (key: string, value: unknown) => void;
}

const SnapshotContext = createContext<Snapshots | null>(null);

export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Readonly<Record<string, unknown>>>({});
  const remember = useCallback((key: string, value: unknown) => {
    setSaved((prev) => ({ ...prev, [key]: value }));
  }, []);
  const value = useMemo(() => ({ saved, remember }), [saved, remember]);
  return <SnapshotContext.Provider value={value}>{children}</SnapshotContext.Provider>;
}

/** The value last saved under `key` (undefined if none), and a saver bound to
 * `key`. Each key is written by one hook only, which owns its value's type. */
export function useSnapshot<T>(key: string): [T | undefined, (value: T) => void] {
  const ctx = useContext(SnapshotContext);
  if (ctx === null) throw new Error("useSnapshot: no SnapshotProvider above this component");
  const { saved, remember } = ctx;
  const save = useCallback((value: T) => remember(key, value), [remember, key]);
  return [saved[key] as T | undefined, save];
}
