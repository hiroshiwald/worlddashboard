import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, passwordMatches, signSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!secret || !adminPassword) {
    return NextResponse.json({ error: "Admin login is not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const password = (body as { password?: unknown } | null)?.password;
  if (typeof password !== "string" || password.length < 1 || password.length > 200) {
    return NextResponse.json({ error: "Invalid request body: password must be 1..200 characters" }, { status: 400 });
  }

  if (!(await passwordMatches(password, adminPassword))) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const token = await signSession(secret, Date.now() + SESSION_MAX_AGE_S * 1000);
  const res = NextResponse.json({ role: "admin" });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
