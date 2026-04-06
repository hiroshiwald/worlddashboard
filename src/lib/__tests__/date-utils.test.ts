import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { timeAgo, formatDate } from "../date-utils";

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "NOW" for future dates', () => {
    expect(timeAgo("2024-06-15T12:01:00Z")).toBe("NOW");
  });

  it('returns "NOW" for dates less than 5 seconds ago', () => {
    expect(timeAgo("2024-06-15T11:59:57Z")).toBe("NOW");
  });

  it("returns seconds for recent times", () => {
    expect(timeAgo("2024-06-15T11:59:30Z")).toBe("30s");
  });

  it("returns minutes", () => {
    expect(timeAgo("2024-06-15T11:50:00Z")).toBe("10m");
  });

  it("returns hours", () => {
    expect(timeAgo("2024-06-15T09:00:00Z")).toBe("3h");
  });

  it("returns days", () => {
    expect(timeAgo("2024-06-13T12:00:00Z")).toBe("2d");
  });
});

describe("formatDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "—" for invalid dates', () => {
    expect(formatDate("not-a-date")).toBe("—");
  });

  it('returns "X ago" for times less than 1 hour ago', () => {
    const result = formatDate("2024-06-15T11:50:00Z");
    expect(result).toContain("ago");
  });

  it('returns "Xh ago" for times 1-24 hours ago', () => {
    const result = formatDate("2024-06-15T08:00:00Z");
    expect(result).toBe("4h ago");
  });

  it("returns formatted date for older times", () => {
    const result = formatDate("2024-06-10T15:30:00Z");
    expect(result).toMatch(/JUN/i);
  });
});
