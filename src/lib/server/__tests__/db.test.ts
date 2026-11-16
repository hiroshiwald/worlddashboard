import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { neonMock } = vi.hoisted(() => ({ neonMock: vi.fn(() => vi.fn()) }));
vi.mock("@neondatabase/serverless", () => ({ neon: neonMock }));

import { getSql } from "../db";

describe("getSql", () => {
  const original = process.env.DATABASE_URL;

  beforeEach(() => {
    neonMock.mockClear();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });

  it("throws when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    expect(() => getSql()).toThrow("DATABASE_URL");
  });

  it("opts every query out of the Next.js Data Cache", () => {
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    getSql();
    expect(neonMock).toHaveBeenCalledWith("postgres://user:pass@host/db", {
      fetchOptions: { cache: "no-store" },
    });
  });
});
