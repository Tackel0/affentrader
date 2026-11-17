"use client";
import type { OHLCV } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import type { CellContext } from "@/lib/chart/cellContext";
import { contextForCanvas } from "@/lib/chart/cellContext";
import { marketService, stripVenue } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";
import { studyTradeSource } from "./studyTradeSource";
import { rangeExecutions } from "./executionRangeProfile";
import type { ProfileExecutionInput } from "./profileJobs";
export type RangeVolumeSource = "OHLCV estimate" | "Classified executions";
export function rangeProfileSourceStamp(symbol: string, timeframe: string) {
  const state = useChartStore.getState();
  return JSON.stringify([state.marketEpochs[symbol] ?? 0, state.dataSources[`${symbol}:${timeframe}`], state.feedMode, studyTradeSource.revision(stripVenue(symbol))]);
}
export function executionRangeSource(cell: CellContext | undefined, bars: readonly OHLCV[]): { bars: readonly OHLCV[]; execution: ProfileExecutionInput; label: string; context: string } {
  if (!cell) throw new Error("The native chart context is unavailable.");
  const state = useChartStore.getState(), symbol = stripVenue(cell.symbol), source = state.dataSources[`${cell.symbol}:${cell.timeframe}`];
  const replay = cell.replay && source === "exchange" && state.feedMode !== "simulation" ? studyTradeSource.replay(symbol, cell.replayThrough ?? null) : undefined;
  if (cell.replay && !replay) throw new Error("Replay needs an exchange candle source and a loaded execution archive at the current completed-bar boundary.");
  const observed = marketService.tradesFor(cell.symbol);
  if (!cell.replay && source !== "exchange" && source !== "simulation") throw new Error("Wait for the chart's classified trade source.");
  const real = observed.some(tick => tick.simulated) ? observed.filter(tick => !tick.simulated) : observed;
  const trades = replay ? replay.trades : source === "simulation" ? observed.some(tick => !tick.simulated) ? observed.filter(tick => tick.simulated) : observed : studyTradeSource.read(symbol, real);
  const revealed = replay ? bars.filter(bar => bar.time < replay.through) : bars;
  return { bars: revealed, execution: { trades: rangeExecutions(trades, revealed, cell.timeframe), timeframe: cell.timeframe },
    label: replay ? `REPLAY · before ${new Date(replay.through).toISOString()} · partial coverage; gaps unknown` : `${source === "simulation" ? "SIMULATED · " : ""}observed classified executions · partial coverage; gaps unknown`,
    context: JSON.stringify([cell, state.marketEpochs[cell.symbol] ?? 0, studyTradeSource.revision(symbol), source]) };
}
interface Watch { key: string; stop(): void; repaint: () => void; observe?: (tick: Tick) => void }
const watches = new Map<object, Watch>();
export function clearExecutionRangeWatch(owner: object) { watches.get(owner)?.stop(); watches.delete(owner); }
/** Bounded paint subscriptions, including executions arriving without an OHLC update.
 * Native drawings may be removed without a destroy hook, so disconnected watches
 * self-release and a64-owner LRU bounds references in rehydration-heavy sessions. */
export function watchExecutionRange(owner: object, canvas: HTMLCanvasElement | undefined, repaint: (() => void) | undefined, enabled: boolean, observe?: (tick: Tick) => void) {
  const cell = canvas && contextForCanvas(canvas);
  if (!enabled || !canvas || !repaint || !cell) { clearExecutionRangeWatch(owner); return; }
  const key = JSON.stringify([cell.id, cell.symbol, cell.timeframe, cell.replay]), previous = watches.get(owner);
  if (previous?.key === key) { previous.repaint = repaint; previous.observe = observe; watches.delete(owner); watches.set(owner, previous); return; }
  clearExecutionRangeWatch(owner); let timer: ReturnType<typeof setTimeout> | undefined, stopped = false;
  const changed = () => {
    const current = contextForCanvas(canvas);
    if (!canvas.isConnected || !current || current.id !== cell.id || current.symbol !== cell.symbol || current.timeframe !== cell.timeframe) { clearExecutionRangeWatch(owner); return; }
    if (timer === undefined) timer = setTimeout(() => { timer = undefined; if (!stopped && canvas.isConnected) watches.get(owner)?.repaint(); }, 50);
  };
  const offArchive = studyTradeSource.subscribe(stripVenue(cell.symbol), changed);
  const offTrades = marketService.onTick(tick => {
    if (stopped) return;
    const current = contextForCanvas(canvas);
    if (!canvas.isConnected || !current || current.id !== cell.id || current.symbol !== cell.symbol || current.timeframe !== cell.timeframe) { clearExecutionRangeWatch(owner); return; }
    if (tick.symbol === stripVenue(cell.symbol) && !current.replay) { watches.get(owner)?.observe?.(tick); changed(); }
  });
  const watch: Watch = { key, repaint, observe, stop() { stopped = true; offArchive(); offTrades(); if (timer !== undefined) clearTimeout(timer); } };
  watches.set(owner, watch);
  while (watches.size > 64) clearExecutionRangeWatch(watches.keys().next().value!);
}
