import { describe, it, expect } from "vitest";
import { stripHtml, extractTag, extractAttr } from "../xml-helpers";

describe("stripHtml", () => {
  it("removes HTML tags", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("decodes common HTML entities", () => {
    // Note: &lt;/&gt; decode to </> which then get stripped as tags in second pass
    expect(stripHtml("&amp; &quot; &#39; &apos;")).toBe('& " \' \'');
  });

  it("decodes &#x27; to apostrophe (specifically handled)", () => {
    expect(stripHtml("it&#x27;s fine")).toBe("it's fine");
  });

  it("handles double-encoded tags", () => {
    expect(stripHtml("&lt;p&gt;Hello&lt;/p&gt;")).toBe("Hello");
  });

  it("collapses whitespace", () => {
    expect(stripHtml("Hello   \n\t  world")).toBe("Hello world");
  });

  it("trims result", () => {
    expect(stripHtml("  Hello  ")).toBe("Hello");
  });

  it("handles empty string", () => {
    expect(stripHtml("")).toBe("");
  });

  it("decodes &#x27; entity", () => {
    expect(stripHtml("it&#x27;s")).toBe("it's");
  });
});

describe("extractTag", () => {
  it("extracts simple tag content", () => {
    expect(extractTag("<title>Hello World</title>", "title")).toBe("Hello World");
  });

  it("extracts CDATA content", () => {
    expect(
      extractTag("<title><![CDATA[Hello World]]></title>", "title")
    ).toBe("Hello World");
  });

  it("returns empty string for missing tag", () => {
    expect(extractTag("<item>no title here</item>", "title")).toBe("");
  });

  it("handles tag with attributes", () => {
    expect(
      extractTag('<description type="html">Some text</description>', "description")
    ).toBe("Some text");
  });

  it("handles multiline content", () => {
    const xml = "<summary>\nLine 1\nLine 2\n</summary>";
    expect(extractTag(xml, "summary")).toBe("Line 1\nLine 2");
  });

  it("is case-insensitive", () => {
    expect(extractTag("<Title>Hello</Title>", "title")).toBe("Hello");
  });
});

describe("extractAttr", () => {
  it("extracts attribute value", () => {
    expect(
      extractAttr('<link href="https://example.com" />', "link", "href")
    ).toBe("https://example.com");
  });

  it("returns empty string for missing attribute", () => {
    expect(extractAttr("<link />", "link", "href")).toBe("");
  });

  it("returns empty string for missing tag", () => {
    expect(extractAttr("<item />", "link", "href")).toBe("");
  });

  it("handles tag with multiple attributes", () => {
    expect(
      extractAttr(
        '<link rel="alternate" type="text/html" href="https://example.com" />',
        "link",
        "href"
      )
    ).toBe("https://example.com");
  });
});
