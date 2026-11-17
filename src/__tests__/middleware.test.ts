import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware, isGuarded } from "../middleware";
import { signSession, SESSION_COOKIE } from "@/lib/server/session";

const SECRET = "test-secret";

function req(method: string, path: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = `${SESSION_COOKIE}=${cookie}`;
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

describe("isGuarded", () => {
  it.each([
    ["POST", "/api/activity"],
    ["POST", "/api/candidates"],
    ["POST", "/api/candidates/bulk"],
    ["POST", "/api/signals"],
    ["PATCH", "/api/entities/12"],
    ["POST", "/api/activity/"],
  ])("guards %s %s", (method, path) => {
    expect(isGuarded(method, path)).toBe(true);
  });

  it.each([
    ["GET", "/api/activity"],
    ["GET", "/api/entities/12"],
    ["GET", "/api/feed"],
    ["PATCH", "/api/signals"],
    ["PATCH", "/api/entities"],
    ["PATCH", "/api/entities/12/extra"],
    ["POST", "/api/entities/12"],
    ["POST", "/api/tick"],
    ["POST", "/api/ingest"],
    ["POST", "/api/login"],
    ["POST", "/api/logout"],
    ["GET", "/api/session"],
  ])("leaves %s %s open", (method, path) => {
    expect(isGuarded(method, path)).toBe(false);
  });
});

describe("middleware", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
    process.env.ADMIN_PASSWORD = "pw";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  async function validCookie(): Promise<string> {
    return signSession(SECRET, Date.now() + 60_000);
  }

  it("passes a guarded request with a valid cookie", async () => {
    const res = await middleware(req("POST", "/api/activity", await validCookie()));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("returns 401 with no cookie", async () => {
    const res = await middleware(req("PATCH", "/api/entities/5"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Admin login required" });
  });

  it("returns 401 with a bad cookie", async () => {
    const res = await middleware(req("POST", "/api/signals", "admin.1.bad"));
    expect(res.status).toBe(401);
  });

  it("returns 401 with an expired cookie", async () => {
    const expired = await signSession(SECRET, Date.now() - 1000);
    const res = await middleware(req("POST", "/api/candidates", expired));
    expect(res.status).toBe(401);
  });

  it.each(["SESSION_SECRET", "ADMIN_PASSWORD"])("returns 503 when %s is missing", async (name) => {
    const cookie = await validCookie();
    delete process.env[name];
    const res = await middleware(req("POST", "/api/activity", cookie));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Admin login is not configured" });
  });

  it("passes open paths without a cookie, even with env missing", async () => {
    delete process.env.SESSION_SECRET;
    for (const [m, p] of [["GET", "/api/activity"], ["POST", "/api/tick"], ["POST", "/api/ingest"], ["POST", "/api/login"]]) {
      const res = await middleware(req(m, p));
      expect(res.status).toBe(200);
    }
  });
});
