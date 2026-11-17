import type { OHLCV } from "@/types/trading";
import { technicalRating, type Rating } from "./rating";

export interface ChartRatingContext {
  replayActive: boolean;
  cursorTime: number | null;
  recovering: boolean;
  error: string | null;
}
export interface ChartRatingView {
  rating: Rating | null;
  status: "ready" | "recovering" | "error" | "insufficient" | "replay-waiting";
  asOf: number | null;
  replay: boolean;
}

/** Evaluate the selected chart, excluding unrevealed Replay bars and interrupted live history. */
export function chartRating(bars: readonly OHLCV[], context: ChartRatingContext): ChartRatingView {
  const empty = { rating: null, asOf: null, replay: context.replayActive };
  if (context.error) return { ...empty, status: "error" };
  if (!context.replayActive && context.recovering) return { ...empty, status: "recovering" };
  if (context.replayActive && (context.cursorTime === null || !Number.isFinite(context.cursorTime)))
    return { ...empty, status: "replay-waiting" };
  const revealed = context.replayActive ? bars.filter(bar => bar.time <= context.cursorTime!) : bars;
  const rating = technicalRating(revealed);
  return { rating, asOf: revealed.at(-1)?.time ?? null, replay: context.replayActive, status: rating ? "ready" : "insufficient" };
}
