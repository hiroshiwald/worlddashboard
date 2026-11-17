import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ role: "general" });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
