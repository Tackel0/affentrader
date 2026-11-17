import type { Tick } from "@/types/trading";
import type { OHLCV } from "@luxalgo/vela";
import { nextBucket, parseInterval } from "@/lib/market/intervals";
import type { FixedProfileOptions, FixedProfileResult } from "./fixedProfileModel";
import { MAX_DEVELOPING_BARS, MAX_FIXED_BARS } from "./fixedProfileModel";
import { ExecutionRangeTree } from "./executionRangeTree";


export const MAX_RANGE_EXECUTIONS = 100_000;
export const executionFields = ["id", "symbol", "time", "price", "quantity", "side", "simulated", "seq"] as const;
export const sameExecutions = (a: readonly Tick[], b: readonly Tick[]) => a.length === b.length && a.every((tick, index) => executionFields.every(field => Object.is(tick[field], b[index][field])));
const copies = new WeakMap<Tick, Tick>();
export const copyExecutions = (trades: readonly Tick[]): Tick[] => trades.map(tick => {
  const saved = copies.get(tick); if (saved && executionFields.every(field => Object.is(saved[field], tick[field]))) return saved;
  const { id, symbol, time, price, quantity, side, simulated, seq } = tick;
  const copy = Object.freeze({ id, symbol, time, price, quantity, side, simulated, ...(seq === undefined ? {} : { seq }) }); copies.set(tick, copy); copies.set(copy, copy); return copy;
});
/** Both range endpoints are chart candle openings; the last selected candle is included. */
export function rangeExecutions(trades: readonly Tick[], bars: readonly { time: number }[], timeframe: string): Tick[] {
  const interval = parseInterval(timeframe);
  if (!interval || interval.unit === "T") throw new Error("Execution range profiles require a time interval.");
  if (!bars.length) return [];
  if (trades.length > MAX_RANGE_EXECUTIONS || trades.some(tick => !Number.isSafeInteger(tick.time))) throw new Error("Execution range input exceeds 100,000 observations or contains invalid times.");
  if (bars.some((bar, index) => !Number.isSafeInteger(bar.time) || Math.abs(bar.time) >= 8.64e15 || index > 0 && bar.time <= bars[index - 1].time)) throw new Error("Range profile candles must have unique ascending timestamps.");
  const from = bars[0].time, to = nextBucket(timeframe, bars.at(-1)!.time);
  if (!Number.isSafeInteger(to) || Math.abs(to) >= 8.64e15) throw new Error("Execution range boundary exceeds the supported calendar.");
  const selected = trades.filter(tick => tick.time >= from && tick.time < to);
  if (selected.length > MAX_RANGE_EXECUTIONS) throw new Error("Execution range profile exceeds 100,000 observations. Shorten the range.");
  const ids = new Map<string, Tick>(); let simulated: boolean | undefined, symbol: string | undefined;
  for (const tick of selected) {
    if (!tick.id || !tick.symbol || !Number.isSafeInteger(tick.time) || !Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.quantity) || tick.quantity <= 0 || !["buy", "sell"].includes(tick.side) || typeof tick.simulated !== "boolean" || tick.seq !== undefined && (!Number.isSafeInteger(tick.seq) || tick.seq < 0)) throw new Error("Invalid classified execution in range profile.");
    if (simulated !== undefined && simulated !== tick.simulated || symbol !== undefined && symbol !== tick.symbol) throw new Error("Range profiles cannot combine different markets or real/simulated sources.");
    simulated = tick.simulated; symbol = tick.symbol;
    const previous = ids.get(tick.id);
    if (previous && !executionFields.every(field => Object.is(previous[field], tick[field]))) throw new Error("Conflicting execution IDs in range profile.");
    if (!previous) ids.set(tick.id, tick);
  }
  return [...ids.values()].sort((a, b) => a.time - b.time || (a.seq ?? Number.MAX_VALUE) - (b.seq ?? Number.MAX_VALUE) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** Real aggressor quantities are placed once, at the observed execution price.
 * Every developing point uses only that candle's observed prefix and its own grid. */
export class ExecutionRangeProfileCache {
  private bars: number[] = []; private trades: Tick[] = []; private signature = ""; private result: FixedProfileResult | null = null;
  read(bars: readonly OHLCV[], options: FixedProfileOptions, input: readonly Tick[], timeframe: string): FixedProfileResult | null {
    if (bars.length > MAX_FIXED_BARS) throw new Error("Execution range profile exceeds 50,000 candles. Shorten the range.");
    if (options.developing && bars.length > MAX_DEVELOPING_BARS) throw new Error("Developing execution profiles exceed 5,000 candles. Shorten the range or disable Developing POC/VA.");
    if (!Number.isInteger(options.rows) || options.rows < 1 || options.rows > 500 || !Number.isFinite(options.valueAreaPct) || options.valueAreaPct < 0 || options.valueAreaPct > 100) throw new Error("Range profile requires Rows 1–500 and Value Area 0–100.");
    const trades = rangeExecutions(input, bars, timeframe), signature = JSON.stringify([options, timeframe]);
    if (signature === this.signature && bars.length === this.bars.length && bars.every((bar, index) => bar.time === this.bars[index]) && sameExecutions(trades, this.trades)) return this.result;
    const developingPoc: FixedProfileResult["developingPoc"] = [], developingVaHigh: FixedProfileResult["developingVaHigh"] = [], developingVaLow: FixedProfileResult["developingVaLow"] = [];
    const tree = new ExecutionRangeTree(trades);
    if (options.developing) {
      let count = 0;
      for (const bar of bars) {
        const end = nextBucket(timeframe, bar.time); while (count < trades.length && trades[count].time < end) tree.add(trades[count++]);
        const current = tree.profile(options.rows, options.valueAreaPct); if (!current) continue;
        developingPoc.push({ time: bar.time, price: current.centers[current.poc] });
        developingVaHigh.push({ time: bar.time, price: current.edges[current.vaTo + 1] }); developingVaLow.push({ time: bar.time, price: current.edges[current.vaFrom] });
      }
    }
    if (!options.developing) for (const tick of trades) tree.add(tick);
    const output = tree.profile(options.rows, options.valueAreaPct);
    const { buys, sells, total, delta } = tree.totals;
    this.result = output ? { profile: output, developingPoc, developingVaHigh, developingVaLow, bars: bars.length, rejected: 0, total,
      executions: trades.length, buys, sells, delta, firstTrade: trades[0].time, lastTrade: trades.at(-1)!.time, simulated: trades[0].simulated } : null;
    this.bars = bars.map(bar => bar.time); this.trades = copyExecutions(trades); this.signature = signature;
    return this.result;
  }
}
