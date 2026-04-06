import { describe, it, expect } from "vitest";
import { isAdContent, isFinancialAd } from "../ad-filter";

describe("isAdContent", () => {
  describe("link pattern matching", () => {
    it("detects CNN underscored links", () => {
      expect(isAdContent("Good Product", "", "https://cnn.com/cnn-underscored/review")).toBe(true);
    });

    it("detects deals links", () => {
      expect(isAdContent("Something", "", "https://example.com/deals/today")).toBe(true);
    });

    it("detects shopping links", () => {
      expect(isAdContent("Item", "", "https://example.com/shopping/sale")).toBe(true);
    });

    it("detects affiliate links", () => {
      expect(isAdContent("Review", "", "https://example.com/affiliate-link")).toBe(true);
    });

    it("passes legitimate news links", () => {
      expect(isAdContent("Breaking News", "", "https://cnn.com/world/article")).toBe(false);
    });
  });

  describe("title pattern matching", () => {
    it("detects ad: prefix", () => {
      expect(isAdContent("Ad: Buy Now", "", "")).toBe(true);
    });

    it("detects sponsored prefix", () => {
      expect(isAdContent("Sponsored: Product Review", "", "")).toBe(true);
    });

    it("detects best deals titles", () => {
      expect(isAdContent("Best laptop deals of 2024", "", "")).toBe(true);
    });

    it("detects coupon codes", () => {
      expect(isAdContent("Use this coupon code for savings", "", "")).toBe(true);
    });

    it("detects gift guides", () => {
      expect(isAdContent("Holiday Gift Guide 2024", "", "")).toBe(true);
    });

    it("detects cash back card ads", () => {
      expect(isAdContent("Best cashback card for groceries", "", "")).toBe(true);
    });

    it("detects mortgage rate ads", () => {
      expect(isAdContent("Today's mortgage rate update", "", "")).toBe(true);
    });

    it("detects horoscopes", () => {
      expect(isAdContent("Horoscope for today", "", "")).toBe(true);
    });

    it("detects wordle/puzzle content", () => {
      expect(isAdContent("Wordle answer for today", "", "")).toBe(true);
    });

    it("passes legitimate news titles", () => {
      expect(isAdContent("NATO Summit Concludes With New Agreement", "", "")).toBe(false);
    });

    it("passes geopolitical titles", () => {
      expect(isAdContent("Russia-Ukraine Conflict Escalates", "", "")).toBe(false);
    });
  });

  describe("combined text matching", () => {
    it("detects paid content in text", () => {
      expect(isAdContent("Great Product", "This is paid content by brand", "")).toBe(true);
    });

    it("detects affiliate links with commission language", () => {
      expect(isAdContent("Product Review", "We earn a commission from affiliate links", "")).toBe(true);
    });
  });
});

describe("isFinancialAd", () => {
  it("detects credit card titles", () => {
    expect(isFinancialAd("Best credit card for travel")).toBe(true);
  });

  it("detects mortgage titles", () => {
    expect(isFinancialAd("Current mortgage rates today")).toBe(true);
  });

  it("detects loan titles", () => {
    expect(isFinancialAd("Personal loan options for you")).toBe(true);
  });

  it("detects APR content", () => {
    expect(isFinancialAd("0% APR intro offer")).toBe(true);
  });

  it("detects home equity titles", () => {
    expect(isFinancialAd("Turn your home equity into cash")).toBe(true);
  });

  it("passes legitimate news without financial keywords", () => {
    expect(isFinancialAd("Federal Reserve Announces Policy Change")).toBe(false);
  });

  it("passes geopolitical titles", () => {
    expect(isFinancialAd("Trade Agreement Signed Between US and EU")).toBe(false);
  });
});
