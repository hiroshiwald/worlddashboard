import { describe, it, expect } from "vitest";
import { getUrgencyLevel, getRowClasses, getUrgencyBadgeClasses } from "../urgency";

describe("getUrgencyLevel", () => {
  it("maps conflict to critical", () => {
    expect(getUrgencyLevel("conflict")).toBe("critical");
  });

  it("maps cyber to critical", () => {
    expect(getUrgencyLevel("cyber")).toBe("critical");
  });

  it("maps military to critical", () => {
    expect(getUrgencyLevel("military")).toBe("critical");
  });

  it("maps radiation to critical", () => {
    expect(getUrgencyLevel("radiation")).toBe("critical");
  });

  it("maps space weather to critical", () => {
    expect(getUrgencyLevel("space weather")).toBe("critical");
  });

  it("maps natural disaster to warning", () => {
    expect(getUrgencyLevel("natural disaster")).toBe("warning");
  });

  it("maps health to warning", () => {
    expect(getUrgencyLevel("health")).toBe("warning");
  });

  it("maps displacement to warning", () => {
    expect(getUrgencyLevel("displacement")).toBe("warning");
  });

  it("maps government to advisory", () => {
    expect(getUrgencyLevel("government")).toBe("advisory");
  });

  it("maps sanctions to advisory", () => {
    expect(getUrgencyLevel("sanctions")).toBe("advisory");
  });

  it("maps economic to monitoring", () => {
    expect(getUrgencyLevel("economic")).toBe("monitoring");
  });

  it("maps supply chain to monitoring", () => {
    expect(getUrgencyLevel("supply chain")).toBe("monitoring");
  });

  it("maps infrastructure to system", () => {
    expect(getUrgencyLevel("infrastructure")).toBe("system");
  });

  it("maps ai/ml to system", () => {
    expect(getUrgencyLevel("ai/ml")).toBe("system");
  });

  it("maps unknown category to neutral", () => {
    expect(getUrgencyLevel("entertainment")).toBe("neutral");
  });

  it("is case-insensitive", () => {
    expect(getUrgencyLevel("CONFLICT")).toBe("critical");
    expect(getUrgencyLevel("Natural Disaster")).toBe("warning");
  });
});

describe("getRowClasses", () => {
  it("returns red classes for critical in dark mode", () => {
    const classes = getRowClasses("critical", true);
    expect(classes).toContain("red");
    expect(classes).toContain("border-l-4");
  });

  it("returns red classes for critical in light mode", () => {
    const classes = getRowClasses("critical", false);
    expect(classes).toContain("red");
    expect(classes).toContain("border-l-4");
  });

  it("returns amber classes for warning", () => {
    expect(getRowClasses("warning", true)).toContain("amber");
    expect(getRowClasses("warning", false)).toContain("amber");
  });

  it("returns transparent border for neutral", () => {
    expect(getRowClasses("neutral", true)).toContain("transparent");
    expect(getRowClasses("neutral", false)).toContain("transparent");
  });

  it("returns different classes for dark vs light", () => {
    expect(getRowClasses("critical", true)).not.toBe(getRowClasses("critical", false));
  });
});

describe("getUrgencyBadgeClasses", () => {
  it("returns red badge for critical", () => {
    const classes = getUrgencyBadgeClasses("critical", true);
    expect(classes).toContain("red");
    expect(classes).toContain("rounded-full");
  });

  it("returns amber badge for warning", () => {
    expect(getUrgencyBadgeClasses("warning", false)).toContain("amber");
  });

  it("returns yellow badge for advisory", () => {
    expect(getUrgencyBadgeClasses("advisory", false)).toContain("yellow");
  });

  it("returns sky badge for monitoring", () => {
    expect(getUrgencyBadgeClasses("monitoring", true)).toContain("sky");
  });

  it("includes text size", () => {
    expect(getUrgencyBadgeClasses("neutral", false)).toContain("text-[10px]");
  });
});
