import type { MetadataRoute } from "next";

const shortcutIcon = { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" };

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AffenTerminal",
    short_name: "AffenTerminal",
    description: "Charting workspace with alerts, screeners and paper trading.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#131722",
    theme_color: "#131722",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Terminal", url: "/terminal", icons: [shortcutIcon] },
      { name: "Watchlist", url: "/?panel=watchlist", icons: [shortcutIcon] },
      { name: "Alerts", url: "/?panel=alerts", icons: [shortcutIcon] },
    ],
  };
}
