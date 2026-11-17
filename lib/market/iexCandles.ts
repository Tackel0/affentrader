import type { OHLCV } from "@/types/trading";
import { aggregateIexBars, IEX_HISTORY_LIMIT } from "./alpacaClient";
export function mergeIexSeries(previous: readonly OHLCV[], recent: readonly OHLCV[]): OHLCV[] {
  const merged = new Map(previous.map(bar => [bar.time, bar]));
  for (const bar of recent) merged.set(bar.time, bar);
  return [...merged.values()].sort((a, b) => a.time - b.time).slice(-20_000);
}
/** Authoritative minute/day replacements, never sum overlapping snapshots or manufacture empty bars. */
export class IexCandles {
  private entries = new Map<number, { bar: OHLCV; revision: number }>();
  revision = 0;
  put(bar: OHLCV) { this.entries.set(bar.time, { bar: { ...bar }, revision: ++this.revision }); this.trim(); }
  merge(bars: readonly OHLCV[]) {
    const revision = ++this.revision;
    for (const bar of bars) this.entries.set(bar.time, { bar: { ...bar }, revision });
    this.trim();
  }
  seed(bars: OHLCV[], started: number) {
    const latest = bars.at(-1)?.time ?? -Infinity, merged = new Map(bars.map(bar => [bar.time, { bar: { ...bar }, revision: started }]));
    for (const [time, entry] of this.entries) if (entry.revision > started || time > latest) merged.set(time, entry);
    this.entries = merged; this.trim();
  }
  private trim() {
    const times = [...this.entries.keys()].sort((a, b) => a - b);
    for (const time of times.slice(0, Math.max(0, times.length - IEX_HISTORY_LIMIT))) this.entries.delete(time);
  }
  bars(timeframe: string) { return aggregateIexBars([...this.entries.values()].map(entry => entry.bar).sort((a, b) => a.time - b.time), timeframe); }
}
