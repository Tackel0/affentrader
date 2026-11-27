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
  interactiveWidget: "resizes-content",
  themeColor: "#000000",
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
const THEME_BOOT_SCRIPT = `(function(){try{var c=document.cookie.split(";").map(function(s){return s.trim()}).find(function(s){return s.indexOf("affentrader-workspace-profile=")===0});var p=c?c.slice(30):"";var prof=/^[a-f0-9]{32}$/.test(p)?"affentrader-profile-"+p+":":"";var base=prof+"affentrader-premium-v1";var qs=new URLSearchParams(location.search).get("window");var win=qs&&/^[a-z0-9]{4,24}$/.test(qs)?qs:(location.pathname==="/terminal"||location.pathname.indexOf("/terminal/")===0?"affen-terminal":"");var raw=(win&&localStorage.getItem(base+"@"+win))||localStorage.getItem(base)||localStorage.getItem("affentrader-premium-v1");var parsed=raw?JSON.parse(raw):null;var t=parsed&&parsed.state&&parsed.state.theme==="dark"?"dark":"light";var el=document.documentElement;el.dataset.theme=t;el.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?"#000000":"#ffffff");}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
