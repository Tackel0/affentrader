import type { FootprintLevel, Tick } from "@/types/trading";
import { validTradeCount } from "@/lib/market/tradeCounts";
export function addFootprintCount(level: FootprintLevel, tick: Tick) {
  const field = tick.side === "buy" ? "buyCount" : "sellCount", volume = tick.side === "buy" ? level.buyVolume : level.sellVolume;
  const previous = level[field] === undefined && volume === 0 ? 0 : level[field];
  level[field] = validTradeCount(tick.tradeCount) && previous !== null && previous !== undefined && Number.isSafeInteger(previous + tick.tradeCount)
    ? previous + tick.tradeCount : null;
}
export function footprintSideCount(level: FootprintLevel, side: "buy" | "sell"): number | null {
  const volume = side === "buy" ? level.buyVolume : level.sellVolume, count = side === "buy" ? level.buyCount : level.sellCount;
  if (volume === 0) return 0;
  return validTradeCount(count) ? count : null;
}
