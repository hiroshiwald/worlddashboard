"use client";

import { useCallback, useEffect, useState } from "react";

export type Role = "admin" | "general";

function parseRole(data: unknown): Role {
  const role = (data as { role?: unknown } | null)?.role;
  if (role === "admin" || role === "general") return role;
  throw new Error("Unexpected session response");
}

async function requestRole(url: string, init?: RequestInit): Promise<Role> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (res.status === 401) throw new Error("Wrong password");
  if (!res.ok) {
    const data: { error?: unknown } | null = await res.json().catch(() => null);
    throw new Error(typeof data?.error === "string" ? data.error : `${url} ${res.status}`);
  }
  return parseRole(await res.json());
}

/** Who is viewing. UI-only gate: the server rejects guarded writes without the cookie. */
export function useSession() {
  const [role, setRole] = useState<Role>("general");

  useEffect(() => {
    // A failed check leaves "general": admin controls stay hidden, never shown by mistake.
    requestRole("/api/session").then(setRole, (e: Error) => console.error(e.message));
  }, []);

  const login = useCallback(async (password: string) => {
    setRole(await requestRole("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }));
  }, []);

  const logout = useCallback(async () => {
    setRole(await requestRole("/api/logout", { method: "POST" }));
  }, []);

  return { role, login, logout };
}

export type SessionState = ReturnType<typeof useSession>;
