import type { Quote, QuoteMetrics } from "@/types/trading";
import { basicMetrics, pendingRange } from "./quoteMetrics";

export type HyperliquidPriceBasis = "trade" | "mid" | "mark";
export interface HyperliquidQuoteUpdate {
  symbol: string;
  price: number;
  basis: HyperliquidPriceBasis;
  time: number;
  referencePrice?: number;
  metadataTime?: number;
  metrics?: QuoteMetrics;
}
const rank = { mark: 1, mid: 2, trade: 3 };
const positive = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Keep last trades, midpoints and valuations from becoming one artificial tape. */
export function mergeHyperliquidQuote(previous: Quote | undefined, update: HyperliquidQuoteUpdate): Quote | undefined {
  const old = previous?.symbol === update.symbol && !previous.simulated ? previous : undefined;
  const oldBasis = old?.priceBasis === "trade" || old?.priceBasis === "mid" ? old.priceBasis : "mark";
  const validPrice = positive(update.price) && positive(update.time);
  const acceptsPrice = validPrice && (!old || rank[update.basis] > rank[oldBasis]
    || update.basis === oldBasis && update.time >= old.time);
  if (!old && !acceptsPrice) return undefined;
  const basis = acceptsPrice ? update.basis : oldBasis;
  const price = acceptsPrice ? update.price : old!.price;
  const time = acceptsPrice ? update.time : old!.time;
  const basisChanged = !old || basis !== oldBasis;
  const priceChanged = !old || price !== old.price;
  const metadataTime = update.metadataTime ?? update.time;
  const acceptsReference = positive(update.referencePrice) && positive(metadataTime)
    && metadataTime >= (old?.referenceTime ?? 0);
  const reference = acceptsReference ? update.referencePrice! : old?.referencePrice ?? null;
  const referenceTime = acceptsReference ? metadataTime : old?.referenceTime;
  let metrics = old?.metrics;
  if (update.metrics && (!metrics || update.metrics.volume.asOf >= metrics.volume.asOf)) {
    metrics = { ...update.metrics, range: metrics?.range.resolution === "1m" && update.metrics.range.resolution !== "1m"
      ? metrics.range : update.metrics.range };
  }
  if (!metrics) { metrics = basicMetrics(update.symbol, null, null, 0, 0, "24h", time); metrics.range = pendingRange(time); }
  const history = basisChanged ? [price] : priceChanged ? [...old!.history, price].slice(-48) : old!.history;
  return {
    symbol: update.symbol, price, priceBasis: basis, time,
    previous: basisChanged ? price : acceptsPrice ? old!.price : old!.previous,
    referencePrice: reference, referenceTime,
    change: reference === null ? NaN : price - reference,
    changePercent: reference === null ? NaN : (price - reference) / reference * 100,
    high: metrics.range.high ?? 0, low: metrics.range.low ?? 0, volume: metrics.volume.base ?? 0,
    history, simulated: false, metrics,
  };
}

export function quotePriceLabel(quote: Quote | undefined): string {
  if (!quote) return "Waiting for price";
  if (quote.simulated) return "Simulated price";
  return quote.priceBasis === "trade" ? "Last trade" : quote.priceBasis === "mid" ? "Midpoint"
    : quote.priceBasis === "mark" ? "Mark price" : "Provider price";
}

/** Extra last-trade streams are bounded; chart/order-flow streams already own trades. */
export function hyperliquidQuoteTradeSymbols(streams: readonly string[], quotes: readonly string[], priority: readonly string[], dexCount: number, nativeCount: number): string[] {
  const streamSet = new Set(streams), available = new Set(quotes.filter(symbol => symbol.startsWith("HL:") && !streamSet.has(symbol)));
  const capacity = Math.max(0, Math.min(150, 1000 - dexCount - streams.length * 3 - nativeCount - 128));
  return [...new Set([...priority, ...quotes])].filter(symbol => available.has(symbol)).slice(0, capacity);
}
