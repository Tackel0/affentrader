import type { Metadata } from "next";
import "./globals.css";
import "./tradingview.css";
import "./strategy.css";
import "./features.css";
import "./workspace-chrome.css";
export const metadata: Metadata = {
  title: "AffenTerminal — Institutional Market & Orderflow Workstation",
  description:
    "Standalone AffenTerminal trading workstation with live market data, multi-strategy setup scanner, SEC Form 4 analytics, OSINT tanker/flight map, PineTS indicators and native order flow.",
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
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
