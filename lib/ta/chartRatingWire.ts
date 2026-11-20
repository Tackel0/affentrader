import type { OHLCV } from "@/types/trading";
import type { ChartRatingContext, ChartRatingView } from "./chartRating";

export interface ChartRatingRequest {
  id: number;
  candles: Float64Array<ArrayBuffer>;
  context: ChartRatingContext;
}

export interface ChartRatingResponse {
  id: number;
  view: ChartRatingView;
}

// Transfer six doubles per bar without cloning thousands of individual objects.
export function packRatingCandles(bars: readonly OHLCV[]): Float64Array<ArrayBuffer> {
  const packed = new Float64Array(bars.length * 6);
  let offset = 0;
  for (const bar of bars) {
    packed[offset++] = bar.time;
    packed[offset++] = bar.open;
    packed[offset++] = bar.high;
    packed[offset++] = bar.low;
    packed[offset++] = bar.close;
    packed[offset++] = bar.volume;
  }
  return packed;
}

export function unpackRatingCandles(packed: Float64Array): OHLCV[] {
  const bars: OHLCV[] = [];
  for (let i = 0; i < packed.length; i += 6) {
    bars.push({
      time: packed[i], open: packed[i + 1], high: packed[i + 2],
      low: packed[i + 3], close: packed[i + 4], volume: packed[i + 5],
    });
  }
  return bars;
}
