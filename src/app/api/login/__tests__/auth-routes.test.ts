import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as login } from "../route";
import { POST as logout } from "../../logout/route";
import { GET as getSession } from "../../session/route";
import { SESSION_COOKIE } from "@/lib/server/session";

function loginReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/login", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("auth routes", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.SESSION_SECRET = "s";
    process.env.ADMIN_PASSWORD = "pw";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("login 503 when not configured", async () => {
    delete process.env.ADMIN_PASSWORD;
    expect((await login(loginReq({ password: "pw" }))).status).toBe(503);
  });

  it.each([["not json"], [{}], [{ password: 5 }], [{ password: "" }], [{ password: "x".repeat(201) }]])(
    "login 400 for bad body %j",
    async (body) => {
      expect((await login(loginReq(body))).status).toBe(400);
    },
  );

  it("login 401 for wrong password, no cookie set", async () => {
    const res = await login(loginReq({ password: "nope" }));
    expect(res.status).toBe(401);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("login 200 sets a hardened cookie that /api/session accepts", async () => {
    const res = await login(loginReq({ password: "pw" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "admin" });
    const cookie = res.cookies.get(SESSION_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 2592000 });

    const sessionReq = new NextRequest("http://localhost/api/session", {
      headers: { cookie: `${SESSION_COOKIE}=${cookie?.value}` },
    });
    expect(await (await getSession(sessionReq)).json()).toEqual({ role: "admin" });
  });

  it("session is general without or with a bad cookie", async () => {
    const none = new NextRequest("http://localhost/api/session");
    expect(await (await getSession(none)).json()).toEqual({ role: "general" });
    const bad = new NextRequest("http://localhost/api/session", { headers: { cookie: `${SESSION_COOKIE}=junk` } });
    expect(await (await getSession(bad)).json()).toEqual({ role: "general" });
  });

  it("logout clears the cookie", async () => {
    const res = await logout();
    expect(await res.json()).toEqual({ role: "general" });
    expect(res.cookies.get(SESSION_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });
});
