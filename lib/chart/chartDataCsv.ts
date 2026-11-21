import type { OHLCV } from "@/types/trading";
import { providerOf, SIP_PREFIX, type Provider } from "@/lib/symbolId";
const providers: Record<Provider, string> = { binance: "Binance", kraken: "Kraken", hyperliquid: "Hyperliquid", yahoo: "Yahoo Finance", alpaca: "Alpaca IEX", bybit: "Bybit" };
/** Candle lineage belongs to this loaded symbol/interval, not the latest quote. */
export function chartDataCsv(bars: readonly OHLCV[], symbol: string, timeframe: string, lineage: "exchange" | "simulation" | undefined): string {
  const source = lineage === "simulation" ? "simulation" : lineage === "exchange" ? symbol.startsWith(SIP_PREFIX) ? "Alpaca SIP" : providers[providerOf(symbol)] : "unknown";
  return ["time,open,high,low,close,volume,symbol,timeframe,source", ...bars.map(bar => [new Date(bar.time).toISOString(), bar.open, bar.high, bar.low, bar.close, bar.volume, symbol, timeframe, source].join(","))].join("\r\n");
}
