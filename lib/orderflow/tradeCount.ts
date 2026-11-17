import type { InputSchema, SeriesSpec } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { bucketStart, parseInterval } from "@/lib/market/intervals";
import { validTradeCount } from "@/lib/market/tradeCounts";
import { validChartColor } from "@/lib/chart/appearance";
import { DeltaPath } from "./deltaPath";
import type { DeltaCandle } from "./cvdModel";

export type CountKind = "total" | "delta" | "cumulative";
export const countTitles = { total: "Trade Count", delta: "Trade Count Delta", cumulative: "Cumulative Trade Count Delta" } as const;
export const countIds = { total: "af-trade-count", delta: "af-trade-count-delta", cumulative: "af-ctcd" } as const;
export interface CountSettings {
  anchor: "Day" | "Week" | "Month" | "All data";
  plot: "Candles" | "Line" | "Area";
  color: string; upColor: string; downColor: string; wickUpColor: string; wickDownColor: string; borderUpColor: string; borderDownColor: string;
  lineWidth: number;
}
export const defaultCount = (): CountSettings => ({ anchor: "Day", plot: "Candles", color: "#2962ff", lineWidth: 2, upColor: "#089981", downColor: "#f23645",
  wickUpColor: "#089981", wickDownColor: "#f23645", borderUpColor: "#089981", borderDownColor: "#f23645" });
const colorKeys = ["color", "upColor", "downColor", "wickUpColor", "wickDownColor", "borderUpColor", "borderDownColor"] as const;
export function resolveCount(values: Record<string, unknown>): CountSettings {
  const result = defaultCount();
  if (values.lineWidth !== undefined) {
    if (typeof values.lineWidth !== "number" || !Number.isInteger(values.lineWidth) || values.lineWidth < 1 || values.lineWidth > 6) throw new Error("Choose a trade-count line width from 1 to 6.");
    result.lineWidth = values.lineWidth;
  }
  for (const key of colorKeys) if (values[key] !== undefined) {
    if (!validChartColor(values[key])) throw new Error(`Invalid trade-count ${key}.`);
    result[key] = values[key];
  }
  if (values.anchor !== undefined) {
    if (typeof values.anchor !== "string" || !["Day", "Week", "Month", "All data"].includes(values.anchor)) throw new Error("Choose a UTC trade-count anchor.");
    result.anchor = values.anchor as CountSettings["anchor"];
  }
  if (values.plot !== undefined) {
    if (typeof values.plot !== "string" || !["Candles", "Line", "Area"].includes(values.plot)) throw new Error("Choose Candles, Line or Area.");
    result.plot = values.plot as CountSettings["plot"];
  }
  return result;
}
export function countInputs(kind: CountKind): InputSchema[] {
  const defaults = defaultCount(), labels = ["Color", "Up", "Down", "Up wick", "Down wick", "Up border", "Down border"];
  const keys = kind === "total" ? ["color"] as const : kind === "delta" ? ["upColor", "downColor"] as const : colorKeys;
  return [
    ...(kind === "cumulative" ? [
      { key: "anchor", title: "Anchor (UTC)", type: "string" as const, defval: defaults.anchor, options: ["Day", "Week", "Month", "All data"] },
      { key: "plot", title: "Style", type: "string" as const, defval: defaults.plot, options: ["Candles", "Line", "Area"], tab: "Style" },
    ] : []),
    ...keys.map(key => ({ key, title: labels[colorKeys.indexOf(key)], type: "color" as const, defval: defaults[key], tab: "Style" })),
  ];
}
interface CountBucket { time: number; anchor: number; path: DeltaPath; unknown: boolean }
const anchorAt = (time: number, anchor: CountSettings["anchor"]) => anchor === "All data" ? 0 : bucketStart(anchor === "Day" ? "1D" : anchor === "Week" ? "1W" : "1M", time);
const missing = (time: number): DeltaCandle => ({ time, open: NaN, high: NaN, low: NaN, close: NaN, volume: 0 });
/** Count evidence is explicit. Legacy/unknown aggregates poison the affected
 * bucket and cumulative anchor rather than producing a plausible fake count. */
export class TradeCountAccumulator {
  private buckets = new Map<string, CountBucket>();
  private seen = new Map<string, { time: number; side: string; count?: number }>();
  private floor = -Infinity;
  private source?: boolean;
  readonly coverage = { observations: 0, unknown: 0, rejected: 0, simulated: false, first: null as number | null, last: null as number | null };
  constructor(readonly symbol: string, readonly timeframe: string, readonly anchor: CountSettings["anchor"],
    private limits = { ids: 20000, buckets: 20000 }) {
    const interval = parseInterval(timeframe);
    if (!interval || interval.unit === "T" || interval.unit === "M") throw new Error("Trade Count requires a fixed-duration time interval; monthly and tick charts are unavailable.");
  }
  add(trades: readonly Tick[]) {
    for (const tick of [...trades].sort((a, b) => a.time - b.time)) {
      if (tick.symbol !== this.symbol || !tick.id || typeof tick.id !== "string" || !Number.isSafeInteger(tick.time) || tick.time < 0 || tick.time >= 8.64e15
        || !Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.quantity) || tick.quantity <= 0
        || !["buy", "sell"].includes(tick.side) || typeof tick.simulated !== "boolean") { this.coverage.rejected++; continue; }
      if (this.source !== undefined && this.source !== tick.simulated) {
        if (tick.time < (this.coverage.last ?? -Infinity)) { this.coverage.rejected++; continue; }
        this.buckets.clear(); this.seen.clear(); this.floor = -Infinity;
        Object.assign(this.coverage, { observations: 0, unknown: 0, rejected: 0, first: null, last: null });
      }
      this.source = tick.simulated; this.coverage.simulated = tick.simulated;
      if (tick.time < this.floor) { this.coverage.rejected++; continue; }
      const previous = this.seen.get(tick.id);
      if (previous) {
        if (previous.time !== tick.time || previous.side !== tick.side || previous.count !== tick.tradeCount)
          throw new Error("Conflicting execution counts. Reload the source before counting.");
        continue;
      }
      this.seen.set(tick.id, { time: tick.time, side: tick.side, count: tick.tradeCount });
      const time = bucketStart(this.timeframe, tick.time), anchor = anchorAt(tick.time, this.anchor), key = `${anchor}:${time}`;
      if (!this.buckets.has(key) && this.buckets.size >= this.limits.buckets) throw new Error("Trade Count exceeds 20,000 buckets. Reload with a shorter window.");
      const bucket = this.buckets.get(key) ?? { time, anchor, path: new DeltaPath(), unknown: false };
      if (validTradeCount(tick.tradeCount)) bucket.path.add({ ...tick, quantity: tick.tradeCount });
      else { bucket.unknown = true; this.coverage.unknown++; }
      this.buckets.set(key, bucket);
      this.coverage.observations++; this.coverage.first = Math.min(this.coverage.first ?? tick.time, tick.time);
      this.coverage.last = Math.max(this.coverage.last ?? tick.time, tick.time);
      if (this.seen.size > this.limits.ids) {
        const times = [...this.seen.values()].map(value => value.time).sort((a, b) => a - b), floor = times[Math.floor(times.length / 2)];
        for (const [id, value] of this.seen) if (value.time < floor) this.seen.delete(id);
        if (this.seen.size > this.limits.ids) throw new Error("Trade Count duplicate tracking is full at one timestamp.");
        this.floor = Math.max(this.floor, floor); for (const item of this.buckets.values()) item.path.sealBefore(floor);
      }
    }
  }
  candles(bars: readonly { time: number }[], kind: CountKind): DeltaCandle[] {
    const buckets = [...this.buckets.values()].sort((a, b) => a.time - b.time || a.anchor - b.anchor);
    let index = 0, cumulative = 0, anchor: number | undefined, unknown = false;
    return bars.map(bar => {
      let output = missing(bar.time);
      while (index < buckets.length && buckets[index].time <= bar.time) {
        const bucket = buckets[index++];
        if (bucket.anchor !== anchor) { anchor = bucket.anchor; cumulative = 0; unknown = false; }
        const path = bucket.path.read();
        if (![path.total, path.high, path.low, path.volume].every(Number.isSafeInteger)) throw new Error("Trade counts exceed safe integer precision.");
        const open = kind === "cumulative" ? cumulative : 0;
        if (kind === "cumulative") cumulative += path.total;
        if (!Number.isSafeInteger(cumulative) || !Number.isSafeInteger(open + path.high) || !Number.isSafeInteger(open + path.low)) throw new Error("Cumulative trade counts exceed safe integer precision.");
        if (bucket.unknown) unknown = true;
        if (bucket.time !== bar.time || bucket.unknown || kind === "cumulative" && unknown) { output = missing(bar.time); continue; }
        const value = kind === "total" ? path.volume : kind === "delta" ? path.total : cumulative;
        output = { time: bar.time, open, high: kind === "total" ? value : open + path.high, low: kind === "total" ? 0 : open + path.low, close: value, volume: path.volume };
      }
      return output;
    });
  }
}
export function countSeries(bars: DeltaCandle[], kind: CountKind, style: CountSettings): SeriesSpec[] {
  const base = { id: countIds[kind], title: countTitles[kind], paneId: "" };
  if (kind === "cumulative" && style.plot === "Candles") return [
    { ...base, kind: "candle", bars, style: { up: style.upColor, down: style.downColor, wickUp: style.wickUpColor, wickDown: style.wickDownColor,
      borderUp: style.borderUpColor, borderDown: style.borderDownColor }, display: { dataWindow: false } },
    ...(["open", "high", "low", "close"] as const).map(field => ({ id: `${base.id}-${field}`, title: `CTCD ${field}`, paneId: "", kind: "line" as const,
      display: { pane: false, priceScale: false, legend: false, dataWindow: true },
      points: bars.map(bar => ({ time: bar.time, value: Number.isFinite(bar[field]) ? bar[field] : null })), style: { color: style.color, width: 1, lineStyle: "solid" as const } })),
  ];
  return [{ ...base, kind: kind === "cumulative" ? style.plot === "Area" ? "area" : "line" : "histogram",
    points: bars.map(bar => ({ time: bar.time, value: Number.isFinite(bar.close) ? bar.close : null,
      ...(kind === "delta" ? { color: bar.close >= 0 ? style.upColor : style.downColor } : {}) })),
    style: { color: style.color, width: style.lineWidth, lineStyle: "solid", base: 0 } }];
}
export const emptyCountSeries = (bars: readonly { time: number }[], kind: CountKind, style: CountSettings) => countSeries(bars.map(bar => missing(bar.time)), kind, style);
