import { describe, it, expect } from "vitest";
import { signSession, verifySession, passwordMatches } from "../session";

const SECRET = "test-secret";
const NOW = 1_700_000_000_000;

describe("signSession / verifySession", () => {
  it("round-trips a valid token", async () => {
    const token = await signSession(SECRET, NOW + 1000);
    expect(token).toMatch(/^admin\.\d+\.[0-9a-f]{64}$/);
    expect(await verifySession(SECRET, token, NOW)).toBe(true);
  });

  it("rejects an expired token", async () => {
    const token = await signSession(SECRET, NOW - 1);
    expect(await verifySession(SECRET, token, NOW)).toBe(false);
  });

  it("rejects a token whose expiry was edited", async () => {
    const [role, , sig] = (await signSession(SECRET, NOW + 1000)).split(".");
    expect(await verifySession(SECRET, `${role}.${NOW + 999999}.${sig}`, NOW)).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const token = await signSession(SECRET, NOW + 1000);
    const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(await verifySession(SECRET, flipped, NOW)).toBe(false);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signSession("other", NOW + 1000);
    expect(await verifySession(SECRET, token, NOW)).toBe(false);
  });

  it.each(["", "garbage", "admin.123", "user.123.abc", `admin.${NOW + 1000}.zz`])(
    "rejects malformed token %j",
    async (token) => {
      expect(await verifySession(SECRET, token, NOW)).toBe(false);
    },
  );
});

describe("passwordMatches", () => {
  it("accepts the same password", async () => {
    expect(await passwordMatches("hunter2", "hunter2")).toBe(true);
  });

  it("rejects a different password, including a prefix", async () => {
    expect(await passwordMatches("hunter", "hunter2")).toBe(false);
    expect(await passwordMatches("nope", "hunter2")).toBe(false);
  });
});
