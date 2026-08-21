"use client";

import { useEffect } from "react";
import { ToastState } from "./types";

// Consequence narration's confirmation half: reuses ErrorToast's fixed
// bottom-corner shell/dismiss pattern but auto-dismisses (errors never do)
// and carries an optional Undo — the persistent affordance stays live for
// the whole ~8s window, not just on hover.
const AUTO_DISMISS_MS = 8000;

interface SuccessToastProps {
  toast: ToastState | null;
  dark: boolean;
  onDismiss: () => void;
}

export default function SuccessToast({ toast, dark, onDismiss }: SuccessToastProps) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;

  const handleUndo = () => {
    toast.onUndo?.();
    onDismiss();
  };

  return (
    <div className="fixed bottom-20 right-4 z-40 w-full max-w-sm px-4 sm:px-0">
      <div className={`border rounded-xl shadow-lg px-4 py-3 ${dark ? "bg-emerald-950 border-emerald-800 text-emerald-200" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm">{toast.message}</p>
          <div className="flex items-center gap-2 shrink-0">
            {toast.onUndo && (
              <button onClick={handleUndo} className="text-xs font-semibold underline hover:no-underline">
                Undo
              </button>
            )}
            <button onClick={onDismiss} aria-label="Dismiss" className="text-xs opacity-70 hover:opacity-100">
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
