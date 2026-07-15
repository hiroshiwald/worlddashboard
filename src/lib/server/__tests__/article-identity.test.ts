import { describe, it, expect } from "vitest";
import { contentHash } from "../article-identity";

describe("contentHash", () => {
  it("is stable for the same input", () => {
    const a = contentHash("Bosnia and Herzegovina sign trade deal", "https://example.com/a");
    const b = contentHash("Bosnia and Herzegovina sign trade deal", "https://example.com/a");
    expect(a).toBe(b);
  });

  it("produces a 64-character hex sha256 digest", () => {
    const hash = contentHash("Title", "https://example.com/a");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is case-insensitive on the title", () => {
    const a = contentHash("Big Story Breaks", "https://example.com/a");
    const b = contentHash("BIG STORY BREAKS", "https://example.com/a");
    expect(a).toBe(b);
  });

  it("is insensitive to whitespace differences in the title", () => {
    const a = contentHash("Big   Story  Breaks", "https://example.com/a");
    const b = contentHash("  Big Story Breaks  ", "https://example.com/a");
    expect(a).toBe(b);
  });

  it("differs when the title differs", () => {
    const a = contentHash("Story One", "https://example.com/a");
    const b = contentHash("Story Two", "https://example.com/a");
    expect(a).not.toBe(b);
  });

  it("differs when the link host differs", () => {
    const a = contentHash("Same Title", "https://example.com/a");
    const b = contentHash("Same Title", "https://other.com/a");
    expect(a).not.toBe(b);
  });

  it("ignores link path differences (only host matters)", () => {
    const a = contentHash("Same Title", "https://example.com/a");
    const b = contentHash("Same Title", "https://example.com/completely-different-path");
    expect(a).toBe(b);
  });

  it("falls back to the raw link when it fails to parse as a URL", () => {
    const hash = contentHash("Some Title", "not-a-valid-url");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats a malformed link as distinct from a well-formed one", () => {
    const a = contentHash("Same Title", "not-a-valid-url");
    const b = contentHash("Same Title", "https://example.com/a");
    expect(a).not.toBe(b);
  });
});
