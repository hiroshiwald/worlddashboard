"use client";

interface FeedItemImageProps {
  imageUrl: string;
  link: string;
  sourceName: string;
  dark: boolean;
  size: "desktop" | "mobile";
  imgPlaceholder: string;
}

function fallbackSourceImage(link: string): string {
  try {
    const domain = new URL(link).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  } catch {
    return "";
  }
}

export default function FeedItemImage({
  imageUrl,
  link,
  sourceName,
  dark,
  size,
  imgPlaceholder,
}: FeedItemImageProps) {
  const dimensions =
    size === "desktop"
      ? "w-[74px] h-[50px]"
      : "w-16 h-[46px]";
  const fontSize = size === "desktop" ? "text-lg" : "text-base";

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={`${dimensions} object-cover shrink-0 mt-0.5 rounded-lg ${imgPlaceholder}`}
        loading="lazy"
        onError={(e) => {
          const img = e.currentTarget;
          const sourceFallback = fallbackSourceImage(link);
          if (sourceFallback && img.src !== sourceFallback) {
            img.src = sourceFallback;
            return;
          }
          img.style.display = "none";
        }}
      />
    );
  }

  return (
    <div
      className={`${dimensions} shrink-0 mt-0.5 flex items-center justify-center ${fontSize} font-semibold ${
        dark ? "text-slate-500" : "text-gray-400"
      } ${imgPlaceholder}`}
    >
      {sourceName.charAt(0)}
    </div>
  );
}
