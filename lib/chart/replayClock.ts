import type { NativeIndicatorContext, ReplayState, Vela } from "@luxalgo/vela";
import { nextBucket, parseInterval } from "@/lib/market/intervals";
/** Exclusive execution boundary. Forming intrabar candles reveal no classified executions. */
export function completedReplayBoundary(state: Pick<ReplayState, "active" | "cursorTime" | "nextTime">, timeframe: string): number | null {
  const interval = parseInterval(timeframe), cursor = state.cursorTime;
  if (!state.active || !interval || interval.unit === "T" || cursor === null || !Number.isSafeInteger(cursor) || cursor < 0 || state.nextTime !== null && (!Number.isSafeInteger(state.nextTime) || state.nextTime < cursor)) return null;
  const boundary = state.nextTime === cursor ? cursor : nextBucket(timeframe, cursor);
  return Number.isSafeInteger(boundary) && boundary < 8.64e15 ? boundary : null;
}
type ClockChart = Pick<Vela, "data" | "replay" | "market">;
const clocks = new WeakMap<object, ClockChart>();
/** SDK NativeIndicatorContext.data is the owning chart's public DataControl identity. */
export function bindReplayClock(chart: ClockChart): () => void {
  clocks.set(chart.data, chart);
  return () => { if (clocks.get(chart.data) === chart) clocks.delete(chart.data); };
}
export function nativeReplayBoundary(context: Pick<NativeIndicatorContext, "data" | "symbol" | "timeframe" | "bars">): number | null {
  const chart = context.data && clocks.get(context.data);
  if (!chart || chart.market.symbol !== context.symbol || chart.market.timeframe !== context.timeframe) return null;
  const last = context.bars().at(-1)?.time, state = chart.replay.state;
  if (last === undefined || state.cursorTime !== last) return null;
  return completedReplayBoundary(state, context.timeframe);
}
