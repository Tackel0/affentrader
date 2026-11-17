import type { InputSchema } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { bucketStart, parseInterval } from "@/lib/market/intervals";
import { validTradeCount } from "@/lib/market/tradeCounts";
import { validChartColor } from "@/lib/chart/appearance";
import { ArchiveQuantities } from "./archiveQuantities";

export const BAR_STATS_ROWS = ["volume", "delta", "buy", "sell", "buyTrades", "sellTrades", "trades"] as const;
export type BarStat = typeof BAR_STATS_ROWS[number];
export const barStatLabels: Record<BarStat, string> = { volume: "Volume", delta: "Delta", buy: "Buy", sell: "Sell", buyTrades: "Buy trades", sellTrades: "Sell trades", trades: "Trades" };
export type BarStatsSettings = Record<`${BarStat}Visible`, boolean> & Record<`${BarStat}Color` | "deltaDownColor", string> & { values: "Auto" | "Off" };
export const defaultBarStats = (): BarStatsSettings => ({ volumeVisible: true, deltaVisible: true, buyVisible: true, sellVisible: true,
  buyTradesVisible: false, sellTradesVisible: false, tradesVisible: false, values: "Auto",
  volumeColor: "#2962ff", deltaColor: "#089981", deltaDownColor: "#f23645", buyColor: "#089981", sellColor: "#f23645",
  buyTradesColor: "#089981", sellTradesColor: "#f23645", tradesColor: "#787b86" });
export function resolveBarStats(values: Record<string, unknown>): BarStatsSettings {
  const result = defaultBarStats();
  for (const row of BAR_STATS_ROWS) {
    const flag = `${row}Visible` as const, color = `${row}Color` as const;
    if (values[flag] !== undefined) {
      if (typeof values[flag] !== "boolean") throw new Error(`Choose whether to display ${barStatLabels[row]}.`);
      result[flag] = values[flag];
    }
    if (values[color] !== undefined) {
      if (!validChartColor(values[color])) throw new Error(`Choose a valid ${barStatLabels[row]} color.`);
      result[color] = values[color];
    }
  }
  if (values.deltaDownColor !== undefined) {
    if (!validChartColor(values.deltaDownColor)) throw new Error("Choose a valid negative delta color.");
    result.deltaDownColor = values.deltaDownColor;
  }
  if (values.values !== undefined) {
    if (values.values !== "Auto" && values.values !== "Off") throw new Error("Choose Auto or Off for Bar Stats values.");
    result.values = values.values;
  }
  return result;
}
export const activeBarStats = (style: BarStatsSettings) => BAR_STATS_ROWS.filter(row => style[`${row}Visible`]);
export function barStatsInputs(): InputSchema[] {
  const d = defaultBarStats();
  return [
    ...BAR_STATS_ROWS.map(row => ({ key: `${row}Visible`, title: barStatLabels[row], type: "bool" as const, defval: d[`${row}Visible`], group: "Rows" })),
    ...BAR_STATS_ROWS.map(row => ({ key: `${row}Color`, title: `${barStatLabels[row]}${row === "delta" ? " up" : ""} color`, type: "color" as const, defval: d[`${row}Color`], tab: "Style" })),
    { key: "deltaDownColor", title: "Delta down color", type: "color", defval: d.deltaDownColor, tab: "Style" },
    { key: "values", title: "Values", type: "string", defval: "Auto", options: ["Auto", "Off"], tab: "Style" },
  ];
}
export interface BarStatistics {
  time: number; volume: number; delta: number; buy: number; sell: number;
  buyTrades: number | null; sellTrades: number | null; trades: number | null;
  exact: Readonly<{ volume: string; delta: string; buy: string; sell: string }>;
}
interface Bucket {
  quantities: ArchiveQuantities; total: ArchiveQuantities; buyTrades: number; sellTrades: number;
  unknownBuy: boolean; unknownSell: boolean; output?: BarStatistics;
}
/** Retain decimal sums after the live tape rolls. A missing count never changes
 * classified volume and only invalidates the affected count side and total. */
export class BarStatsAccumulator {
  private buckets = new Map<number, Bucket>();
  private seen = new Map<string, { time: number; price: number; quantity: number; side: string; count?: number }>();
  private floor = -Infinity;
  private source?: boolean;
  private cached?: readonly BarStatistics[];
  private failure?: Error;
  readonly coverage = { observations: 0, rejected: 0, unknownCounts: 0, simulated: false, first: null as number | null, last: null as number | null };
  constructor(readonly symbol: string, readonly timeframe: string, private limits = { ids: 20000, buckets: 20000 }) {
    const interval = parseInterval(timeframe);
    if (!interval || interval.unit === "T" || interval.unit === "M") throw new Error("Bar Stats requires a fixed-duration time interval; monthly and tick charts are unavailable.");
  }
  add(trades: readonly Tick[]) {
    if (this.failure) throw this.failure;
    try { this.ingest(trades); } catch (error) { this.failure = error instanceof Error ? error : new Error("Invalid Bar Stats data."); throw this.failure; }
  }
  private ingest(trades: readonly Tick[]) {
    for (const tick of [...trades].sort((a, b) => a.time - b.time)) {
      if (tick.symbol !== this.symbol || !tick.id || typeof tick.id !== "string" || !Number.isSafeInteger(tick.time) || tick.time < 0 || tick.time >= 8.64e15
        || !Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.quantity) || tick.quantity <= 0
        || !["buy", "sell"].includes(tick.side) || typeof tick.simulated !== "boolean") { this.coverage.rejected++; continue; }
      if (this.source !== undefined && this.source !== tick.simulated) {
        if (tick.time < (this.coverage.last ?? -Infinity)) { this.coverage.rejected++; continue; }
        this.buckets.clear(); this.seen.clear(); this.floor = -Infinity; this.cached = undefined;
        Object.assign(this.coverage, { observations: 0, rejected: 0, unknownCounts: 0, first: null, last: null });
      }
      this.source = tick.simulated; this.coverage.simulated = tick.simulated;
      if (tick.time < this.floor) { this.coverage.rejected++; continue; }
      const previous = this.seen.get(tick.id);
      if (previous) {
        if (previous.time !== tick.time || previous.price !== tick.price || previous.quantity !== tick.quantity || previous.side !== tick.side || previous.count !== tick.tradeCount)
          throw new Error("Conflicting Bar Stats execution IDs. Reload the source.");
        continue;
      }
      const time = bucketStart(this.timeframe, tick.time);
      if (!this.buckets.has(time) && this.buckets.size >= this.limits.buckets) throw new Error("Bar Stats exceeds 20,000 buckets. Reload with a shorter window.");
      const bucket = this.buckets.get(time) ?? { quantities: new ArchiveQuantities(), total: new ArchiveQuantities(), buyTrades: 0, sellTrades: 0, unknownBuy: false, unknownSell: false };
      bucket.quantities.add(tick); bucket.total.add({ quantity: tick.quantity, side: "buy" });
      if (validTradeCount(tick.tradeCount)) {
        if (tick.side === "buy") bucket.buyTrades += tick.tradeCount; else bucket.sellTrades += tick.tradeCount;
        if (![bucket.buyTrades, bucket.sellTrades, bucket.buyTrades + bucket.sellTrades].every(Number.isSafeInteger)) throw new Error("Bar Stats print counts exceed safe integer precision.");
      } else { if (tick.side === "buy") bucket.unknownBuy = true; else bucket.unknownSell = true; this.coverage.unknownCounts++; }
      bucket.output = undefined; this.buckets.set(time, bucket); this.cached = undefined;
      this.seen.set(tick.id, { time: tick.time, price: tick.price, quantity: tick.quantity, side: tick.side, count: tick.tradeCount });
      this.coverage.observations++; this.coverage.first = Math.min(this.coverage.first ?? tick.time, tick.time);
      this.coverage.last = Math.max(this.coverage.last ?? tick.time, tick.time);
      if (this.seen.size > this.limits.ids) {
        const times = [...this.seen.values()].map(value => value.time).sort((a, b) => a - b), floor = times[Math.floor(times.length / 2)];
        for (const [id, value] of this.seen) if (value.time < floor) this.seen.delete(id);
        if (this.seen.size > this.limits.ids) throw new Error("Bar Stats duplicate tracking is full at one timestamp.");
        this.floor = Math.max(this.floor, floor);
      }
    }
  }
  read(): readonly BarStatistics[] {
    if (this.failure) throw this.failure;
    if (!this.cached) this.cached = [...this.buckets.entries()].sort((a, b) => a[0] - b[0]).map(([time, bucket]) => {
      if (bucket.output) return bucket.output;
      const values = bucket.quantities.read(), exact = Object.freeze({ volume: bucket.total.read().buyVolume, buy: values.buyVolume, sell: values.sellVolume, delta: values.delta });
      const numeric = { volume: Number(exact.volume), buy: Number(exact.buy), sell: Number(exact.sell), delta: Number(exact.delta) };
      if (!Object.values(numeric).every(Number.isFinite)) throw new Error("Bar Stats volume exceeds supported precision.");
      return bucket.output = Object.freeze({ time, ...numeric, exact,
        buyTrades: bucket.unknownBuy ? null : bucket.buyTrades, sellTrades: bucket.unknownSell ? null : bucket.sellTrades,
        trades: bucket.unknownBuy || bucket.unknownSell ? null : bucket.buyTrades + bucket.sellTrades });
    });
    return this.cached;
  }
}
export interface BarStatCell { time: number; row: BarStat; rowIndex: number; value: number; exact: string; alpha: number; color: string }
/** The accumulator publishes stats in chronological order. Seek to the viewport
 * before calculating row maxima so panning never walks the full archive. */
export function barStatsCells(stats: readonly BarStatistics[], times: Pick<ReadonlySet<number>, "has" | "keys">, style: BarStatsSettings): BarStatCell[] {
  let first = Infinity, last = -Infinity;
  for (const time of times.keys()) { first = Math.min(first, time); last = Math.max(last, time); }
  if (first > last) return [];
  let start = 0, end = stats.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (stats[middle].time < first) start = middle + 1;
    else end = middle;
  }
  const rows = activeBarStats(style), visible: BarStatistics[] = [];
  for (let index = start; index < stats.length && stats[index].time <= last; index++) {
    if (times.has(stats[index].time)) visible.push(stats[index]);
  }
  const maxima = Object.fromEntries(rows.map(row => [row, visible.reduce((max, stat) => Math.max(max, Math.abs(stat[row] ?? 0)), 0)])) as Record<BarStat, number>;
  const cells: BarStatCell[] = [];
  for (const stat of visible) rows.forEach((row, rowIndex) => {
    const value = stat[row]; if (value === null) return;
    cells.push({ time: stat.time, row, rowIndex, value, exact: row in stat.exact ? stat.exact[row as keyof typeof stat.exact] : String(value),
      alpha: .12 + .88 * (maxima[row] > 0 ? Math.abs(value) / maxima[row] : 0),
      color: row === "delta" && value < 0 ? style.deltaDownColor : style[`${row}Color`] });
  });
  return cells;
}
