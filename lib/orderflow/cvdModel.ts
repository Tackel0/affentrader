import type { Tick } from "@/types/trading";
import { bucketStart, isTickInterval, parseInterval } from "@/lib/market/intervals";
import { sessionCalendar } from "./sessionCalendar";
import type { CvdPreferences } from "./cvdSettings";
import { DeltaPath } from "./deltaPath";
import { AverageDeltaPath } from "./averageDeltaPath";
import { validTradeCount } from "@/lib/market/tradeCounts";

interface DeltaBucket { time: number; session: number; path: DeltaPath; average: AverageDeltaPath }
export interface DeltaCandle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface CvdCoverage { source: "exchange" | "simulation"; first: number | null; last: number | null; trades: number; rejected: number; unknownCounts: number; aggregates: number }
/** Keeps aggregated quantities after the service's rolling trade buffer expires.
 * Old IDs are compacted by timestamp; deliveries older than that exact watermark
 * are rejected rather than risking counting an expired duplicate again. */
export class CvdAccumulator {
  private buckets = new Map<string, DeltaBucket>();
  private seen = new Map<string, number>();
  private floor = -Infinity;
  private calendar: ReturnType<typeof sessionCalendar>;
  readonly coverage: CvdCoverage = { source: "exchange", first: null, last: null, trades: 0, rejected: 0, unknownCounts: 0, aggregates: 0 };
  constructor(readonly timeframe: string, readonly style: CvdPreferences, readonly symbol: string,
    private limits = { ids: 20000, buckets: 20000 }) {
    if (!parseInterval(timeframe) || isTickInterval(timeframe) || parseInterval(timeframe)?.unit === "M") throw new Error("CVD requires a fixed time interval; monthly and tick charts are unavailable.");
    this.calendar = sessionCalendar(style, symbol);
  }
  private compactIds(): void {
    if (this.seen.size <= this.limits.ids) return;
    const times = [...this.seen.values()].sort((a, b) => a - b), cutoff = times[Math.floor(times.length / 2)];
    for (const [id, time] of this.seen) if (time < cutoff) this.seen.delete(id);
    if (this.seen.size > this.limits.ids) throw new Error("CVD duplicate tracking exceeded capacity in one timestamp. Remove and re-add CVD to restart collection.");
    this.floor = Math.max(this.floor, cutoff);
    for (const bucket of this.buckets.values()) { bucket.path.sealBefore(this.floor); bucket.average.sealBefore(this.floor); }
  }
  private window(time: number): { start: number } | null {
    const anchor = this.style.anchor;
    if (anchor === "Session") return this.calendar.at(time);
    if (anchor === "Collection" || anchor === "All data") return { start: 0 };
    return { start: bucketStart(anchor === "Day" ? "1D" : anchor === "Week" ? "1W" : "1M", time) };
  }
  add(trades: readonly Tick[]): void {
    const valid = trades.filter(trade => trade.symbol === this.symbol && typeof trade.id === "string" && trade.id.length > 0 && Number.isFinite(trade.time) && Math.abs(trade.time) < 8640000000000000 &&
      Number.isFinite(trade.quantity) && trade.quantity > 0 && (trade.side === "buy" || trade.side === "sell") && typeof trade.simulated === "boolean").sort((a, b) => a.time - b.time);
    this.coverage.rejected += trades.length - valid.length;
    for (const trade of valid) {
      const source = trade.simulated ? "simulation" : "exchange";
      if (source !== this.coverage.source) {
        if (this.coverage.last !== null && trade.time < this.coverage.last) { this.coverage.rejected++; continue; }
        this.buckets.clear(); this.seen.clear(); this.floor = -Infinity;
        Object.assign(this.coverage, { source, first: null, last: null, trades: 0, rejected: 0, unknownCounts: 0, aggregates: 0 });
      }
      if (trade.time < this.floor) { this.coverage.rejected++; continue; }
      if (this.seen.has(trade.id)) continue;
      this.seen.set(trade.id, trade.time);
      const window = this.window(trade.time);
      if (!window) { this.compactIds(); continue; }
      const time = bucketStart(this.timeframe, trade.time), key = `${window.start}:${time}`;
      const bucket = this.buckets.get(key) ?? { time, session: window.start, path: new DeltaPath(), average: new AverageDeltaPath() };
      if (!this.buckets.has(key) && this.buckets.size >= this.limits.buckets) throw new Error("CVD exceeds 20,000 aggregated bars. Remove and re-add CVD to restart collection.");
      bucket.path.add(trade); bucket.average.add(trade); this.buckets.set(key, bucket);
      if (!validTradeCount(trade.tradeCount)) this.coverage.unknownCounts++;
      else if (trade.tradeCount > 1) this.coverage.aggregates++;
      this.coverage.first = Math.min(this.coverage.first ?? trade.time, trade.time);
      this.coverage.last = Math.max(this.coverage.last ?? trade.time, trade.time); this.coverage.trades++;
      // Include this accepted execution before sealing: a late delivery can itself
      // move the ID watermark beyond its timestamp.
      this.compactIds();
    }
  }
  points(bars: readonly { time: number }[], calculation: CvdPreferences["calculation"]) {
    return this.candles(bars, calculation).map(bar => ({ time: bar.time, value: Number.isFinite(bar.close) ? bar.close : null }));
  }
  candles(bars: readonly { time: number }[], calculation: CvdPreferences["calculation"], mode: CvdPreferences["mode"] = this.style.mode): DeltaCandle[] {
    const buckets = [...this.buckets.values()].sort((a, b) => a.time - b.time || a.session - b.session);
    let index = 0, cumulative = 0, current: DeltaBucket | undefined, unknown = false;
    return bars.map(bar => {
      let candle: DeltaCandle | undefined;
      while (index < buckets.length && buckets[index].time <= bar.time) {
        const bucket = buckets[index++];
        if (!current || current.session !== bucket.session) { cumulative = 0; unknown = false; }
        const path = mode === "Average" ? bucket.average.read() : bucket.path.read(), open = calculation === "Bar delta" ? 0 : cumulative;
        if (mode === "Average" && !(path as ReturnType<AverageDeltaPath["read"]>).known) unknown = true;
        if (mode === "Average" && (calculation === "Cumulative delta" ? unknown : !Number.isFinite(path.total))) {
          candle = undefined; current = bucket; continue;
        }
        candle = { time: bar.time, open, high: open + path.high, low: open + path.low, close: open + path.total, volume: path.volume };
        if (calculation === "Cumulative delta") cumulative += path.total;
        if (![cumulative, candle.high, candle.low, candle.close].every(Number.isFinite)) throw new Error("CVD cumulative quantity exceeds supported precision.");
        current = bucket;
      }
      const missing = { time: bar.time, open: NaN, high: NaN, low: NaN, close: NaN, volume: 0 };
      if (!current) return missing;
      // A session can start inside a chart bar. An observed segment takes precedence;
      // empty later bars are carried only within the same calendar session.
      const session = current.time === bar.time ? current.session : this.window(bar.time)?.start;
      if (session !== current.session) return missing;
      if (mode === "Average" && unknown && calculation === "Cumulative delta") return missing;
      if (current.time === bar.time && candle) return candle;
      if (current.time === bar.time || !["Session", "Collection"].includes(this.style.anchor)) return missing;
      const value = calculation === "Bar delta" ? 0 : cumulative;
      return { time: bar.time, open: value, high: value, low: value, close: value, volume: 0 };
    });
  }
}
