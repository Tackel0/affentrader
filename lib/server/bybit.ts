import { BYBIT_NATIVES, parseBybitCandles, parseBybitTicker, type BybitTicker } from "@/lib/market/bybit";
import type { Row, KlinePager } from "@/lib/market/klines";
import { bybitMarket, type BybitCategory } from "@/lib/symbolId";
import { wireDecimal, wireObject } from "@/lib/market/marketWire";

const BYBIT_API = "https://api.bybit.com";
const TICKER_TTL = 30_000;
const tickers = new Map<BybitCategory, { at: number; rows: BybitTicker[] }>();
const pending = new Map<BybitCategory, Promise<BybitTicker[]>>();

async function fetchMarket(resource: "tickers" | "kline" | "instruments-info", params: URLSearchParams, fetcher: typeof fetch) {
  const response = await fetcher(`${BYBIT_API}/v5/market/${resource}?${params}`, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`Bybit returned HTTP ${response.status}.`);
  const body = await response.json();
  if (body?.retCode !== 0 || !Array.isArray(body.result?.list))
    throw new Error("Invalid Bybit market response.");
  return { list: body.result.list as unknown[], time: typeof body.time === "number" ? body.time : Date.now() };
}

export function bybitTickers(category: BybitCategory, fetcher: typeof fetch = fetch): Promise<BybitTicker[]> {
  const hit = tickers.get(category);
  if (hit && Date.now() - hit.at < TICKER_TTL) return Promise.resolve(hit.rows);
  const request = pending.get(category);
  if (request) return request;
  const next = fetchMarket("tickers", new URLSearchParams({ category }), fetcher).then(({ list, time }) => {
    const rows = list.flatMap(raw => {
      const ticker = parseBybitTicker(raw, time);
      return ticker ? [ticker] : [];
    });
    tickers.set(category, { at: Date.now(), rows });
    return rows;
  }).finally(() => pending.delete(category));
  pending.set(category, next);
  return next;
}

export async function bybitCandlePage(
  symbol: string, interval: string, limit: number, end?: number, fetcher: typeof fetch = fetch,
): Promise<Row[]> {
  const market = bybitMarket(symbol);
  if (!market || !BYBIT_NATIVES.some(native => native.api === interval)
    || !Number.isInteger(limit) || limit < 1 || limit > 1000
    || (end !== undefined && (!Number.isSafeInteger(end) || end < 1))) throw new Error("Invalid Bybit candle request.");
  const params = new URLSearchParams({ category: market.category, symbol: market.pair, interval, limit: String(limit) });
  if (end !== undefined) params.set("end", String(end));
  const { list } = await fetchMarket("kline", params, fetcher);
  return parseBybitCandles(list);
}

export function bybitServerPager(fetcher: typeof fetch): KlinePager {
  return ({ symbol, api, limit, endTime }) => bybitCandlePage(symbol, api, limit, endTime, fetcher);
}

export async function bybitTradingIncrements(symbol: string, fetcher: typeof fetch = fetch) {
  const market = bybitMarket(symbol);
  if (!market) throw new Error("Invalid Bybit market.");
  const params = new URLSearchParams({ category: market.category, symbol: market.pair });
  const { list } = await fetchMarket("instruments-info", params, fetcher);
  const instrument = list.map(wireObject).find(item => item?.symbol === market.pair);
  const price = wireObject(instrument?.priceFilter), quantity = wireObject(instrument?.lotSizeFilter);
  const tickSize = wireDecimal(price?.tickSize);
  const quantityStep = wireDecimal(market.category === "spot" ? quantity?.basePrecision : quantity?.qtyStep);
  if (!Number.isFinite(tickSize) || tickSize <= 0) throw new Error("Bybit did not supply a valid price increment.");
  return { tickSize, quantityStep: Number.isFinite(quantityStep) && quantityStep > 0 ? quantityStep : undefined };
}
