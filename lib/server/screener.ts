import { loadKlines } from "@/lib/market/klines";
import { computeTechnicals, type ScreenerRow } from "@/lib/screener/technical";
import { isValidInterval } from "@/lib/market/intervals";
import { isTradableUsdtPair, serverKlinePager, ticker24h, type Ticker24h } from "./exchange";
import { hyperliquidAssets, hyperliquidCandles } from "./hyperliquid";
import { loadHyperliquidBars } from "@/lib/market/hyperliquidClient";
import { parseCandles, type HyperliquidAsset } from "@/lib/market/hyperliquid";

import { universeFor, STOCK_UNIVERSE_IDS } from "@/lib/stockUniverse";
import { loadYahooBars } from "@/lib/market/yahooClient";
import { yahooChart, yahooSpark } from "./yahoo";

/** `stocks:<exchange id>` screens a curated list of that exchange's large listings through Yahoo Finance. */
export type ScreenerMarket = "binance" | "hyperliquid" | "hyperliquid-markets" | `stocks:${string}`;
export const SCREENER_MARKETS: ScreenerMarket[] = ["binance", "hyperliquid", "hyperliquid-markets", ...STOCK_UNIVERSE_IDS.map((id) => `stocks:${id}` as const)];

export class ScreenerValidationError extends Error {}

export interface ScreenerResult {
  rows: ScreenerRow[];
  timeframe: string | null;
  universe: number;
  generatedAt: number;
  /** Symbols whose candles could not be loaded. */
  failed: string[];
}

const cache = new Map<string, { at: number; result: ScreenerResult }>();
const TTL = 60_000;
export const MAX_UNIVERSE = 150;

export function toRow(t: Ticker24h): ScreenerRow {
  const price = Number(t.lastPrice);
  const high = Number(t.highPrice);
  const low = Number(t.lowPrice);
  return {
    symbol: t.symbol,
    price,
    change24h: Number(t.priceChangePercent),
    quoteVolume: Number(t.quoteVolume),
    volume: Number(t.volume),
    trades: Number(t.count),
    high24h: high,
    low24h: low,
    rangePosition: high > low ? ((price - low) / (high - low)) * 100 : 50,
  };
}

/** A Hyperliquid perpetual as a screener row. The venue publishes no 24h high or low, so the range position stays empty. */
export function assetRow(a: HyperliquidAsset): ScreenerRow {
  return {
    symbol: a.symbol,
    price: a.mark,
    change24h: a.previousDay > 0 ? ((a.mark - a.previousDay) / a.previousDay) * 100 : 0,
    quoteVolume: a.volume,
    volume: a.baseVolume ?? Number.NaN,
    trades: 0,
    high24h: Number.NaN,
    low24h: Number.NaN,
    rangePosition: Number.NaN,
  };
}

/** Hyperliquid markets by 24h turnover: crypto perps (main dex) or builder-dex equities, metals and indices. */
export async function hyperliquidUniverse(
  market: "hyperliquid" | "hyperliquid-markets",
  limit: number,
  minTurnover = 1_000_000,
  fetcher: typeof fetch = fetch,
): Promise<ScreenerRow[]> {
  const assets = await hyperliquidAssets(fetcher);
  return assets
    .filter((a) => (market === "hyperliquid" ? a.dex === "" : a.dex !== ""))
    .map(assetRow)
    .filter((r) => r.price > 0 && r.quoteVolume >= minTurnover)
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, limit);
}

/** Quotes for a curated list of stocks. Yahoo's snapshot has no volume, so turnover stays empty and rows sort by their move. */
export async function stocksUniverse(exchangeId: string, limit: number, fetcher: typeof fetch = fetch): Promise<ScreenerRow[]> {
  const universe = universeFor(exchangeId);
  if (!universe) throw new ScreenerValidationError("Unknown market.");
  const tickers = universe.tickers.slice(0, limit);
  const rows: ScreenerRow[] = [];
  for (let i = 0; i < tickers.length; i += 20) {
    let quotes: Awaited<ReturnType<typeof yahooSpark>> = {};
    try {
      quotes = await yahooSpark(tickers.slice(i, i + 20), fetcher);
    } catch {
      /* a failed batch only leaves its tickers out */
    }
    for (const ticker of tickers.slice(i, i + 20)) {
      const q = quotes[ticker];
      if (!q || !(q.price > 0)) continue;
      const high = Math.max(q.high, q.price);
      const low = Math.min(q.low, q.price);
      rows.push({
        symbol: `YF:${ticker}`,
        price: q.price,
        change24h: q.previousClose > 0 ? ((q.price - q.previousClose) / q.previousClose) * 100 : 0,
        quoteVolume: Number.NaN,
        volume: Number.NaN,
        trades: 0,
        high24h: high,
        low24h: low,
        rangePosition: high > low ? ((q.price - low) / (high - low)) * 100 : 50,
      });
    }
  }
  return rows.sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));
}

/** The most liquid tradable USDT pairs, by 24h turnover. */
export async function universe(limit: number, minTurnover = 1_000_000, fetcher: typeof fetch = fetch): Promise<ScreenerRow[]> {
  const rows = (await ticker24h(undefined, fetcher))
    .filter((t) => isTradableUsdtPair(t.symbol))
    .map(toRow)
    .filter((r) => Number.isFinite(r.price) && r.price > 0 && r.quoteVolume >= minTurnover);
  return rows.sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, limit);
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
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
 * Screen the most liquid pairs. Without a timeframe only 24h quote data is
 * returned; with one, candles are fetched for every symbol and the technical
 * indicators are computed server-side. Results are cached for a minute.
 */
export async function runScreener(
  options: { timeframe?: string | null; limit?: number; minTurnover?: number; market?: ScreenerMarket },
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<ScreenerResult> {
  const limit = Math.max(1, Math.min(MAX_UNIVERSE, Math.floor(options.limit ?? 80)));
  const timeframe = options.timeframe ?? null;
  if (timeframe && (!isValidInterval(timeframe) || timeframe.endsWith("T")))
    throw new ScreenerValidationError("Choose a time-based interval.");
  const market = options.market ?? "binance";
  if (!SCREENER_MARKETS.includes(market)) throw new ScreenerValidationError("Unknown market.");
  const key = `${market}:${timeframe}:${limit}:${options.minTurnover ?? 1_000_000}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL) return hit.result;
  const rows = market.startsWith("stocks:")
    ? await stocksUniverse(market.slice(7), limit, fetcher)
    : market === "binance"
      ? await universe(limit, options.minTurnover, fetcher)
      : await hyperliquidUniverse(market as "hyperliquid" | "hyperliquid-markets", limit, options.minTurnover, fetcher);
  const failed: string[] = [];
  if (timeframe) {
    const pager = serverKlinePager(fetcher);
    // The public Hyperliquid endpoint rate-limits bursts, so it gets fewer parallel requests.
    await mapLimit(rows, market === "binance" ? 8 : 3, async (row) => {
      try {
        const bars = market.startsWith("stocks:")
          ? (
              await loadYahooBars({
                ticker: row.symbol.slice(3),
                timeframe,
                count: 250,
                extended: false,
                adjustDividends: false,
                chartLoader: async (ticker, interval, period1, period2, extended) => {
                  const chart = await yahooChart({ ticker, interval, period1: period1 / 1000, period2: period2 / 1000, extended }, fetcher);
                  return {
                    meta: chart.meta,
                    rows: chart.bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume]),
                    adj: chart.adjClose,
                    events: chart.events,
                  };
                },
              })
            ).bars
          : market === "binance"
            ? await loadKlines(pager, { symbol: row.symbol, timeframe, count: 250 })
            : await loadHyperliquidBars({
                coin: row.symbol.slice(3),
                timeframe,
                count: 250,
                page: async (coin, api, startTime, endTime) =>
                  parseCandles(await hyperliquidCandles({ coin, interval: api, startTime, endTime }, fetcher)),
              });
        // Yahoo ends an intraday series with empty placeholder bars while a market is closed; they would zero every volume ratio.
        while (market.startsWith("stocks:") && bars.length > 60 && bars[bars.length - 1].volume === 0) bars.pop();
        const t = computeTechnicals(bars);
        if (t) Object.assign(row, t);
        else failed.push(row.symbol);
      } catch {
        failed.push(row.symbol);
      }
    });
  }
  const result: ScreenerResult = { rows, timeframe, universe: rows.length, generatedAt: now, failed };
  cache.set(key, { at: now, result });
  if (cache.size > 40) cache.delete(cache.keys().next().value!);
  return result;
}

export function clearScreenerCache() {
  cache.clear();
}
