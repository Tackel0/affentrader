import type { OHLCV } from "@/types/trading";
import { instrumentType, type InstrumentType } from "@/lib/symbolId";
import { parseYahooSessionWindows, type MarketSessionWindows } from "./sessionWindows";

/**
 * Yahoo Finance chart data (stocks, ETFs, indices, forex, futures). The parsers
 * are pure so they can be tested with recorded responses; the network lives in
 * `lib/server/yahoo.ts` (server) and `yahooClient.ts` (browser).
 */
export interface YahooNative {
  id: string;
  /** Yahoo `interval` parameter. */
  api: string;
  ms: number;
  /** Deepest history Yahoo serves for this interval, in days. */
  lookbackDays: number;
  /** Longest window one request may span, in days. */
  chunkDays: number;
  /** Fraction of the clock time that actually has bars (sessions, weekends). */
  density: number;
}

export const YAHOO_NATIVES: YahooNative[] = [
  { id: "1m", api: "1m", ms: 60_000, lookbackDays: 29, chunkDays: 7, density: 0.28 },
  { id: "5m", api: "5m", ms: 300_000, lookbackDays: 59, chunkDays: 59, density: 0.28 },
  { id: "15m", api: "15m", ms: 900_000, lookbackDays: 59, chunkDays: 59, density: 0.28 },
  { id: "30m", api: "30m", ms: 1_800_000, lookbackDays: 59, chunkDays: 59, density: 0.28 },
  { id: "1h", api: "60m", ms: 3_600_000, lookbackDays: 729, chunkDays: 365, density: 0.28 },
  { id: "1D", api: "1d", ms: 86_400_000, lookbackDays: 36_500, chunkDays: 36_500, density: 0.69 },
  { id: "1W", api: "1wk", ms: 7 * 86_400_000, lookbackDays: 36_500, chunkDays: 36_500, density: 1 },
  { id: "1M", api: "1mo", ms: 30 * 86_400_000, lookbackDays: 36_500, chunkDays: 36_500, density: 1 },
];

export interface YahooMeta {
  sessions?: MarketSessionWindows;
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  type: InstrumentType;
  timezone: string;
  price: number;
  previousClose: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  /** Epoch ms of the latest regular-market trade. */
  time: number;
  gmtOffset: number;
}

export interface YahooEvents {
  dividends: { time: number; amount: number }[];
  splits: { time: number; numerator: number; denominator: number }[];
}

export interface YahooChart {
  meta: YahooMeta;
  bars: OHLCV[];
  /** Dividend-adjusted close for each bar (null when unavailable). */
  adjClose: (number | null)[];
  events: YahooEvents;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);

export function parseMeta(raw: Record<string, unknown> | undefined): YahooMeta {
  const m = raw ?? {};
  const sessions = parseYahooSessionWindows(m.tradingPeriods);
  return {
    ...(sessions ? { sessions } : {}),
    symbol: String(m.symbol ?? ""),
    name: String(m.longName ?? m.shortName ?? m.symbol ?? ""),
    exchange: String(m.fullExchangeName ?? m.exchangeName ?? ""),
    currency: String(m.currency ?? ""),
    type: instrumentType(String(m.instrumentType ?? "")),
    timezone: String(m.exchangeTimezoneName ?? "UTC"),
    price: num(m.regularMarketPrice),
    previousClose: num(m.chartPreviousClose ?? m.previousClose),
    dayHigh: num(m.regularMarketDayHigh),
    dayLow: num(m.regularMarketDayLow),
    volume: num(m.regularMarketVolume),
    time: num(m.regularMarketTime) * 1000,
    gmtOffset: num(m.gmtoffset),
  };
}

/** Parse a `v8/finance/chart` response; throws a readable error for Yahoo failures. */
export function parseChart(json: unknown): YahooChart {
  const chart = (json as { chart?: { result?: unknown[]; error?: { description?: string } | null } })?.chart;
  if (chart?.error) throw new Error(chart.error.description ?? "Yahoo Finance rejected the request.");
  const result = chart?.result?.[0] as
    | {
        meta?: Record<string, unknown>;
        timestamp?: number[];
        indicators?: {
          quote?: { open?: unknown[]; high?: unknown[]; low?: unknown[]; close?: unknown[]; volume?: unknown[] }[];
          adjclose?: { adjclose?: unknown[] }[];
        };
        events?: {
          dividends?: Record<string, { amount: number; date: number }>;
          splits?: Record<string, { numerator: number; denominator: number; date: number }>;
        };
      }
    | undefined;
  if (!result) throw new Error("Yahoo Finance returned no data for this symbol.");
  const meta = parseMeta(result.meta);
  const q = result.indicators?.quote?.[0];
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const bars: OHLCV[] = [];
  const adjClose: (number | null)[] = [];
  const timestamps = result.timestamp ?? [];
  const granularity = String(result.meta?.dataGranularity ?? "");
  const minutes = /^(\d+)m$/.exec(granularity);
  const duration = minutes ? Number(minutes[1]) * 60 : granularity === "1h" ? 3600 : 0;
  timestamps.forEach((t, i) => {
    const open = num(q?.open?.[i]);
    const high = num(q?.high?.[i]);
    const low = num(q?.low?.[i]);
    const close = num(q?.close?.[i]);
    if (![open, high, low, close].every(Number.isFinite) || high < low) return;
    // Intraday responses may append the latest quote as a zero-volume point
    // inside the preceding candle. It is not another interval's OHLC. Keep its
    // actual timestamp/price in meta, without feeding it to candle-based studies.
    const previous = timestamps[i - 1];
    if (duration > 0 && i === timestamps.length - 1 && t * 1000 === meta.time
      && t > previous && t < previous + duration && q?.volume?.[i] === 0
      && open === high && high === low && low === close) return;
    bars.push({
      time: t * 1000,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume: Number.isFinite(num(q?.volume?.[i])) ? num(q?.volume?.[i]) : 0,
    });
    const a = adj ? num(adj[i]) : Number.NaN;
    adjClose.push(Number.isFinite(a) ? a : null);
  });
  const events: YahooEvents = {
    dividends: Object.values(result.events?.dividends ?? {})
      .map((d) => ({ time: d.date * 1000, amount: d.amount }))
      .sort((a, b) => a.time - b.time),
    splits: Object.values(result.events?.splits ?? {})
      .map((s) => ({ time: s.date * 1000, numerator: s.numerator, denominator: s.denominator }))
      .sort((a, b) => a.time - b.time),
  };
  return { meta, bars, adjClose, events };
}

/**
 * Scale OHLC by adjclose/close so dividends do not show up as price gaps.
 * Yahoo already adjusts prices for splits; only daily and coarser bars carry
 * an adjusted close, so intraday bars are returned unchanged.
 */
export function adjustForDividends(bars: readonly OHLCV[], adjClose: readonly (number | null)[]): OHLCV[] {
  return bars.map((b, i) => {
    const adj = adjClose[i];
    if (adj === null || adj === undefined || !b.close) return b;
    const k = adj / b.close;
    return { ...b, open: b.open * k, high: b.high * k, low: b.low * k, close: adj };
  });
}

export interface YahooQuote {
  price: number;
  previousClose: number;
  high: number;
  low: number;
  /** Epoch ms of the last close in the series. */
  time: number;
}

/** Parse the multi-symbol `spark` response into quote snapshots. */
export function parseSpark(json: unknown): Record<string, YahooQuote> {
  const out: Record<string, YahooQuote> = {};
  const root = json as Record<string, { timestamp?: number[]; close?: unknown[]; previousClose?: number; chartPreviousClose?: number } | undefined>;
  for (const [symbol, row] of Object.entries(root ?? {})) {
    if (!row || !Array.isArray(row.close)) continue;
    const closes = row.close.map(num).filter(Number.isFinite);
    if (!closes.length) continue;
    out[symbol] = {
      price: closes.at(-1)!,
      previousClose: num(row.chartPreviousClose ?? row.previousClose),
      high: Math.max(...closes),
      low: Math.min(...closes),
      time: (row.timestamp?.at(-1) ?? 0) * 1000,
    };
  }
  return out;
}

export interface YahooSearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: InstrumentType;
}

export function parseSearch(json: unknown): YahooSearchHit[] {
  const quotes = (json as { quotes?: Record<string, unknown>[] })?.quotes;
  if (!Array.isArray(quotes)) return [];
  const hits: YahooSearchHit[] = [];
  for (const q of quotes) {
    const symbol = String(q.symbol ?? "");
    if (!symbol || q.isYahooFinance === false) continue;
    const type = instrumentType(String(q.quoteType ?? ""));
    hits.push({
      symbol,
      name: String(q.longname ?? q.shortname ?? symbol),
      exchange: String(q.exchDisp ?? q.exchange ?? ""),
      type,
    });
  }
  return hits;
}

/** How much clock time to request for `bars` bars of a native interval. */
export function windowFor(native: YahooNative, bars: number): number {
  return Math.ceil((bars * native.ms) / native.density);
}
