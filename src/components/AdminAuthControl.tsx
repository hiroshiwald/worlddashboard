"use client";

import { useState, type FormEvent } from "react";
import type { SessionState } from "@/hooks/useSession";

/** General viewers see "Admin login" (small password form); the admin sees "Log out". */
export default function AdminAuthControl({ session, btnClass }: { session: SessionState; btnClass: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const btn = `px-3 py-2 text-sm font-medium border rounded-lg ${btnClass}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await session.login(password);
      setOpen(false);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  async function logout() {
    setError(null);
    try {
      await session.logout();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout failed");
    }
  }

  if (session.role === "admin") {
    return (
      <>
        {error !== null && <span role="alert" className="text-xs text-amber-600">{error}</span>}
        <button type="button" onClick={logout} className={btn}>Log out</button>
      </>
    );
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={btn}>Admin login</button>;
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        maxLength={200} required autoFocus aria-label="Admin password" placeholder="Password"
        className="px-2 py-2 text-sm border rounded-lg w-32 text-gray-900"
      />
      <button type="submit" className={btn}>Log in</button>
      <button type="button" onClick={() => setOpen(false)} className={btn}>Cancel</button>
      {error !== null && <span role="alert" className="text-xs text-amber-600">{error}</span>}
    </form>
  );
}
