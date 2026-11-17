import type { OHLCV, Tick } from "@/types/trading";
import { intervalMs } from "@/lib/market/intervals";
import { validTradeCount } from "@/lib/market/tradeCounts";
import { isArchivableTrade } from "./tradeArchive";
import { executionPriceGrid } from "./priceGrid";
import type { TpoSession } from "./tpoModel";
import type { TpoPreferences } from "./tpoSettings";

export type TpoColorBy = "Time" | "Volume" | "Trades count" | "Delta";
export const TPO_COLOR_MODES: TpoColorBy[] = ["Time", "Volume", "Trades count", "Delta"];
export const validTpoColorBy = (v: unknown): v is TpoColorBy => TPO_COLOR_MODES.includes(v as TpoColorBy);
export interface TpoMetricValue { buy: number; sell: number; count?: number; executions: number }
export interface TpoSessionMetrics {
  rows: Array<TpoMetricValue | undefined>;
  cells: Array<Map<number, TpoMetricValue>>;
  countsKnown: boolean;
  maximum: { volume: number; trades: number; delta: number };
}
export interface TpoMetrics { sessions: ReadonlyMap<number, TpoSessionMetrics>; message: string }
const empty = (): TpoMetricValue => ({ buy: 0, sell: 0, count: 0, executions: 0 });
const add = (value: TpoMetricValue, tick: Tick) => {
  value[tick.side === "buy" ? "buy" : "sell"] += tick.quantity; value.executions++;
  value.count = value.count !== undefined && validTradeCount(tick.tradeCount) ? value.count + tick.tradeCount : undefined;
  if (![value.buy, value.sell, value.buy + value.sell].every(Number.isFinite) || value.count !== undefined && !Number.isSafeInteger(value.count))
    throw new Error("TPO execution totals exceed supported precision.");
};
/** Collected/archived executions only. No OHLCV distribution, tick-rule side
 * guesses or one-message-as-one-print fallback enter the metric model. */
function buildTpoMetrics(trades: readonly Tick[], sessions: readonly TpoSession[], style: TpoPreferences,
  bars: readonly Pick<OHLCV, "time">[], timeframe: string, through = Infinity): TpoMetrics {
  const result = new Map<number, TpoSessionMetrics>(), duration = intervalMs(timeframe), block = Number(style.blockMinutes) * 60000;
  const prepared = sessions.map(session => ({ session, grid: executionPriceGrid(session.step), first: executionPriceGrid(session.step).index(session.rows[0].price) }));
  for (const tick of trades) {
    if (tick.time >= through) continue;
    let lo = 0, hi = bars.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].time <= tick.time) lo = mid + 1; else hi = mid; }
    if (!lo || tick.time >= bars[lo - 1].time + duration) continue;
    lo = 0; hi = prepared.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (prepared[mid].session.start <= tick.time) lo = mid + 1; else hi = mid; }
    const entry = prepared[lo - 1]; if (!entry || tick.time >= entry.session.end) continue;
    const { session, grid, first } = entry;
    const span = session.periodSpans?.find(span => tick.time >= span.start && tick.time < span.end);
    if (session.periodSpans && !span) continue;
    const period = span ? span.first + Math.floor((tick.time - span.start) / block) : Math.floor((tick.time - session.start) / block);
    const row = grid.index(tick.price) - first;
    // Only the loaded candle's actual price/period cells can be colored.
    if (!session.rows[row]?.periodIndices.includes(period)) continue;
    let metrics = result.get(session.start);
    if (!metrics) { metrics = { rows: Array(session.rows.length), cells: session.rows.map(() => new Map()), countsKnown: true, maximum: { volume: 0, trades: 0, delta: 0 } }; result.set(session.start, metrics); }
    const cell = metrics.cells[row].get(period) ?? empty(); add(cell, tick); metrics.cells[row].set(period, cell);
    const total = metrics.rows[row] ?? empty(); add(total, tick); metrics.rows[row] = total;
    if (total.count === undefined) metrics.countsKnown = false;
  }
  for (const metrics of result.values()) for (const row of metrics.rows) if (row) {
    metrics.maximum.volume = Math.max(metrics.maximum.volume, row.buy + row.sell);
    metrics.maximum.trades = Math.max(metrics.maximum.trades, row.count ?? 0);
    metrics.maximum.delta = Math.max(metrics.maximum.delta, Math.abs(row.buy - row.sell));
  }
  return { sessions: result, message: result.size ? "Observed classified executions only; partial coverage, gaps unknown. Unobserved rows use Time coloring." : "Time coloring: no classified executions in the revealed candles." };
}

/** Surface-owned retention survives the market service's small rolling tape.
 * Source keys fence symbols, feed/archive epochs and revealed Replay prefixes. */
export class TpoMetricCollection {
  private trades = new Map<string, Tick>();
  private failure?: string;
  private revision = 0;
  private cached?: { sessions: readonly TpoSession[]; bars: readonly Pick<OHLCV, "time">[]; block: string; timeframe: string; through: number; revision: number; value: TpoMetrics };
  constructor(readonly symbol: string, private maximum = 100000) {}
  add(trades: readonly Tick[]) {
    if (this.failure) return;
    for (const tick of trades) {
      if (tick.symbol !== this.symbol || !isArchivableTrade(tick)) continue;
      const previous = this.trades.get(tick.id);
      if (previous) {
        if (["time", "price", "quantity", "side", "seq"].some(key => previous[key as keyof Tick] !== tick[key as keyof Tick]) ||
          previous.tradeCount !== undefined && tick.tradeCount !== undefined && previous.tradeCount !== tick.tradeCount) {
          this.failure = "Time coloring: conflicting classified execution ID; reload the source."; break;
        }
        if (previous.tradeCount !== undefined || tick.tradeCount === undefined) continue;
      } else if (this.trades.size >= this.maximum) { this.failure = "Time coloring: TPO exceeds 100,000 retained executions; reload or select a shorter archive."; break; }
      this.trades.set(tick.id, { ...tick }); this.revision++;
    }
  }
  read(sessions: readonly TpoSession[], style: TpoPreferences, bars: readonly Pick<OHLCV, "time">[], timeframe: string, through = Infinity): TpoMetrics {
    if (this.failure) return { sessions: new Map(), message: this.failure };
    const old = this.cached;
    if (old && old.sessions === sessions && old.bars === bars && old.block === style.blockMinutes && old.timeframe === timeframe && old.through === through && old.revision === this.revision) return old.value;
    let value: TpoMetrics;
    try { value = buildTpoMetrics([...this.trades.values()], sessions, style, bars, timeframe, through); }
    catch (error) { value = { sessions: new Map(), message: `Time coloring: ${error instanceof Error ? error.message : "Invalid classified executions."}` }; }
    this.cached = { sessions, bars, block: style.blockMinutes, timeframe, through, revision: this.revision, value }; return value;
  }
}
