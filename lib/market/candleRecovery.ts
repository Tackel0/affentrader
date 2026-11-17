import type { OHLCV } from "@/types/trading";
import { bucketStart, nextBucket, parseInterval } from "./intervals";

export class RecoveryUnavailableError extends Error {}

/** Counts calendar buckets too: a month is not a fixed thirty-day duration. */
export function candleRecoveryPlan(timeframe: string, from: number, now: number, maximum = 5000) {
  const interval = parseInterval(timeframe);
  if (!interval || interval.unit === "T" || !Number.isFinite(from) || !Number.isFinite(now)
    || from <= 0 || from > now || !Number.isSafeInteger(maximum) || maximum < 2) {
    throw new Error("Invalid candle recovery window.");
  }
  const anchor = bucketStart(timeframe, from), target = bucketStart(timeframe, now);
  let cursor = anchor, count = 1;
  while (cursor < target && count < maximum) { cursor = nextBucket(timeframe, cursor); count++; }
  return { anchor, target, count: Math.min(maximum, Math.max(2, count + 1)), capped: cursor < target };
}

/** Provider bars repair their window; absent buckets are never synthesized. */
export function mergeRecoveredCandles(
  current: readonly OHLCV[], history: readonly OHLCV[], anchor: number, limit: number,
): OHLCV[] {
  if (!history.some(bar => bar.time === anchor)) {
    throw new RecoveryUnavailableError("The provider no longer covers the interrupted candle window. Reload the chart to start from available history.");
  }
  const merged = new Map(current.map(bar => [bar.time, bar]));
  for (const bar of history) merged.set(bar.time, { ...bar });
  return [...merged.values()].sort((a, b) => a.time - b.time).slice(-limit);
}
