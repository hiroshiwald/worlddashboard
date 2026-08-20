"use client";

import { useState } from "react";

type LinkState = "idle" | "loading" | "missing" | "error";

async function lookupArticleLink(title: string): Promise<string | null> {
  const res = await fetch(`/api/articles?titleExact=${encodeURIComponent(title)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
  const data = await res.json();
  return typeof data.link === "string" ? data.link : null;
}

// Spine 2, evidence one click away: resolves a candidate's sample title to
// its source article on click and opens it — an honest miss ("no longer
// retained") is shown inline rather than a silent dead link.
export default function SampleTitleLink({ title, dark }: { title: string; dark: boolean }) {
  const [state, setState] = useState<LinkState>("idle");

  const handleClick = async () => {
    setState("loading");
    try {
      const link = await lookupArticleLink(title);
      if (link) {
        window.open(link, "_blank", "noopener,noreferrer");
        setState("idle");
      } else {
        setState("missing");
      }
    } catch {
      setState("error");
    }
  };

  if (state === "missing") {
    return (
      <span className={`italic truncate block ${dark ? "text-slate-600" : "text-gray-400"}`}>
        &ldquo;{title}&rdquo; — article no longer retained
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={state === "loading"}
      className={`text-left truncate block w-full hover:underline disabled:opacity-50 disabled:no-underline ${dark ? "text-slate-400 hover:text-blue-300" : "text-gray-500 hover:text-blue-600"}`}
    >
      &ldquo;{title}&rdquo;{state === "error" ? " — couldn't check, click to retry" : ""}
    </button>
  );
}
