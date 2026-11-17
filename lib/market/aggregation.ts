import type { OHLCV, Tick, Timeframe } from "@/types/trading";
import { bucketStart, parseInterval } from "./intervals";
export function aggregateTick(
  bars: OHLCV[],
  tick: Tick,
  timeframe: Timeframe,
  limit = 20000,
): { bars: OHLCV[]; closed?: OHLCV } {
  const time = bucketStart(timeframe, tick.time);
  const last = bars.at(-1);
  if (last && time < last.time) return { bars };
  if (last?.time === time)
    return {
      bars: [
        ...bars.slice(0, -1),
        {
          ...last,
          high: Math.max(last.high, tick.price),
          low: Math.min(last.low, tick.price),
          close: tick.price,
          volume: last.volume + tick.quantity,
        },
      ],
    };
  return {
    bars: [
      ...bars.slice(-(limit - 1)),
      {
        time,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.quantity,
      },
    ],
    closed: last,
  };
}
export function aggregateBars(bars: OHLCV[], timeframe: Timeframe): OHLCV[] {
  const result: OHLCV[] = [];
  for (const bar of bars) {
    const time = bucketStart(timeframe, bar.time);
    const last = result.at(-1);
    if (last?.time === time) {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.volume += bar.volume;
    } else result.push({ ...bar, time });
  }
  return result;
}
/** Spacing, in ms, of synthetic timestamps given to tick-interval bars. */
export const TICK_BAR_SPACING = 1000;
export interface TickTrade {
  price: number;
  quantity: number;
  /** Sequential trade number (aggregate trade id) that decides the bar. */
  seq: number;
}
export interface TickBarState {
  bars: OHLCV[];
  /** Group (`floor(seq / perBar)`) of the forming bar, or null when empty. */
  group: number | null;
}
export function tickCount(timeframe: Timeframe): number {
  const interval = parseInterval(timeframe);
  return interval?.unit === "T" ? interval.value : 0;
}
/**
 * Fold one trade into tick-interval bars. Trades are grouped by
 * `floor(seq / perBar)`, so bar boundaries are fixed by the exchange trade id
 * and never depend on when history was fetched. Bars sit on a uniform
 * synthetic time grid (one `TICK_BAR_SPACING` per bar) because the axis of a
 * tick chart counts bars, not clock time.
 */
export function aggregateTickBars(
  state: TickBarState,
  trade: TickTrade & { time: number },
  perBar: number,
  limit = 20000,
): { state: TickBarState; closed?: OHLCV } {
  const group = Math.floor(trade.seq / perBar);
  const last = state.bars.at(-1);
  if (last && state.group !== null && group < state.group) return { state };
  if (last && group === state.group) {
    const bars = state.bars.slice();
    bars[bars.length - 1] = {
      ...last,
      high: Math.max(last.high, trade.price),
      low: Math.min(last.low, trade.price),
      close: trade.price,
      volume: last.volume + trade.quantity,
    };
    return { state: { bars, group } };
  }
  const time = last
    ? last.time + TICK_BAR_SPACING
    : Math.floor(trade.time / TICK_BAR_SPACING) * TICK_BAR_SPACING;
  const bar: OHLCV = {
    time,
    open: trade.price,
    high: trade.price,
    low: trade.price,
    close: trade.price,
    volume: trade.quantity,
  };
  return {
    state: { bars: [...state.bars.slice(-(limit - 1)), bar], group },
    closed: last,
  };
}
/**
 * Build tick bars from oldest-first trades, anchoring the newest bar at
 * `anchor`. The oldest group is dropped when its first trades are missing, so
 * every returned bar except the newest is complete.
 */
export function barsFromTrades(
  trades: readonly TickTrade[],
  perBar: number,
  anchor: number,
): TickBarState {
  const raw: (OHLCV & { group: number; count: number })[] = [];
  for (const trade of trades) {
    const group = Math.floor(trade.seq / perBar);
    const last = raw.at(-1);
    if (last && last.group === group) {
      last.high = Math.max(last.high, trade.price);
      last.low = Math.min(last.low, trade.price);
      last.close = trade.price;
      last.volume += trade.quantity;
      last.count++;
    } else if (!last || group > last.group) {
      raw.push({
        time: 0,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.quantity,
        group,
        count: 1,
      });
    }
  }
  if (raw.length > 1 && raw[0].count < perBar) raw.shift();
  const aligned = Math.floor(anchor / TICK_BAR_SPACING) * TICK_BAR_SPACING;
  const bars = raw.map((bar, index) => ({
    time: aligned - (raw.length - 1 - index) * TICK_BAR_SPACING,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));
  return { bars, group: raw.at(-1)?.group ?? null };
}
