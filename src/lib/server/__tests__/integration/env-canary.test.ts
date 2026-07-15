import { describe, it, expect } from "vitest";

// Ungated (no skipIf): guards against CI silently running with the Postgres
// service container up but TEST_DATABASE_URL unset — which would make every
// integration test below skip cleanly instead of actually running.
describe("integration test environment", () => {
  it("requires TEST_DATABASE_URL to be set when running in CI", () => {
    if (process.env.CI && !process.env.TEST_DATABASE_URL) {
      throw new Error(
        "CI is set but TEST_DATABASE_URL is not — the integration test suite would silently skip. " +
          "Check the Postgres service container and env wiring in .github/workflows/test.yml.",
      );
    }
    expect(true).toBe(true);
  });
});
