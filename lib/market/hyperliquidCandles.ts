import type { OHLCV } from "@/types/trading";
import { HYPERLIQUID_NATIVES } from "./hyperliquid";
import { bucketStart } from "./intervals";

export interface HyperliquidCandle {
  symbol: string;
  timeframe: string;
  count: number;
  bar: OHLCV;
}

export function parseHyperliquidCandle(raw: unknown): HyperliquidCandle | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.s !== "string" || !value.s || typeof value.i !== "string") return null;
  const interval = HYPERLIQUID_NATIVES.find(item => item.api === value.i);
  if (!interval) return null;
  const number = (item: unknown) => typeof item === "number" || typeof item === "string" && item.trim() !== ""
    ? Number(item) : NaN;
  const time = number(value.t), end = number(value.T), count = number(value.n);
  const open = number(value.o), high = number(value.h), low = number(value.l), close = number(value.c), volume = number(value.v);
  if (![time, end, count, open, high, low, close, volume].every(Number.isFinite)
    || time <= 0 || !Number.isSafeInteger(time) || !Number.isSafeInteger(end) || end < time
    || bucketStart(interval.id, time) !== time || !Number.isSafeInteger(count) || count < 0
    || Math.min(open, high, low, close) <= 0 || volume < 0
    || low > Math.min(open, close) || high < Math.max(open, close) || low > high) return null;
  return { symbol: `HL:${value.s}`, timeframe: interval.id, count, bar: { time, open, high, low, close, volume } };
}

type Revision = { bar: OHLCV; count?: number };
function sameBar(a: OHLCV, b: OHLCV) {
  return a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low
    && a.close === b.close && a.volume === b.volume;
}

/** Cumulative venue snapshots replace a bucket; they are never added to trade volume. */
export class HyperliquidCandleSeries {
  private revisions = new Map<number, Revision>();

  private retain(time: number, revision: Revision) {
    this.revisions.set(time, { bar: { ...revision.bar }, count: revision.count });
    const times = [...this.revisions.keys()].sort((a, b) => b - a);
    for (const old of times.slice(4)) this.revisions.delete(old);
  }

  mergeHistory(history: readonly OHLCV[], limit: number): OHLCV[] {
    const merged = new Map(history.map(bar => [bar.time, { ...bar }]));
    // Both sources are complete venue buckets. Cumulative volume orders a
    // REST response against a stream snapshot without adding their overlap.
    for (const [time, revision] of this.revisions) {
      const baseline = merged.get(time);
      if (!baseline || revision.bar.volume >= baseline.volume) merged.set(time, { ...revision.bar });
    }
    const result = [...merged.values()].sort((a, b) => a.time - b.time).slice(-limit);
    for (const bar of result.slice(-4)) {
      const revision = this.revisions.get(bar.time);
      this.retain(bar.time, { bar, count: revision && sameBar(revision.bar, bar) ? revision.count : undefined });
    }
    return result;
  }

  accept(current: readonly OHLCV[], candle: HyperliquidCandle, limit: number): {
    bars: OHLCV[]; accepted: boolean; changed: boolean; latest: boolean; closed?: OHLCV;
  } {
    const previous = this.revisions.get(candle.bar.time);
    const last = current.at(-1);
    // Old reconnect snapshots cannot grow an unbounded historical revision map.
    const oldestRetained = [...this.revisions.keys()].sort((a, b) => a - b)[0];
    if (oldestRetained !== undefined && candle.bar.time < oldestRetained
      || previous && (candle.bar.volume < previous.bar.volume
        || previous.count !== undefined && (candle.count < previous.count
          || candle.count === previous.count && !sameBar(previous.bar, candle.bar)))) {
      return { bars: current as OHLCV[], accepted: false, changed: false, latest: false };
    }
    this.retain(candle.bar.time, { bar: candle.bar, count: candle.count });
    if (previous && sameBar(previous.bar, candle.bar)) return { bars: current as OHLCV[], accepted: true, changed: false, latest: false };
    const bars = new Map(current.map(bar => [bar.time, bar]));
    bars.set(candle.bar.time, { ...candle.bar });
    return {
      bars: [...bars.values()].sort((a, b) => a.time - b.time).slice(-limit),
      accepted: true,
      changed: true,
      latest: !last || candle.bar.time >= last.time,
      closed: last && this.revisions.has(last.time) && candle.bar.time > last.time
        ? { ...this.revisions.get(last.time)!.bar } : undefined,
    };
  }
}
