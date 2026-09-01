import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatActivity7d, formatActivity30d, formatLastSeen, formatSinceDate, isNewEdge, formatReportedWindow,
} from "../activity-format";

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("formatActivity7d", () => {
  it("renders an honest zero, not a blank", () => {
    expect(formatActivity7d(0, 0)).toBe("0 · 0 src");
  });

  it("renders real counts", () => {
    expect(formatActivity7d(42, 6)).toBe("42 · 6 src");
  });
});

describe("formatActivity30d", () => {
  it("renders the labeled 30-day summary", () => {
    expect(formatActivity30d(120, 9)).toBe("120 mentions · 9 sources · last 30 days");
  });

  it("renders an honest zero", () => {
    expect(formatActivity30d(0, 0)).toBe("0 mentions · 0 sources · last 30 days");
  });
});

describe("formatLastSeen", () => {
  afterEach(() => vi.useRealTimers());

  it("renders an em dash for no recorded mention", () => {
    expect(formatLastSeen(null)).toBe("—");
  });

  it("renders a relative time for a real timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    expect(formatLastSeen(oneHourAgo)).toBe("1h");
  });
});

describe("formatSinceDate", () => {
  it("formats a short month/day date", () => {
    expect(formatSinceDate("2026-06-15T12:00:00.000Z")).toBe("since Jun 15");
  });
});

describe("isNewEdge", () => {
  it("is true for an edge first seen just now", () => {
    expect(isNewEdge(NOW.toISOString(), NOW)).toBe(true);
  });

  it("is true exactly at the 7-day boundary", () => {
    const sevenDaysAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(isNewEdge(sevenDaysAgo, NOW)).toBe(true);
  });

  it("is false just past the 7-day boundary", () => {
    const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isNewEdge(eightDaysAgo, NOW)).toBe(false);
  });

  it("is false for a timestamp in the future", () => {
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString();
    expect(isNewEdge(tomorrow, NOW)).toBe(false);
  });
});

describe("formatReportedWindow", () => {
  afterEach(() => vi.useRealTimers());

  it("renders a range when first and last differ", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const threeDaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatReportedWindow(threeDaysAgo, oneDayAgo)).toBe("reported 3d–1d ago");
  });

  it("collapses to a single point when both ends match", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatReportedWindow(twoDaysAgo, twoDaysAgo)).toBe("reported 2d ago");
  });

  it("says 'reported', never 'seen' or 'observed'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    const result = formatReportedWindow(oneHourAgo, oneHourAgo);
    expect(result).toMatch(/^reported /);
    expect(result).not.toMatch(/seen|observed/);
  });
});
