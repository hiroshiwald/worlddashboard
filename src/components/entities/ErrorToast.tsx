"use client";

// Fixed-position, dismissible, never auto-hides — operator feedback: the old
// inline error banner rendered at the top of the tab and went invisible the
// moment you scrolled. One dismiss clears every message shown at once;
// callers compose the message list from whatever error state applies.
interface ErrorToastProps {
  messages: string[];
  dark: boolean;
  onDismiss: () => void;
}

export default function ErrorToast({ messages, dark, onDismiss }: ErrorToastProps) {
  if (messages.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-full max-w-sm px-4 sm:px-0">
      <div className={`border rounded-xl shadow-lg px-4 py-3 ${dark ? "bg-red-950 border-red-800 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
        <div className="flex items-start justify-between gap-3">
          <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
            {messages.map((m, i) => <li key={`${i}-${m}`}>{m}</li>)}
          </ul>
          <button onClick={onDismiss} aria-label="Dismiss" className="text-xs opacity-70 hover:opacity-100 shrink-0">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
