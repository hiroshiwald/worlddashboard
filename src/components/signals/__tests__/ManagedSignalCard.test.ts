// @vitest-environment jsdom
import { createElement } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AdminProvider } from "@/components/AdminContext";
import ManagedSignalCard from "../ManagedSignalCard";
import type { SignalCardData } from "../types";

const signal: SignalCardData = {
  id: 1, dedupeKey: "k", type: "spike", severity: "warning", state: "new", title: "Spike",
  entityIds: [], entityNames: [], confidence: 0.8, evidence: {}, articles: [],
  firstDetectedAt: "2026-11-16T08:00:00.000Z", stateChangedAt: null, lastEvidenceAt: "2026-11-16T08:00:00.000Z",
};

function renderCard(isAdmin: boolean) {
  const card = createElement(ManagedSignalCard, {
    signal, dark: false, busy: false, actions: ["seen", "dismissed"], onAction: vi.fn(), onEntityClick: vi.fn(),
  });
  render(createElement(AdminProvider, { value: isAdmin }, card));
}

describe("ManagedSignalCard role gating", () => {
  afterEach(cleanup);

  it("shows signal actions to admin", () => {
    renderCard(true);
    expect(screen.getByRole("button", { name: "Seen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("hides signal actions from general", () => {
    renderCard(false);
    expect(screen.queryByRole("button", { name: "Seen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });
});
