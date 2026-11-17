import type { OHLCV } from "@/types/trading";
import { aggregateBars } from "./aggregation";
import { bucketStart, parseInterval, planSource } from "./intervals";
import {
  adjustForDividends,
  windowFor,
  YAHOO_NATIVES,
  type YahooEvents,
  type YahooMeta,
  type YahooQuote,
  type YahooSearchHit,
} from "./yahoo";

export interface YahooLoad {
  bars: OHLCV[];
  meta: YahooMeta | null;
  events: YahooEvents;
}

export interface YahooLoadRequest {
  ticker: string;
  timeframe: string;
  count: number;
  end?: number;
  /** Earliest required source time, avoiding density-based overfetch for an explicit window. */
  start?: number;
  /** Include pre- and post-market bars (intraday only). */
  extended: boolean;
  /** Fold dividends into daily and coarser prices. */
  adjustDividends: boolean;
  /** Keep actual provider bar timestamps for Pine time/date logic in backtests. */
  preserveSessionTimes?: boolean;
  fetcher?: typeof fetch;
  concurrency?: number;
  /** Replaces the HTTP chart loader, so the server can read Yahoo without calling itself. */
  chartLoader?: (
    ticker: string,
    api: string,
    period1: number,
    period2: number,
    extended: boolean,
  ) => Promise<ChartPayload>;
}

export interface ChartPayload {
  meta: YahooMeta;
  rows: number[][];
  adj: (number | null)[];
  events: YahooEvents;
  error?: string;
}

async function chart(
  fetcher: typeof fetch,
  ticker: string,
  api: string,
  period1: number,
  period2: number,
  extended: boolean,
): Promise<ChartPayload> {
  const params = new URLSearchParams({
    kind: "chart",
    symbol: ticker,
    interval: api,
    period1: String(Math.floor(period1 / 1000)),
    period2: String(Math.ceil(period2 / 1000)),
    extended: extended ? "1" : "0",
  });
  const response = await fetcher(`/api/yahoo?${params}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => ({}))) as Partial<ChartPayload>;
  if (!response.ok)
    throw new Error(body.error ?? "Yahoo Finance is unavailable.");
  return body as ChartPayload;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await run(items[index]);
      }
    }),
  );
  return out;
}

/**
 * Load candles of any time interval from Yahoo Finance: the coarsest native
 * interval that divides it is requested in windows Yahoo allows, then
 * resampled. Intraday history is limited by Yahoo (1m ≈ 30 days, 5–30m ≈ 60
 * days, 1h ≈ 2 years); daily and coarser go back decades.
 */
export async function loadYahooBars(
  request: YahooLoadRequest,
): Promise<YahooLoad> {
  const interval = parseInterval(request.timeframe);
  const plan = planSource(request.timeframe, YAHOO_NATIVES);
  if (!interval || !plan)
    throw new Error(
      `${request.timeframe} is not available for this market; use 1m or longer.`,
    );
  const native = YAHOO_NATIVES.find((n) => n.id === plan.nativeId)!;
  const fetcher = request.fetcher ?? fetch;
  const count = Math.max(1, Math.min(20_000, Math.floor(request.count)));
  const wanted = (count + (plan.resample ? 1 : 0)) * plan.factor;
  const end = request.end ?? Date.now();
  const earliest = Math.max(0, Date.now() - native.lookbackDays * 86_400_000, request.start ?? 0);
  if (!Number.isFinite(end) || !Number.isFinite(earliest) || end <= earliest)
    throw new Error("This Yahoo history window is outside the available retention period.");
  const span = Math.min(windowFor(native, wanted), end - earliest);
  const chunk = native.chunkDays * 86_400_000;
  const windows: [number, number][] = [];
  for (let to = end, remaining = span; remaining > 0;) {
    const length = Math.min(chunk, remaining);
    windows.push([to - length, to]);
    to -= length;
    remaining -= length;
  }
  const payloads = await mapLimit(
    windows,
    request.concurrency ?? 3,
    ([from, to]) =>
      request.chartLoader
        ? request.chartLoader(
            request.ticker,
            native.api,
            from,
            to,
            request.extended,
          )
        : chart(
            fetcher,
            request.ticker,
            native.api,
            from,
            to,
            request.extended,
          ),
  );
  const byTime = new Map<number, OHLCV>();
  const events: YahooEvents = { dividends: [], splits: [] };
  let meta: YahooMeta | null = null;
  for (const payload of payloads) {
    meta ??= payload.meta;
    if (payload.meta.sessions) meta = { ...meta, sessions: {
      regular: [...new Map([...(meta.sessions?.regular ?? []), ...payload.meta.sessions.regular].map(w => [w[0], w])).values()].sort((a, b) => a[0] - b[0]),
      extended: [...new Map([...(meta.sessions?.extended ?? []), ...payload.meta.sessions.extended].map(w => [w[0], w])).values()].sort((a, b) => a[0] - b[0]),
    } };
    let bars = payload.rows.map((r) => ({
      time: r[0],
      open: r[1],
      high: r[2],
      low: r[3],
      close: r[4],
      volume: r[5],
    }));
    if (request.adjustDividends && ["1D", "1W", "1M"].includes(native.id))
      bars = adjustForDividends(bars, payload.adj);
    if (
      !request.preserveSessionTimes &&
      (native.id === "1D" || native.id === "1W" || native.id === "1M")
    )
      bars = bars.map((b) => ({ ...b, time: bucketStart(native.id, b.time) }));
    for (const b of bars) byTime.set(b.time, b);
    events.dividends.push(...(payload.events?.dividends ?? []));
    events.splits.push(...(payload.events?.splits ?? []));
  }
  let source = [...byTime.values()]
    .filter((b) => b.time <= end)
    .sort((a, b) => a.time - b.time);
  if (plan.resample && source.length) {
    const first = bucketStart(interval.id, source[0].time);
    if (first < source[0].time)
      source = source.filter((b) => bucketStart(interval.id, b.time) > first);
    const sessionStarts = new Map<number, number>();
    for (const b of source) {
      const key = bucketStart(interval.id, b.time);
      if (!sessionStarts.has(key)) sessionStarts.set(key, b.time);
    }
    source = aggregateBars(source, interval.id);
    if (request.preserveSessionTimes)
      source = source.map((b) => ({
        ...b,
        time: sessionStarts.get(b.time) ?? b.time,
      }));
  }
  const unique = (list: { time: number }[]) =>
    [...new Map(list.map((e) => [e.time, e])).values()].sort(
      (a, b) => a.time - b.time,
    );
  return {
    bars: source.slice(-count),
    meta,
    events: {
      dividends: unique(events.dividends) as YahooEvents["dividends"],
      splits: unique(events.splits) as YahooEvents["splits"],
    },
  };
}

export async function yahooQuotes(
  tickers: string[],
  fetcher: typeof fetch = fetch,
): Promise<Record<string, YahooQuote>> {
  const out: Record<string, YahooQuote> = {};
  for (let i = 0; i < tickers.length; i += 20) {
    const params = new URLSearchParams({
      kind: "spark",
      symbols: tickers.slice(i, i + 20).join(","),
    });
    const response = await fetcher(`/api/yahoo?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) continue;
    const payload = (await response.json().catch(() => ({}))) as { quotes?: Record<string, YahooQuote> };
    if (payload.quotes) Object.assign(out, payload.quotes);
  }
  return out;
}

export async function yahooSearch(
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<YahooSearchHit[]> {
  const params = new URLSearchParams({ kind: "search", q: query });
  const response = await fetcher(`/api/yahoo?${params}`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return [];
  const payload = (await response.json().catch(() => ({}))) as { hits?: YahooSearchHit[] };
  return payload.hits ?? [];
}
