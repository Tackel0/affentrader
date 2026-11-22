import { isSymbolId, providerOf, tickerOf } from "@/lib/symbolId";
import { setBoundedCache } from "./cache";
import { binanceJson } from "./exchange";
import { hyperliquidCandles } from "./hyperliquid";
import { parseCandles } from "@/lib/market/hyperliquid";
import { bybitCandlePage } from "./bybit";
import { yahooSpark } from "./yahoo";
import {
  lastUsMarketCloseMs,
  US_CLOSE_CACHE_TTL_MS,
  US_CLOSE_LOOKBACK_MS,
  usMarketPhase,
} from "@/lib/market/usMarketClose";

const HOUR_MS = 3_600_000;
const MAX_BATCH = 60;
const MAX_CACHE = 600;
const CONCURRENCY = 6;

interface CachedPrice {
  at: number;
  price: number;
}

const priceCache = new Map<string, CachedPrice>();

export function clearUsCloseCache(): void {
  priceCache.clear();
}

export interface UsCloseSnapshot {
  closeMs: number;
  prices: Record<string, number>;
}

function cacheKey(symbol: string, closeMs: number): string {
  return `${symbol}@${closeMs}`;
}

async function fetchBinanceClose(symbol: string, closeMs: number, fetcher: typeof fetch): Promise<number | null> {
  const params = new URLSearchParams({
    symbol,
    interval: "1h",
    startTime: String(closeMs - HOUR_MS),
    endTime: String(closeMs - 1),
    limit: "1",
  });
  const rows = await binanceJson(`/api/v3/klines?${params}`, fetcher);
  if (!Array.isArray(rows) || !rows.length) return null;
  const bar = rows[rows.length - 1];
  const close = Array.isArray(bar) ? Number(bar[4]) : NaN;
  return Number.isFinite(close) && close > 0 ? close : null;
}

async function fetchHyperliquidClose(symbol: string, closeMs: number, fetcher: typeof fetch): Promise<number | null> {
  const coin = tickerOf(symbol);
  const raw = await hyperliquidCandles(
    {
      coin,
      interval: "1h",
      startTime: closeMs - US_CLOSE_LOOKBACK_MS,
      endTime: closeMs,
    },
    fetcher,
  );
  const bars = parseCandles(raw).filter((bar) => bar.time + HOUR_MS <= closeMs + 60_000);
  const last = bars.at(-1);
  return last && Number.isFinite(last.close) && last.close > 0 ? last.close : null;
}

async function fetchBybitClose(symbol: string, closeMs: number, fetcher: typeof fetch): Promise<number | null> {
  const rows = await bybitCandlePage(symbol, "60", 2, closeMs - 1, fetcher);
  const closed = rows.filter((row) => Number(row[0]) + HOUR_MS <= closeMs + 60_000);
  const last = closed.at(-1) ?? rows.at(-1);
  const close = last ? Number(last[4]) : NaN;
  return Number.isFinite(close) && close > 0 ? close : null;
}

async function fetchKrakenClose(symbol: string, closeMs: number, fetcher: typeof fetch): Promise<number | null> {
  const pair = tickerOf(symbol).replace("/", "");
  const since = Math.floor((closeMs - 6 * HOUR_MS) / 1000);
  const response = await fetcher(`https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=60&since=${since}`, {
    signal: AbortSignal.timeout(7_000),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as { result?: Record<string, unknown> } | null;
  if (!body?.result || typeof body.result !== "object") return null;
  const key = Object.keys(body.result).find((k) => k !== "last");
  const rows = key ? body.result[key] : null;
  if (!Array.isArray(rows)) return null;
  let best: { time: number; close: number } | null = null;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const tMs = Number(row[0]) * 1000;
    const close = Number(row[4]);
    if (!Number.isFinite(tMs) || !Number.isFinite(close) || close <= 0) continue;
    if (tMs + HOUR_MS <= closeMs + 60_000 && (!best || tMs > best.time)) {
      best = { time: tMs, close };
    }
  }
  return best?.close ?? null;
}

async function runPool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await work(current);
    }
  });
  await Promise.all(workers);
}

/**
 * Fetches immutable reference prices at the latest completed US market close (16:00 ET)
 * for up to 60 valid symbols across Binance, Hyperliquid, Bybit, Kraken, and Yahoo/Alpaca.
 */
export async function fetchUsClosePrices(
  rawSymbols: readonly string[],
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<UsCloseSnapshot> {
  const closeMs = lastUsMarketCloseMs(now);
  const uniqueSymbols = [...new Set(rawSymbols.map((s) => s.trim()).filter(isSymbolId))].slice(0, MAX_BATCH);
  const prices: Record<string, number> = {};
  const missing: string[] = [];

  for (const symbol of uniqueSymbols) {
    const cached = priceCache.get(cacheKey(symbol, closeMs));
    if (cached && now - cached.at < US_CLOSE_CACHE_TTL_MS) {
      prices[symbol] = cached.price;
    } else {
      missing.push(symbol);
    }
  }

  if (!missing.length) return { closeMs, prices };

  const equitySymbols = missing.filter((s) => {
    const p = providerOf(s);
    return p === "yahoo" || p === "alpaca";
  });
  const streamSymbols = missing.filter((s) => {
    const p = providerOf(s);
    return p !== "yahoo" && p !== "alpaca";
  });

  const remember = (symbol: string, price: number | null) => {
    if (price !== null && Number.isFinite(price) && price > 0) {
      prices[symbol] = price;
      setBoundedCache(priceCache, cacheKey(symbol, closeMs), { at: now, price }, MAX_CACHE);
    }
  };

  const tasks: Promise<void>[] = [];

  if (equitySymbols.length > 0) {
    tasks.push(
      (async () => {
        try {
          const tickers = [...new Set(equitySymbols.map((s) => tickerOf(s)))];
          const quotes = await yahooSpark(tickers, fetcher);
          const regularOpen = usMarketPhase(now) === "regular";
          for (const symbol of equitySymbols) {
            const q = quotes[tickerOf(symbol)];
            if (!q) continue;
            // During regular US hours, previousClose is yesterday's 16:00 ET close;
            // outside regular hours, regularMarketPrice (`q.price`) is the latest 16:00 ET close.
            const refPrice = regularOpen ? q.previousClose : (q.price > 0 ? q.price : q.previousClose);
            remember(symbol, refPrice);
          }
        } catch {
          /* Equity spark fallback failed; omit cleanly without failing crypto/perp batch. */
        }
      })(),
    );
  }

  if (streamSymbols.length > 0) {
    tasks.push(
      runPool(streamSymbols, CONCURRENCY, async (symbol) => {
        try {
          const provider = providerOf(symbol);
          let price: number | null = null;
          if (provider === "binance") price = await fetchBinanceClose(symbol, closeMs, fetcher);
          else if (provider === "hyperliquid") price = await fetchHyperliquidClose(symbol, closeMs, fetcher);
          else if (provider === "bybit") price = await fetchBybitClose(symbol, closeMs, fetcher);
          else if (provider === "kraken") price = await fetchKrakenClose(symbol, closeMs, fetcher);
          remember(symbol, price);
        } catch {
          /* Individual upstream symbol error stays isolated. */
        }
      }),
    );
  }

  await Promise.all(tasks);
  return { closeMs, prices };
}
