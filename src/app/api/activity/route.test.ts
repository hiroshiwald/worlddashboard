import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const getSettings = vi.fn();
const setActivityPaused = vi.fn();

vi.mock("@/lib/server/db", () => ({ getSql: () => ({}) }));
vi.mock("@/lib/server/settings", () => ({
  getSettings: (...a: unknown[]) => getSettings(...a),
  setActivityPaused: (...a: unknown[]) => setActivityPaused(...a),
}));

const { GET, POST } = await import("./route");

function post(body: string): NextRequest {
  return new NextRequest("http://localhost/api/activity", { method: "POST", body });
}

describe("/api/activity", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
    getSettings.mockReset();
    setActivityPaused.mockReset();
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("GET reports running", async () => {
    getSettings.mockResolvedValue({ activity_paused: 0, activity_paused_since: 0 });
    expect(await (await GET()).json()).toEqual({ paused: false, since: null });
  });

  it("GET reports paused with ISO since", async () => {
    getSettings.mockResolvedValue({ activity_paused: 1, activity_paused_since: 1000 });
    expect(await (await GET()).json()).toEqual({ paused: true, since: "1970-01-01T00:00:01.000Z" });
  });

  it("POST writes the setting and returns the new state", async () => {
    getSettings.mockResolvedValue({ activity_paused: 1, activity_paused_since: 1000 });
    const res = await POST(post('{"paused":true}'));
    expect(res.status).toBe(200);
    expect(setActivityPaused).toHaveBeenCalledWith(expect.anything(), true, expect.any(Date));
  });

  it.each(["not json", "null", "{}", '{"paused":"yes"}', '{"paused":1}'])("POST rejects %s with 400", async (body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(setActivityPaused).not.toHaveBeenCalled();
  });

  it("returns 503 without DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    expect((await GET()).status).toBe(503);
    expect((await POST(post('{"paused":true}'))).status).toBe(503);
  });
});
