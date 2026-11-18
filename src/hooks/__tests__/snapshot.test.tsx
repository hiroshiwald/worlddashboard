// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { SnapshotProvider, useSnapshot } from "@/components/SnapshotContext";
import { sameGraph } from "@/hooks/useEntityMap";
import { sameEmerging } from "@/hooks/useEmerging";
import type { GraphResponse } from "@/lib/server/graph";
import type { EmergingResponse } from "@/lib/emerging-types";

describe("useSnapshot", () => {
  it("throws without a provider", () => {
    expect(() => renderHook(() => useSnapshot<number>("k"))).toThrow(/SnapshotProvider/);
  });

  it("returns undefined first, then the saved value, per key", () => {
    const wrapper = ({ children }: { children: ReactNode }) => <SnapshotProvider>{children}</SnapshotProvider>;
    const { result } = renderHook(() => ({ a: useSnapshot<number>("a"), b: useSnapshot<number>("b") }), { wrapper });
    expect(result.current.a[0]).toBeUndefined();
    act(() => result.current.a[1](42));
    expect(result.current.a[0]).toBe(42);
    expect(result.current.b[0]).toBeUndefined();
  });
});

describe("sameGraph / sameEmerging", () => {
  const graph = (nodes: unknown[], at: string) => ({ nodes, edges: [], clusters: [], stats: {}, generatedAt: at }) as unknown as GraphResponse;
  it("ignores generatedAt and compares nodes and edges", () => {
    expect(sameGraph(graph([{ id: "1" }], "t1"), graph([{ id: "1" }], "t2"))).toBe(true);
    expect(sameGraph(graph([{ id: "1" }], "t1"), graph([{ id: "2" }], "t1"))).toBe(false);
  });
  const em = (days: number, items: unknown[]) => ({ days, items, generatedAt: "x" }) as unknown as EmergingResponse;
  it("compares days and items", () => {
    expect(sameEmerging(em(7, [{ key: "a" }]), em(7, [{ key: "a" }]))).toBe(true);
    expect(sameEmerging(em(7, [{ key: "a" }]), em(30, [{ key: "a" }]))).toBe(false);
    expect(sameEmerging(em(7, [{ key: "a" }]), em(7, [{ key: "b" }]))).toBe(false);
  });
});
