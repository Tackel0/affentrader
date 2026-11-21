import { isSymbolId, providerOf, tickerOf } from "@/lib/symbolId";
import { loadKrakenTradingIncrements } from "./kraken";
import { loadBybitTradingIncrements } from "./bybitClient";
import { loadHyperliquidAssets } from "./hyperliquidClient";
import { priceTick } from "./hyperliquid";
import { executionPriceGrid } from "@/lib/orderflow/priceGrid";

export interface PriceGridMetadata { symbol: string; source: string; checkedAt: number; tickSize?: number; sizeDecimals?: number }
export type PriceGridLoader = (symbol: string) => Promise<PriceGridMetadata>;
export function priceGridTick(metadata: PriceGridMetadata, price?: number): number {
  const tick = metadata.tickSize ?? (metadata.sizeDecimals !== undefined && price !== undefined && price > 0 && Number.isFinite(price)
    ? priceTick(price, metadata.sizeDecimals) : NaN);
  if (!(tick > 0) || !Number.isFinite(tick)) throw new Error("Waiting for a valid chart price and market price precision.");
  executionPriceGrid(tick); return tick;
}
/** Public venue metadata only. Never infer a spot filter from quote decimals. */
export async function fetchPriceGridMetadata(symbol: string, fetcher: typeof fetch = fetch): Promise<PriceGridMetadata> {
  if (!isSymbolId(symbol)) throw new Error("Invalid price-grid market.");
  const provider = providerOf(symbol), ticker = tickerOf(symbol), checkedAt = Date.now();
  if (provider === "bybit") {
    const { tickSize } = await loadBybitTradingIncrements(symbol, fetcher);
    executionPriceGrid(tickSize); return { symbol, tickSize, checkedAt, source: "Bybit priceFilter.tickSize" };
  }
  if (provider === "kraken") {
    const { tickSize } = await loadKrakenTradingIncrements(ticker, fetcher);
    executionPriceGrid(tickSize); return { symbol, tickSize, checkedAt, source: "Kraken AssetPairs tick_size" };
  }
  if (provider === "hyperliquid") {
    const asset = (await loadHyperliquidAssets(fetcher)).find(a => a.coin === ticker && a.symbol === symbol);
    if (!asset || asset.pricePrecisionKnown !== true || !Number.isInteger(asset.szDecimals) || asset.szDecimals < 0 || asset.szDecimals > 6)
      throw new Error("Hyperliquid perpetual price precision is unavailable.");
    return { symbol, checkedAt, sizeDecimals: asset.szDecimals, source: "Hyperliquid perp szDecimals and five-significant-figure rule at the observed chart price" };
  }
  if (provider !== "binance") throw new Error("This source supplies no verified execution price grid. Set an explicit price tick override.");
  const url = new URL("https://data-api.binance.vision/api/v3/exchangeInfo"); url.searchParams.set("symbol", ticker);
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Binance price-grid metadata returned HTTP ${response.status}.`);
  const body = await response.json(), matches = Array.isArray(body?.symbols) ? body.symbols.filter((s: { symbol?: unknown }) => s?.symbol === ticker) : [];
  const filters = matches.length === 1 && Array.isArray(matches[0]?.filters) ? matches[0].filters.filter((f: { filterType?: unknown }) => f?.filterType === "PRICE_FILTER") : [];
  const value = filters.length === 1 ? filters[0]?.tickSize : undefined;
  const tickSize = typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (!(tickSize > 0) || !Number.isFinite(tickSize)) throw new Error("Binance did not provide an enabled PRICE_FILTER tickSize for this market.");
  executionPriceGrid(tickSize); return { symbol, tickSize, checkedAt, source: "Binance spot PRICE_FILTER tickSize" };
}
/** Share in-flight requests across studies, retain at most 128 entries, and
 * back off failures for 30 seconds instead of requesting on every trade. */
export function createPriceGridLoader(fetcher?: typeof fetch): PriceGridLoader {
  const cache = new Map<string, { expires: number; promise: Promise<PriceGridMetadata> }>();
  return symbol => {
    const prior = cache.get(symbol); if (prior && prior.expires > Date.now()) return prior.promise;
    const entry = { expires: Date.now() + 300000, promise: undefined as unknown as Promise<PriceGridMetadata> };
    entry.promise = fetchPriceGridMetadata(symbol, fetcher ?? fetch).catch(error => { entry.expires = Date.now() + 30000; throw error; });
    cache.delete(symbol); cache.set(symbol, entry);
    if (cache.size > 128) cache.delete(cache.keys().next().value!);
    return entry.promise;
  };
}
export const loadPriceGridMetadata = createPriceGridLoader();
