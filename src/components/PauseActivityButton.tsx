"use client";

import { useEffect, useState } from "react";

interface ActivityState {
  paused: boolean;
  since: string | null;
}

async function requestActivity(init?: RequestInit): Promise<ActivityState> {
  const res = await fetch("/api/activity", { cache: "no-store", ...init });
  if (!res.ok) throw new Error(`/api/activity ${res.status}`);
  return (await res.json()) as ActivityState;
}

/** Operator off switch. Pausing needs a confirm; resuming does not. The red
 * marker shows only for a state the server confirmed. */
export default function PauseActivityButton({ btnClass }: { btnClass: string }) {
  const [state, setState] = useState<ActivityState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    requestActivity().then(setState).catch(() => setError(true));
  }, []);

  async function setPaused(paused: boolean) {
    setConfirming(false);
    setError(false);
    try {
      setState(await requestActivity({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused }),
      }));
    } catch {
      setError(true);
    }
  }

  if (state === null) {
    return error ? <span className="text-xs text-amber-600">Activity state unavailable</span> : null;
  }

  return (
    <div className="flex items-center gap-2">
      {state.paused && (
        <span role="status" className="px-2 py-1 text-xs font-bold text-white bg-red-600 rounded">
          Activity paused
        </span>
      )}
      {error && <span className="text-xs text-amber-600">Failed, try again</span>}
      {confirming ? (
        <>
          <button onClick={() => setPaused(true)} className="px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-lg">
            Confirm pause
          </button>
          <button onClick={() => setConfirming(false)} className={`px-3 py-2 text-sm border rounded-lg ${btnClass}`}>
            Cancel
          </button>
        </>
      ) : (
        <button
          onClick={() => (state.paused ? setPaused(false) : setConfirming(true))}
          className={`px-3 py-2 text-sm font-medium border rounded-lg ${btnClass}`}
        >
          {state.paused ? "Resume activity" : "Pause all activity"}
        </button>
      )}
    </div>
  );
}
