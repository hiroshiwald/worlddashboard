// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSignalsTab } from "../useSignalsTab";

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body })),
  );
}

describe("useSignalsTab warmup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes a well-shaped warmup object parsed from the API response", async () => {
    stubFetch({ signals: [], warmup: { active: true, daysRemaining: 3.5 } });
    const { result } = renderHook(() => useSignalsTab({ dark: false, onEntityClick: () => {} }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.warmup).toEqual({ active: true, daysRemaining: 3.5 });
  });

  it("defaults warmup to null when the response omits it", async () => {
    stubFetch({ signals: [] });
    const { result } = renderHook(() => useSignalsTab({ dark: false, onEntityClick: () => {} }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.warmup).toBeNull();
  });

  it("defaults warmup to null when the field is malformed", async () => {
    stubFetch({ signals: [], warmup: { active: "yes", daysRemaining: 3 } });
    const { result } = renderHook(() => useSignalsTab({ dark: false, onEntityClick: () => {} }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.warmup).toBeNull();
  });
});
