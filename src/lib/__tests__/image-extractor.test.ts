import { describe, it, expect } from "vitest";
import { extractImageUrl, getDomainFromUrl, getSourceImageUrl } from "../image-extractor";

describe("getDomainFromUrl", () => {
  it("extracts domain from valid URL", () => {
    expect(getDomainFromUrl("https://www.example.com/path")).toBe("www.example.com");
  });

  it("returns empty string for invalid URL", () => {
    expect(getDomainFromUrl("not-a-url")).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(getDomainFromUrl("")).toBe("");
  });
});

describe("getSourceImageUrl", () => {
  it("returns favicon URL from link domain", () => {
    const result = getSourceImageUrl("https://cnn.com/article", "https://rss.cnn.com/feed");
    expect(result).toContain("google.com/s2/favicons");
    expect(result).toContain("cnn.com");
  });

  it("falls back to source URL domain", () => {
    const result = getSourceImageUrl("", "https://rss.cnn.com/feed");
    expect(result).toContain("rss.cnn.com");
  });

  it("returns empty string when both are invalid", () => {
    expect(getSourceImageUrl("", "")).toBe("");
  });
});

describe("extractImageUrl", () => {
  it("extracts from media:content with image extension", () => {
    const block = '<media:content url="https://img.com/photo.jpg" type="image/jpeg" />';
    expect(extractImageUrl(block)).toBe("https://img.com/photo.jpg");
  });

  it("extracts from media:content with medium=image", () => {
    const block = '<media:content medium="image" url="https://img.com/proxy/abc123" />';
    expect(extractImageUrl(block)).toBe("https://img.com/proxy/abc123");
  });

  it("extracts from media:content with reversed attributes", () => {
    const block = '<media:content url="https://img.com/proxy/abc123" medium="image" />';
    expect(extractImageUrl(block)).toBe("https://img.com/proxy/abc123");
  });

  it("extracts from media:thumbnail", () => {
    const block = '<media:thumbnail url="https://img.com/thumb.jpg" />';
    expect(extractImageUrl(block)).toBe("https://img.com/thumb.jpg");
  });

  it("extracts from enclosure with image type", () => {
    const block = '<enclosure url="https://img.com/photo.png" type="image/png" />';
    expect(extractImageUrl(block)).toBe("https://img.com/photo.png");
  });

  it("extracts from img tag inside description", () => {
    const block = '<description><![CDATA[<img src="https://img.com/photo.jpg" /> Some text]]></description>';
    expect(extractImageUrl(block)).toBe("https://img.com/photo.jpg");
  });

  it("returns empty string when no image found", () => {
    const block = "<title>No Image</title><description>Plain text</description>";
    expect(extractImageUrl(block)).toBe("");
  });

  it("extracts from media:content with any https URL as fallback", () => {
    const block = '<media:content url="https://cdn.example.com/video.mp4" />';
    expect(extractImageUrl(block)).toBe("https://cdn.example.com/video.mp4");
  });

  it("extracts webp images", () => {
    const block = '<media:content url="https://img.com/photo.webp" />';
    expect(extractImageUrl(block)).toBe("https://img.com/photo.webp");
  });

  it("handles enclosure with reversed attribute order", () => {
    const block = '<enclosure type="image/jpeg" url="https://img.com/photo.jpg" />';
    expect(extractImageUrl(block)).toBe("https://img.com/photo.jpg");
  });
});
