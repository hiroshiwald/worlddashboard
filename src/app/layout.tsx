import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "World Dashboard - Live Sources Feed",
  description:
    "Live intelligence dashboard tracking 100+ global data sources across conflict, cyber threats, economic data, and more.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-mono">{children}</body>
    </html>
  );
}
