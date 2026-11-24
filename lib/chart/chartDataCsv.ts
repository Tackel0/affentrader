import type { OHLCV } from "@/types/trading";
import { providerOf, SIP_PREFIX, type Provider } from "@/lib/symbolId";

const providers: Record<Provider, string> = {
  binance: "Binance",
  kraken: "Kraken",
  hyperliquid: "Hyperliquid",
  yahoo: "Yahoo Finance",
  alpaca: "Alpaca IEX",
  bybit: "Bybit",
};

export type ChartDataExportFormat = "csv" | "json";
export type ChartDataExportScope = "all" | "visible";

export function chartDataSourceLabel(
  symbol: string,
  lineage: "exchange" | "simulation" | undefined,
): string {
  if (lineage === "simulation") return "simulation";
  if (lineage === "exchange") {
    return symbol.startsWith(SIP_PREFIX) ? "Alpaca SIP" : providers[providerOf(symbol)];
  }
  return "unknown";
}

export function chartDataFilename(
  symbol: string,
  timeframe: string,
  format: ChartDataExportFormat,
  scope: ChartDataExportScope = "all",
): string {
  const safeSymbol = symbol.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "chart";
  const safeTf = timeframe.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "data";
  const suffix = scope === "visible" ? "-visible" : "";
  return `${safeSymbol}-${safeTf}${suffix}.${format}`;
}

export function filterBarsByVisibleRange(
  bars: readonly OHLCV[],
  range: { from: number; to: number } | null | undefined,
): OHLCV[] {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) {
    return [...bars];
  }
  const lo = Math.min(range.from, range.to);
  const hi = Math.max(range.from, range.to);
  return bars.filter((bar) => bar.time >= lo && bar.time <= hi);
}

/** Candle lineage belongs to this loaded symbol/interval, not the latest quote. */
export function chartDataCsv(
  bars: readonly OHLCV[],
  symbol: string,
  timeframe: string,
  lineage: "exchange" | "simulation" | undefined,
): string {
  const source = chartDataSourceLabel(symbol, lineage);
  return [
    "time,open,high,low,close,volume,symbol,timeframe,source",
    ...bars.map((bar) =>
      [new Date(bar.time).toISOString(), bar.open, bar.high, bar.low, bar.close, bar.volume, symbol, timeframe, source].join(","),
    ),
  ].join("\r\n");
}

export function chartDataJson(
  bars: readonly OHLCV[],
  symbol: string,
  timeframe: string,
  lineage: "exchange" | "simulation" | undefined,
  scope: ChartDataExportScope = "all",
): string {
  const source = chartDataSourceLabel(symbol, lineage);
  const payload = {
    symbol,
    timeframe,
    source,
    scope,
    exportedAt: new Date().toISOString(),
    count: bars.length,
    range: bars.length
      ? {
          from: new Date(bars[0].time).toISOString(),
          to: new Date(bars[bars.length - 1].time).toISOString(),
        }
      : null,
    candles: bars.map((bar) => ({
      time: new Date(bar.time).toISOString(),
      timestampMs: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

