import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isAdminToken } from "@/lib/server/session";

export const config = { matcher: "/api/:path*" };

// Demo mode (2026-11-17, operator): only pause/resume needs admin. To restore the
// full guard, add back "/api/candidates", "/api/candidates/bulk", "/api/signals"
// and PATCH /api/entities/<id> (see git history).
const GUARDED_POST = new Set(["/api/activity"]);

export function isGuarded(method: string, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (method === "POST") return GUARDED_POST.has(path);
  return false;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (!isGuarded(req.method, req.nextUrl.pathname)) return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  if (!secret || !process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Admin login is not configured" }, { status: 503 });
  }
  if (!(await isAdminToken(secret, req.cookies.get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  return NextResponse.next();
}
