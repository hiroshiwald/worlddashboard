// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSession } from "../useSession";

function stubFetch(handler: (url: string) => { status?: number; body: unknown }) {
  const fn = vi.fn((url: string) => {
    const { status = 200, body } = handler(url);
    return Promise.resolve({ ok: status < 400, status, json: async () => body });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("useSession", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is general until /api/session answers, then takes the server role", async () => {
    stubFetch(() => ({ body: { role: "admin" } }));
    const { result } = renderHook(() => useSession());
    expect(result.current.role).toBe("general");
    await waitFor(() => expect(result.current.role).toBe("admin"));
  });

  it("stays general when the session check fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => ({ status: 500, body: {} }));
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(err).toHaveBeenCalled());
    expect(result.current.role).toBe("general");
    err.mockRestore();
  });

  it("login success switches to admin and posts the password", async () => {
    const fetchFn = stubFetch((url) => ({ body: { role: url === "/api/login" ? "admin" : "general" } }));
    const { result } = renderHook(() => useSession());
    await act(() => result.current.login("pw"));
    expect(result.current.role).toBe("admin");
    const call = fetchFn.mock.calls.find((c) => c[0] === "/api/login") as unknown as [string, RequestInit];
    expect(call[1].body).toBe(JSON.stringify({ password: "pw" }));
  });

  it("login with a wrong password rejects and stays general", async () => {
    stubFetch((url) => (url === "/api/login" ? { status: 401, body: { error: "no" } } : { body: { role: "general" } }));
    const { result } = renderHook(() => useSession());
    await expect(act(() => result.current.login("bad"))).rejects.toThrow("Wrong password");
    expect(result.current.role).toBe("general");
  });

  it("logout returns to general", async () => {
    stubFetch((url) => ({ body: { role: url === "/api/logout" ? "general" : "admin" } }));
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.role).toBe("admin"));
    await act(() => result.current.logout());
    expect(result.current.role).toBe("general");
  });
});
