import { extractTag } from "./xml-helpers";

export function getDomainFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch (e) {
    console.warn("getDomainFromUrl: malformed URL", rawUrl, e);
    return "";
  }
}

export function getSourceImageUrl(link: string, sourceUrl: string): string {
  const domain = getDomainFromUrl(link) || getDomainFromUrl(sourceUrl);
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

export function extractImageUrl(block: string): string {
  // 1a. <media:content url="..."> with known image extension
  const mediaContentExt = block.match(
    /<media:content[^>]+url="([^"]+\.(jpg|jpeg|png|webp|gif)[^"]*)"/i
  );
  if (mediaContentExt) return mediaContentExt[1];

  // 1b. <media:content medium="image" url="..."> (Google News proxy URLs without extensions)
  const mediaImg = block.match(
    /<media:content[^>]+medium="image"[^>]+url="([^"]+)"/i
  );
  if (mediaImg) return mediaImg[1];
  const mediaImg2 = block.match(
    /<media:content[^>]+url="([^"]+)"[^>]+medium="image"/i
  );
  if (mediaImg2) return mediaImg2[1];

  // 1c. <media:content url="..."> any URL (fallback)
  const mediaContentAny = block.match(
    /<media:content[^>]+url="(https?:\/\/[^"]+)"/i
  );
  if (mediaContentAny) return mediaContentAny[1];

  // 2. <media:thumbnail url="...">
  const mediaThumbnail = block.match(
    /<media:thumbnail[^>]+url=["']([^"']+)["']/i
  );
  if (mediaThumbnail) return mediaThumbnail[1];

  // 3. <enclosure url="..." type="image/...">
  const enclosure = block.match(
    /<enclosure[^>]+url="([^"]+)"[^>]+type="image\/[^"]+"/i
  );
  if (enclosure) return enclosure[1];
  // Also try reversed attribute order
  const enclosure2 = block.match(
    /<enclosure[^>]+type="image\/[^"]+"[^>]+url="([^"]+)"/i
  );
  if (enclosure2) return enclosure2[1];

  // 4. <image><url>...</url></image>
  const imageTag = extractTag(block, "image");
  if (imageTag) {
    const imgUrl = extractTag(imageTag, "url");
    if (imgUrl && imgUrl.startsWith("http")) return imgUrl;
  }

  // 5. First <img src="..."> inside description/content
  const description =
    extractTag(block, "description") ||
    extractTag(block, "content:encoded") ||
    extractTag(block, "content") ||
    extractTag(block, "summary");
  const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch && imgMatch[1].startsWith("http")) return imgMatch[1];

  // 6. Escaped <img> tags in HTML-encoded descriptions
  const decodedDescription = description
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  const escapedImgMatch = decodedDescription.match(
    /<img[^>]+src=["']([^"']+)["']/i
  );
  if (escapedImgMatch && escapedImgMatch[1].startsWith("http")) {
    return escapedImgMatch[1];
  }

  return "";
}
