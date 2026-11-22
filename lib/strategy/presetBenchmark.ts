"use client";

import { STRATEGY_EXAMPLES } from "./scripts";
import { loadStrategyDataset } from "./data";
import { loadMagnifierDataset } from "./magnifier";
import type { Timeframe } from "@/types/trading";
import type { StrategyDataset, StrategyReport, StrategySettings, StrategyWorkerResponse } from "@/types/strategy";

export interface PresetBenchmarkResult {
  reports: (Pick<StrategyReport, "name" | "market" | "source" | "firstTime" | "lastTime" | "netProfit" | "initialCapital" | "maxDrawdownPercent"> & { closedTrades: number })[];
  failures: string[];
}
function runPreset(name: string, source: string, dataset: StrategyDataset, settings: StrategySettings, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<StrategyReport>((resolve, reject) => {
    const id = crypto.randomUUID();
    const worker = new Worker(new URL("../../workers/strategy.worker.ts", import.meta.url));
    const teardown = () => { worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = () => { teardown(); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => { teardown(); reject(new Error("Strategy worker failed.")); };
    worker.onmessage = ({ data }: MessageEvent<StrategyWorkerResponse>) => {
      if (data.id !== id) return;
      if (data.type === "result") { teardown(); resolve(data.report); }
      if (data.type === "error" || data.type === "fetch") {
        teardown();
        reject(new Error(data.type === "error" ? data.message : "Preset requires another data series."));
      }
    };
    try { worker.postMessage({ type: "run", request: { id, document: { name, source, inputs: {}, settings }, dataset, libraries: {} } }); }
    catch (error) { teardown(); reject(error); }
  });
}

export async function benchmarkPresets(symbol: string, timeframe: Timeframe, settings: StrategySettings, signal: AbortSignal, onProgress: (value: string) => void): Promise<PresetBenchmarkResult> {
  let dataset = await loadStrategyDataset(symbol, timeframe, settings, signal, onProgress);
  if (settings.useBarMagnifier) dataset = await loadMagnifierDataset(dataset, settings, signal, onProgress);
  const result: PresetBenchmarkResult = { reports: [], failures: [] };
  const presets = Object.entries(STRATEGY_EXAMPLES);
  for (const [index, [name, source]] of presets.entries()) {
    signal.throwIfAborted();
    onProgress(`${index + 1}/${presets.length} · ${name}`);
    try {
      const { market, source: dataSource, firstTime, lastTime, netProfit, initialCapital, maxDrawdownPercent, trades } =
        await runPreset(name, source, dataset, settings, signal);
      result.reports.push({ name, market, source: dataSource, firstTime, lastTime, netProfit, initialCapital, maxDrawdownPercent,
        closedTrades: trades.filter(trade => !trade.open).length });
    } catch { signal.throwIfAborted(); result.failures.push(name); }
  }
  return result;
}
