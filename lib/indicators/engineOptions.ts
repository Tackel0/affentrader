"use client";
import type { PineWorkerOptions } from "@luxalgo/vela-pinets";
import type { ScriptingEngine, Vela } from "@luxalgo/vela";
import { marketService, normalizeTimeframe } from "@/lib/market/service";
import { footprints, priceStep } from "@/lib/orderflow/math";
import { useChartStore } from "@/stores/useChartStore";

/** Register the Pine engine before adding studies without loading it for native charts. */
export function bindPineEngine(chart: Vela): () => void {
  let engine: import("@luxalgo/vela-pinets").PineWorkerEngine | undefined;
  let closed = false;
  const lazyEngine: ScriptingEngine = {
    language: "pine",
    capabilities: { streaming: true, visibleRange: true, inputs: true, props: true },
    async prepare(source, instanceId) {
      if (closed) throw new Error("The chart was closed before Pine could start.");
      if (!engine) {
        const { PineWorkerEngine } = await import("@luxalgo/vela-pinets");
        if (closed) throw new Error("The chart was closed before Pine could start.");
        engine ??= new PineWorkerEngine(pineEngineOptions());
      }
      return engine.prepare(source, instanceId);
    },
    execute(request, handlers) {
      if (!engine || closed) throw new Error("Pine is unavailable for this chart.");
      return engine.execute(request, handlers);
    },
  };
  chart.registerEngine("pine", lazyEngine);
  return () => {
    closed = true;
    engine?.terminate();
    engine = undefined;
  };
}

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
