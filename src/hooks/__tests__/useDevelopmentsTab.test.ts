// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDevelopmentsTab } from "../useDevelopmentsTab";

function stubFetch(body: unknown, ok = true, status = ok ? 200 : 500) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok, status, json: async () => body })),
  );
}

describe("useDevelopmentsTab", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads developments and diagnostics from the API response", async () => {
    stubFetch({
      developments: [{ subjectName: "Acme Corp" }],
      diagnostics: { draftCount: 10, eligibleCount: 3, rejected: { single_source: 7 } },
      warmup: { active: false, daysRemaining: 0 },
    });
    const { result } = renderHook(() => useDevelopmentsTab());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.developments).toEqual([{ subjectName: "Acme Corp" }]);
    expect(result.current.diagnostics).toEqual({ draftCount: 10, eligibleCount: 3, rejected: { single_source: 7 } });
    expect(result.current.warmup).toEqual({ active: false, daysRemaining: 0 });
    expect(result.current.error).toBeNull();
    expect(result.current.dbUnconfigured).toBe(false);
  });

  it("treats a 503 as dbUnconfigured, not an error", async () => {
    stubFetch({ error: "DATABASE_URL is not configured" }, false, 503);
    const { result } = renderHook(() => useDevelopmentsTab());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dbUnconfigured).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("reports a non-503 failure as an error", async () => {
    stubFetch({}, false, 500);
    const { result } = renderHook(() => useDevelopmentsTab());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to load developments (500)");
    expect(result.current.dbUnconfigured).toBe(false);
  });

  it("passes through a warm-up payload with an empty card set", async () => {
    stubFetch({ developments: [], diagnostics: null, warmup: { active: true, daysRemaining: 4.2 } });
    const { result } = renderHook(() => useDevelopmentsTab());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.warmup).toEqual({ active: true, daysRemaining: 4.2 });
    expect(result.current.developments).toEqual([]);
    expect(result.current.diagnostics).toBeNull();
  });

  it("defaults diagnostics to null when the field is malformed", async () => {
    stubFetch({ developments: [], diagnostics: { draftCount: "bad" }, warmup: { active: false, daysRemaining: 0 } });
    const { result } = renderHook(() => useDevelopmentsTab());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.diagnostics).toBeNull();
  });
});
