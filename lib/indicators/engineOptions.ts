"use client";
import type { PineWorkerOptions } from "@luxalgo/vela-pinets";
import { marketService, normalizeTimeframe } from "@/lib/market/service";
import { footprints, priceStep } from "@/lib/orderflow/math";
import { useChartStore } from "@/stores/useChartStore";
export function pineEngineOptions(): PineWorkerOptions {
  return {
    importResolver: (path) =>
      useChartStore.getState().pineLibraries[path] ?? null,
    footprints: async (symbol, timeframe, range) => {
      const trades = marketService
        .tradesFor(symbol)
        .filter(
          (t) =>
            (range.from === undefined || t.time >= range.from) &&
            (range.to === undefined || t.time < range.to),
        );
      return footprints(
        trades,
        normalizeTimeframe(timeframe),
        priceStep(trades[0]?.price ?? 1),
      ).map((bar) => ({
        openTime: bar.time,
        levels: bar.levels.map((level) => ({
          price: level.price,
          buyVolume: level.buyVolume,
          sellVolume: level.sellVolume,
        })),
      }));
    },
  };
}
