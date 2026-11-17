import type { OHLCV, Quote, QuoteMetrics, QuotePeriod, QuoteRange } from "@/types/trading";
import { providerOf, symbolInfo, tickerOf } from "@/lib/symbolId";
import { spotQuoteCurrency } from "@/lib/symbolId";

export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;
export const nonnegative = (value: unknown): number | null => {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
export function pendingRange(now = Date.now()): QuoteRange {
  const to = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  return { high: null, low: null, period: "24h", from: to - DAY_MS, to, resolution: "1m", complete: false, bars: 0, expectedBars: 1440 };
}
export function candleDayRange(bars: readonly OHLCV[], to: number): QuoteRange {
  const range = pendingRange(to), unique = new Map<number, OHLCV>();
  for (const bar of bars) {
    if (bar.time >= range.from! && bar.time + MINUTE_MS <= range.to && bar.time % MINUTE_MS === 0 &&
      [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) && bar.low > 0 &&
      bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close)) unique.set(bar.time, bar);
  }
  range.bars = unique.size;
  if (unique.size !== 1440) return range;
  for (let time = range.from!; time < range.to; time += MINUTE_MS) if (!unique.has(time)) return range;
  range.high = Math.max(...[...unique.values()].map(bar => bar.high));
  range.low = Math.min(...[...unique.values()].map(bar => bar.low));
  range.complete = true;
  return range;
}
export const baseVolume = (quote: { volume: number; metrics?: QuoteMetrics } | undefined): number | null =>
  !quote ? null : quote.metrics ? quote.metrics.volume.base : nonnegative(quote.volume);
export const notionalVolume = (quote: { metrics?: QuoteMetrics } | undefined): number | null => quote?.metrics?.volume.quote ?? null;
export function quoteRange(quote: { high: number; low: number; metrics?: QuoteMetrics } | undefined): { high: number | null; low: number | null } {
  if (!quote) return { high: null, low: null };
  if (quote.metrics) {
    const range = quote.metrics.range;
    if (range.resolution === "1m" && (!range.complete || Date.now() - range.to > 2 * MINUTE_MS)) return { high: null, low: null };
    return { high: range.high, low: range.low };
  }
  return { high: quote.high > 0 ? quote.high : null, low: quote.low > 0 ? quote.low : null };
}
export const periodLabel = (period?: QuotePeriod) => period === "session" ? "Session" : period === "observed" ? "Observed" : period === "simulation" ? "Simulated" : "24h";
export function rangeDescription(quote?: Quote): string {
  const range = quote?.metrics?.range;
  if (!range) return "Provider price range";
  if (range.resolution === "1m") return `${range.complete ? "Complete" : "Incomplete"} 24h candle window · ${range.bars ?? 0}/${range.expectedBars ?? 1440} closed 1m candles · through ${new Date(range.to).toISOString()}. Intraminute trade order is unavailable.`;
  return `${periodLabel(range.period)} range · ${range.resolution} · as of ${new Date(range.to).toISOString()}`;
}
export function basicMetrics(symbol: string, volume: number | null, quoteVolume: number | null, high: number, low: number, period: QuotePeriod, now = Date.now()): QuoteMetrics {
  return {
    volume: { base: volume, quote: quoteVolume, currency: ["hyperliquid", "alpaca"].includes(providerOf(symbol)) ? "USD" : symbolInfo(symbol)?.currency ?? (providerOf(symbol) === "binance" ? spotQuoteCurrency(symbol) : providerOf(symbol) === "kraken" ? tickerOf(symbol).split("/")[1] : ""), period, asOf: now },
    range: { high: high > 0 ? high : null, low: low > 0 ? low : null, period, from: period === "24h" ? now - DAY_MS : null, to: now, resolution: period === "observed" || period === "simulation" ? "observed" : "ticker", complete: period !== "observed" },
  };
}
