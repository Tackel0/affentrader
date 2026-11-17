import { nextBucket } from "@/lib/market/intervals";
import { recentWindow } from "@/lib/chart/ranges";
import type { Timeframe } from "@/types/trading";

/** Horizontal room each footprint bar needs for its Bid × Ask cells. */
export const FOOTPRINT_BAR_PX = 100;
/** Width kept free for the price scale. */
const SCALE_GUTTER_PX = 90;

/** How many of the latest bars fit readably in a chart of the given width. */
export function footprintBarCount(chartWidth: number): number {
  if (!Number.isFinite(chartWidth) || chartWidth <= 0) return 8;
  return Math.max(2, Math.floor((chartWidth - SCALE_GUTTER_PX) / FOOTPRINT_BAR_PX));
}

/** Include both halves of the final footprint instead of clipping Ask at the price scale. */
export function footprintWindow(bars: readonly { time: number }[], timeframe: Timeframe, count: number, cursor?: number) {
  const range = recentWindow(bars, count, cursor);
  if (!range) return;
  return { from: range.from - (nextBucket(timeframe, range.from) - range.from) * .55,
    to: range.to + (nextBucket(timeframe, range.to) - range.to) * .65 };
}

export interface FootprintPalette {
  buyFill: string;
  sellFill: string;
  neutralFill: string;
  buyText: string;
  sellText: string;
  note: string;
}

/** Cell colours that stay legible on both the light and the dark chart background. */
export function footprintPalette(theme: "light" | "dark"): FootprintPalette {
  return theme === "dark"
    ? {
        buyFill: "#093f39e6",
        sellFill: "#502631e6",
        neutralFill: "#18232fe6",
        buyText: "#50c8ac",
        sellText: "#ed7f8b",
        note: "#bac3d5",
      }
    : {
        buyFill: "#bfeadfe6",
        sellFill: "#f6cdd3e6",
        neutralFill: "#eef1f6e6",
        buyText: "#067a66",
        sellText: "#b42f42",
        note: "#4a5568",
      };
}
