import type { OHLCV, DrawingPoint } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { nextBucket } from "@/lib/market/intervals";
import { rangeExecutions } from "./executionRangeProfile";
import { buildVolumeTails, type TailDrawing, type TailsSettings } from "./volumeTails";

/** One anchor means an open end. Two explicit endpoints include both candles;
 * optional followLatest also opens a saved two-anchor window. Replay can only
 * select completed bars, even if an anchor or its original end lies in the future. */
export function fixedTailsWindow(anchors: readonly DrawingPoint[], followLatest: boolean, bars: readonly OHLCV[], timeframe: string, through?: number) {
  if (!anchors.length) return [];
  if (anchors.length > 2 || anchors.some(a => !Number.isFinite(a.time) || !Number.isFinite(a.price))) throw new Error("Invalid Volume Tails anchors.");
  if (bars.length > 50000) throw new Error("Fixed Volume Tails exceed 50,000 loaded bars.");
  if (bars.some((b, i) => !Number.isSafeInteger(b.time) || i > 0 && b.time <= bars[i - 1].time)) throw new Error("Fixed Volume Tails need ascending unique bars.");
  const open = followLatest || anchors.length === 1, from = open ? Math.min(...anchors.map(a => a.time)) : Math.min(anchors[0].time, anchors[1].time);
  const to = open ? Infinity : Math.max(anchors[0].time, anchors[1].time);
  return bars.filter(b => b.time >= from && b.time <= to && (through === undefined || nextBucket(timeframe, b.time) <= through));
}
export class FixedTailsCache {
  private key = ""; private trades?: readonly Tick[]; private result: TailDrawing | null = null;
  read(anchors: readonly DrawingPoint[], followLatest: boolean, bars: readonly OHLCV[], timeframe: string, trades: readonly Tick[], style: TailsSettings, symbol: string, context: string, through?: number) {
    const selected = fixedTailsWindow(anchors, followLatest, bars, timeframe, through);
    const key = JSON.stringify([anchors, followLatest, selected.map(b => b.time), timeframe, style, symbol, context, through]);
    if (key === this.key && this.trades === trades) return this.result;
    const executions = rangeExecutions(trades, selected, timeframe);
    if (executions.some(t => t.symbol !== symbol)) throw new Error("Fixed Volume Tails cannot combine markets.");
    const tails = buildVolumeTails(executions, style);
    this.result = tails && selected.length ? { ...tails, start: selected[0].time, end: nextBucket(timeframe, selected.at(-1)!.time) } : null;
    this.key = key; this.trades = trades; return this.result;
  }
}
