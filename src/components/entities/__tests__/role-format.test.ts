import { describe, it, expect } from "vitest";
import { roleLabel, roleTooltip, roleDescription } from "../role-format";

describe("roleLabel", () => {
  it("maps each role to its display label", () => {
    expect(roleLabel("anchor")).toBe("Anchor");
    expect(roleLabel("famous")).toBe("Context");
    expect(roleLabel("satellite")).toBe("Satellite");
  });
});

describe("roleTooltip", () => {
  it("maps a single anchor reason to plain words", () => {
    expect(roleTooltip("anchor", ["country_or_region_type"])).toBe("country/region type");
  });

  it("joins multiple famous reasons in order", () => {
    expect(roleTooltip("famous", ["famous_stored", "famous_volume"])).toBe(
      "Wikipedia-verified famous, top-quartile mention volume",
    );
  });

  it("maps every documented reason code", () => {
    expect(roleTooltip("anchor", ["country_or_region_type", "high_baseline"])).toBe(
      "country/region type, high mention baseline",
    );
    expect(roleTooltip("famous", ["famous_dictionary", "famous_breadth"])).toBe(
      "seeded dictionary name, wide lifetime source breadth",
    );
  });

  it("returns the fixed satellite sentence regardless of (empty) reasons", () => {
    expect(roleTooltip("satellite", [])).toBe("Eligible to headline development cards.");
  });

  it("falls back to the raw code for an unrecognized reason", () => {
    expect(roleTooltip("anchor", ["some_future_reason"])).toBe("some_future_reason");
  });
});

describe("roleDescription", () => {
  it("formats an anchor's description as 'Label — reasons'", () => {
    expect(roleDescription("anchor", ["country_or_region_type"])).toBe("Anchor — country/region type");
  });

  it("formats a satellite's description using the fixed sentence", () => {
    expect(roleDescription("satellite", [])).toBe("Satellite — Eligible to headline development cards.");
  });
});
