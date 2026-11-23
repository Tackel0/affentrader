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
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      {
        src: "/screenshots/workspace-phone.png",
        sizes: "780x1688",
        type: "image/png",
        form_factor: "narrow",
        label: "AffenTerminal chart on a phone",
      },
      {
        src: "/screenshots/workspace-tablet.png",
        sizes: "1180x820",
        type: "image/png",
        form_factor: "wide",
        label: "AffenTerminal chart on a landscape tablet",
      },
    ],
    shortcuts: [
      { name: "Terminal", url: "/terminal", icons: [shortcutIcon] },
      { name: "Watchlist", url: "/?panel=watchlist", icons: [shortcutIcon] },
      { name: "Alerts", url: "/?panel=alerts", icons: [shortcutIcon] },
    ],
  };
}
