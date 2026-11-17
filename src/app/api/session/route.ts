import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isAdminToken } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ role: "general" });
  const admin = await isAdminToken(secret, req.cookies.get(SESSION_COOKIE)?.value);
  return NextResponse.json({ role: admin ? "admin" : "general" });
}
