import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./tradingview.css";
import "./strategy.css";
import "./features.css";
import "./workspace-chrome.css";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#131722",
};
export const metadata: Metadata = {
  title: "AffenTerminal — Institutional Market & Orderflow Workstation",
  description:
    "Standalone AffenTerminal trading workstation with live market data, multi-strategy setup scanner, SEC Form 4 analytics, OSINT tanker/flight map, PineTS indicators and native order flow.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "AffenTerminal", statusBarStyle: "black-translucent" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
