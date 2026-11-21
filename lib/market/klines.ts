import type { OHLCV } from "@/types/trading";
import { aggregateBars, barsFromTrades, type TickBarState } from "./aggregation";
import {
  bucketStart,
  NATIVE_INTERVALS,
  parseInterval,
  planSource,
  type NativeSpec,
} from "./intervals";

/** Deepest history a single request may assemble (TradingView Premium depth). */
export const MAX_HISTORY_BARS = 20_000;
/** Native bars one request may pull before it is refused. */
export const MAX_SOURCE_BARS = 40_000;
const PAGE = 1000;

export type Row = (string | number)[];
export type KlinePager = (params: {
  symbol: string;
  api: string;
  limit: number;
  endTime?: number;
}) => Promise<Row[]>;
export type TradePager = (params: {
  symbol: string;
  limit: number;
  fromId?: number;
  signal?: AbortSignal;
}) => Promise<TradeRow[]>;
export interface TradeRow {
  /** Aggregate trade id. */
  a: number;
  p: string;
  q: string;
  T: number;
  /** True when the buyer is the maker, i.e. the aggressor sold. */
  m: boolean;
}

export function rowsToBars(rows: Row[]): OHLCV[] {
  return rows
    .map((r) => ({
      time: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .filter(
      (b) =>
        Number.isFinite(b.time) &&
        [b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite),
    );
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]);
      }
    }),
  );
  return results;
}

export interface KlineRequest {
  symbol: string;
  timeframe: string;
  count: number;
  /** Newest open time to include; defaults to now. */
  end?: number;
  concurrency?: number;
}

/**
 * Assemble `count` bars of any valid time interval, requesting the coarsest
 * exchange interval that divides it and resampling when necessary. Pages are
 * fetched in parallel, which is what makes 20,000-bar histories practical.
 */
export async function loadKlines(
  pager: KlinePager,
  request: KlineRequest,
  natives: readonly NativeSpec[] = NATIVE_INTERVALS,
): Promise<OHLCV[]> {
  const interval = parseInterval(request.timeframe);
  const plan = planSource(request.timeframe, natives);
  if (!interval || !plan)
    throw new Error(`Interval ${request.timeframe} has no exchange source.`);
  const count = Math.max(1, Math.min(MAX_HISTORY_BARS, Math.floor(request.count)));
  // One extra bucket so the oldest resampled bar is complete.
  const wanted = (count + (plan.resample ? 1 : 0)) * plan.factor;
  if (wanted > MAX_SOURCE_BARS)
    throw new Error(
      `${request.timeframe} would need ${wanted.toLocaleString()} ${plan.nativeId} bars; reduce the depth.`,
    );
  const end = request.end ?? Date.now();
  const bars = new Map<number, OHLCV>();
  if (plan.nativeId === "1M") {
    let cursor = end;
    while (bars.size < wanted) {
      const rows = await pager({
        symbol: request.symbol,
        api: plan.api,
        limit: Math.min(PAGE, wanted - bars.size),
        endTime: cursor,
      });
      const batch = rowsToBars(rows);
      if (!batch.length) break;
      for (const bar of batch) bars.set(bar.time, bar);
      if (batch[0].time - 1 >= cursor) break;
      cursor = batch[0].time - 1;
      if (batch.length < Math.min(PAGE, wanted)) break;
    }
  } else {
    const pages = Math.ceil(wanted / PAGE);
    const ends = Array.from({ length: pages }, (_, k) => end - k * PAGE * plan.nativeMs);
    const batches = await mapLimit(ends, request.concurrency ?? 6, (endTime) =>
      pager({
        symbol: request.symbol,
        api: plan.api,
        limit: PAGE,
        endTime,
      }).then(rowsToBars),
    );
    for (const batch of batches) for (const bar of batch) bars.set(bar.time, bar);
  }
  let source = [...bars.values()]
    .filter((b) => b.time <= end)
    .sort((a, b) => a.time - b.time);
  if (!source.length) return [];
  if (!plan.resample) return source.slice(-count);
  // Drop bars before the first complete bucket so the oldest bar is whole.
  const firstBucket = bucketStart(interval.id, source[0].time);
  if (firstBucket < source[0].time)
    source = source.filter(
      (b) => bucketStart(interval.id, b.time) > firstBucket,
    );
  return aggregateBars(source, interval.id).slice(-count);
}

export interface TickHistory {
  state: TickBarState;
  /** Id of the oldest trade fetched, for paging further back. */
  oldestId: number | null;
  trades: TradeRow[];
}

/**
 * Oldest-first aggregate trades, paged backwards by id (ids are sequential, so
 * every page can be requested in parallel). Without `before` the newest
 * trades are fetched; with it, the `total` trades with ids below `before`.
 */
export async function loadTradeBackfill(
  pager: TradePager,
  symbol: string,
  total: number,
  concurrency = 6,
  before?: number,
): Promise<TradeRow[]> {
  let anchor: number;
  let newest: TradeRow[] = [];
  if (before === undefined) {
    newest = await pager({ symbol, limit: PAGE });
    if (!newest.length) return [];
    anchor = newest[0].a;
  } else anchor = before;
  const pages = Math.max(0, Math.ceil((total - newest.length) / PAGE));
  const offsets = Array.from({ length: pages }, (_, k) => k + 1);
  const older = await mapLimit(offsets, concurrency, (k) => {
    const fromId = anchor - PAGE * k;
    if (fromId + PAGE <= 0) return Promise.resolve([] as TradeRow[]);
    return pager({
      symbol,
      limit: fromId < 0 ? PAGE + fromId : PAGE,
      fromId: Math.max(0, fromId),
    });
  });
  const unique = new Map<number, TradeRow>();
  for (const page of [...older.reverse(), newest])
    for (const trade of page) if (before === undefined || trade.a < before) unique.set(trade.a, trade);
  return [...unique.values()].sort((a, b) => a.a - b.a);
}

/** Tick-interval bars (`N` trades each) from recent exchange trades. */
export async function loadTickBars(
  pager: TradePager,
  symbol: string,
  perBar: number,
  barCount: number,
  now = Date.now(),
): Promise<TickHistory> {
  const trades = await loadTradeBackfill(
    pager,
    symbol,
    Math.min(perBar * barCount, 60_000),
  );
  const state = barsFromTrades(
    trades.map((t) => ({ price: Number(t.p), quantity: Number(t.q), seq: t.a })),
    perBar,
    now,
  );
  return {
    state: { bars: state.bars.slice(-barCount), group: state.group },
    oldestId: trades[0]?.a ?? null,
    trades,
  };
}

/** True when the symbol/interval pair can be served by Binance klines. */
export function hasKlineSource(timeframe: string): boolean {
  return planSource(timeframe) !== null;
}

export const NATIVE_API_INTERVALS = NATIVE_INTERVALS.map((n) => n.api);

/** Pager that talks to this app's `/api/market` proxy. */
export const browserKlinePager: KlinePager = async ({
  symbol,
  api,
  limit,
  endTime,
}) => {
  const params = new URLSearchParams({
    resource: "klines",
    symbol,
    interval: api,
    limit: String(limit),
  });
  if (endTime) params.set("endTime", String(Math.floor(endTime)));
  const response = await fetch(`/api/market?${params}`, {
    signal: AbortSignal.timeout(16000),
  });
  if (!response.ok) throw new Error("History unavailable");
  return response.json();
};

export const browserTradePager: TradePager = async ({
  symbol,
  limit,
  fromId,
  signal,
}) => {
  const params = new URLSearchParams({
    resource: "aggTrades",
    symbol,
    limit: String(limit),
  });
  if (fromId !== undefined) params.set("fromId", String(fromId));
  const timeout = AbortSignal.timeout(16000);
  const response = await fetch(`/api/market?${params}`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error("Trade history unavailable");
  return response.json();
};
