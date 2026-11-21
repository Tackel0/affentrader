import type { BybitCategory } from "@/lib/symbolId";
import { BYBIT_NATIVES, type BybitTicker } from "./bybit";
import { loadKlines, type KlineRequest, type Row } from "./klines";

async function bybitJson<T>(query: URLSearchParams, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api/bybit?${query}`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("Bybit market data is temporarily unavailable.");
  return response.json() as Promise<T>;
}

export function loadBybitBars(request: KlineRequest, fetcher?: typeof fetch) {
  return loadKlines(async ({ symbol, api, limit, endTime }) => {
    const query = new URLSearchParams({ kind: "candles", symbol, interval: api, limit: String(limit) });
    if (endTime !== undefined) query.set("end", String(Math.floor(endTime)));
    const { candles } = await bybitJson<{ candles: Row[] }>(query, fetcher);
    return candles;
  }, request, BYBIT_NATIVES);
}

export function loadBybitTradingIncrements(symbol: string, fetcher?: typeof fetch) {
  return bybitJson<{ tickSize: number; quantityStep?: number }>(new URLSearchParams({ kind: "instrument", symbol }), fetcher);
}

let catalog: { at: number; rows: { ticker: BybitTicker; category: BybitCategory }[] } | undefined;
let pending: Promise<{ ticker: BybitTicker; category: BybitCategory }[]> | undefined;

export function loadBybitCatalog() {
  if (catalog && Date.now() - catalog.at < 30_000) return Promise.resolve(catalog.rows);
  pending ??= Promise.allSettled((["spot", "linear"] as const).map(async category => {
    const { tickers } = await bybitJson<{ tickers: BybitTicker[] }>(new URLSearchParams({ kind: "tickers", category }));
    return tickers.map(ticker => ({ ticker, category }));
  })).then(results => {
    const rows = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
    if (rows.length) catalog = { at: Date.now(), rows };
    return rows;
  }).finally(() => { pending = undefined; });
  return pending;
}
