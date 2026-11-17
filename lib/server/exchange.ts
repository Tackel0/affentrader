import type { KlinePager, Row } from "@/lib/market/klines";

const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];

/** GET a Binance public endpoint, falling back across mirrors. */
export async function binanceJson(
  pathAndQuery: string,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  let lastError: unknown;
  for (const host of HOSTS) {
    try {
      const response = await fetcher(`${host}${pathAndQuery}`, {
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      // Awaited so a truncated body falls through to the next mirror instead of escaping the try.
      if (response.ok) return await response.json();
      lastError = new Error(`Exchange responded with HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Exchange unavailable");
}

export function serverKlinePager(fetcher: typeof fetch = fetch): KlinePager {
  return async ({ symbol, api, limit, endTime }) => {
    const params = new URLSearchParams({ symbol, interval: api, limit: String(limit) });
    if (endTime) params.set("endTime", String(Math.floor(endTime)));
    return (await binanceJson(`/api/v3/klines?${params}`, fetcher)) as Row[];
  };
}

export interface Ticker24h {
  symbol: string;
  lastPrice: string;
  prevClosePrice: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
  count: number;
}

export async function ticker24h(
  symbols?: string[],
  fetcher: typeof fetch = fetch,
): Promise<Ticker24h[]> {
  if (!symbols) return (await binanceJson("/api/v3/ticker/24hr", fetcher)) as Ticker24h[];
  const out: Ticker24h[] = [];
  for (let i = 0; i < symbols.length; i += 100) {
    const query = new URLSearchParams({ symbols: JSON.stringify(symbols.slice(i, i + 100)) });
    out.push(...((await binanceJson(`/api/v3/ticker/24hr?${query}`, fetcher)) as Ticker24h[]));
  }
  return out;
}

/** Spot pairs that are real instruments, not leveraged tokens or stablecoin pairs. */
export function isTradableUsdtPair(symbol: string): boolean {
  if (!symbol.endsWith("USDT")) return false;
  const base = symbol.slice(0, -4);
  if (/(UP|DOWN|BULL|BEAR)$/.test(base) && base.length > 4) return false;
  return !["USDC", "FDUSD", "TUSD", "BUSD", "USDP", "DAI", "EUR", "AEUR", "USD1", "XUSD", "UST", "USDE"].includes(base);
}
