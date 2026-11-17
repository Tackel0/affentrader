import type { MarketSymbol, Timeframe } from "@/types/trading";
import { intervalMs, PRESET_INTERVALS } from "@/lib/market/intervals";
import { displayTicker, providerOf, symbolInfo, spotQuoteCurrency, tickerOf } from "@/lib/symbolId";
/** Intervals that are always aggregated for every symbol. */
export const TIMEFRAMES: Timeframe[] = [...PRESET_INTERVALS];
/**
 * Duration lookup for any valid interval id, including custom ones
 * (`INTERVAL_MS["45s"]`). Tick intervals have no duration and report 1s.
 */
export const INTERVAL_MS: Record<Timeframe, number> = new Proxy(
  {} as Record<Timeframe, number>,
  { get: (_, key) => (typeof key === "string" ? intervalMs(key) : undefined) },
);
export const SYMBOLS: MarketSymbol[] = [
  {
    symbol: "BTCUSDT",
    base: "BTC",
    name: "Bitcoin",
    category: "Layer 1",
    seedPrice: 67432.8,
    color: "#f7931a",
  },
  {
    symbol: "ETHUSDT",
    base: "ETH",
    name: "Ethereum",
    category: "Layer 1",
    seedPrice: 3518.42,
    color: "#8098ee",
  },
  {
    symbol: "SOLUSDT",
    base: "SOL",
    name: "Solana",
    category: "Layer 1",
    seedPrice: 172.36,
    color: "#a58aff",
  },
  {
    symbol: "BNBUSDT",
    base: "BNB",
    name: "BNB",
    category: "Layer 1",
    seedPrice: 592.18,
    color: "#f3ba2f",
  },
  {
    symbol: "XRPUSDT",
    base: "XRP",
    name: "XRP",
    category: "Layer 1",
    seedPrice: 0.5328,
    color: "#d5d9e2",
  },
  {
    symbol: "DOGEUSDT",
    base: "DOGE",
    name: "Dogecoin",
    category: "Meme",
    seedPrice: 0.16342,
    color: "#c6a758",
  },
  {
    symbol: "AVAXUSDT",
    base: "AVAX",
    name: "Avalanche",
    category: "Layer 1",
    seedPrice: 36.85,
    color: "#e84142",
  },
  {
    symbol: "LINKUSDT",
    base: "LINK",
    name: "Chainlink",
    category: "Infrastructure",
    seedPrice: 17.62,
    color: "#426cdb",
  },
  {
    symbol: "ADAUSDT",
    base: "ADA",
    name: "Cardano",
    category: "Layer 1",
    seedPrice: 0.4623,
    color: "#437fe8",
  },
  {
    symbol: "DOTUSDT",
    base: "DOT",
    name: "Polkadot",
    category: "Infrastructure",
    seedPrice: 7.23,
    color: "#e6007a",
  },
  {
    symbol: "UNIUSDT",
    base: "UNI",
    name: "Uniswap",
    category: "DeFi",
    seedPrice: 10.31,
    color: "#ff479d",
  },
  {
    symbol: "AAVEUSDT",
    base: "AAVE",
    name: "Aave",
    category: "DeFi",
    seedPrice: 104.58,
    color: "#b18ec6",
  },
  {
    symbol: "NEARUSDT",
    base: "NEAR",
    name: "NEAR Protocol",
    category: "Layer 1",
    seedPrice: 6.34,
    color: "#63c4b8",
  },
  {
    symbol: "LTCUSDT",
    base: "LTC",
    name: "Litecoin",
    category: "Layer 1",
    seedPrice: 83.76,
    color: "#7298d5",
  },
  {
    symbol: "ATOMUSDT",
    base: "ATOM",
    name: "Cosmos",
    category: "Infrastructure",
    seedPrice: 8.39,
    color: "#9596b5",
  },
  {
    symbol: "SHIBUSDT",
    base: "SHIB",
    name: "Shiba Inu",
    category: "Meme",
    seedPrice: 0.0000247,
    color: "#f49a55",
  },
];
const PALETTE = ["#2962ff", "#089981", "#f7931a", "#9c27b0", "#e91e63", "#00bcd4", "#ff7043", "#8bc34a"];
export function getSymbol(symbol: string): MarketSymbol {
  const known = SYMBOLS.find((s) => s.symbol === symbol);
  if (known) return known;
  if (providerOf(symbol) !== "binance") {
    const info = symbolInfo(symbol);
    const ticker = displayTicker(symbol);
    const hash = [...symbol].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
    return {
      symbol,
      base: ticker,
      name: info?.name ?? ticker,
      category: "All",
      // Never used to synthesise prices for non-crypto markets.
      seedPrice: 1,
      color: PALETTE[hash % PALETTE.length],
    };
  }
  return {
    symbol,
    base: spotQuoteCurrency(symbol) ? symbol.slice(0, -spotQuoteCurrency(symbol).length) : symbol,
    name: spotQuoteCurrency(symbol) ? symbol.slice(0, -spotQuoteCurrency(symbol).length) : symbol,
    category: "All",
    seedPrice: 1,
    color: "#98a2b3",
  };
}
export function formatPrice(value: number, compact = false): string {
  const magnitude = Math.abs(value);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: compact ? 0 : magnitude >= 1 ? 2 : 4,
    maximumFractionDigits:
      magnitude >= 100 ? 2 : magnitude >= 1 ? 4 : magnitude < 0.001 ? 8 : 5,
    ...(compact ? { notation: "compact", maximumFractionDigits: 2 } : {}),
  }).format(value);
}
export function formatVolume(value: number): string {
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits:
      Math.abs(value) < 0.01 ? 5 : Math.abs(value) < 1 ? 4 : 2,
  }).format(value);
}

export interface SymbolDescription {
  /** Long title, e.g. "Bitcoin / TetherUS" or "Apple Inc.". */
  title: string;
  /** Compact label for small panes. */
  short: string;
  venue: string;
  quote: string;
  /** Large watermark text drawn behind the chart. */
  watermark: string;
  caption: string;
  delayed: boolean;
  crypto: boolean;
  /** Data source name for status text: Binance, Hyperliquid or Yahoo Finance. */
  feed: string;
  /** True when the venue streams individual trades and order-book depth. */
  streams: boolean;
}

export function describeSymbol(symbol: string): SymbolDescription {
  const asset = getSymbol(symbol);
  if (providerOf(symbol) === "kraken") {
    const [base, quote] = tickerOf(symbol).split("/");
    return { title: `${base} / ${quote}`, short: `${base}/${quote}`, venue: "Kraken", quote,
      watermark: base, caption: "KRAKEN · SPOT", delayed: false, crypto: true, feed: "Kraken", streams: true };
  }
  if (providerOf(symbol) === "alpaca") {
    const sip = symbol.startsWith("SIP:");
    return { title: asset.name, short: asset.base, venue: sip ? "SIP · Alpaca" : "IEX · Alpaca", quote: "USD", watermark: asset.base, caption: sip ? "US EQUITY · DELAYED SIP HISTORY · RAW" : "US EQUITY · IEX ONLY · RAW", delayed: sip, crypto: false, feed: sip ? "Alpaca SIP history" : "Alpaca IEX", streams: false };
  }
  if (providerOf(symbol) === "hyperliquid") {
    const info = symbolInfo(symbol);
    return {
      title: info?.name ?? `${asset.base} perpetual`,
      short: asset.base,
      venue: info?.exchange || "Hyperliquid",
      quote: "USD",
      watermark: asset.base,
      caption: `${info?.exchange || "Hyperliquid"} · PERP`,
      delayed: false,
      crypto: false,
      feed: "Hyperliquid",
      streams: true,
    };
  }
  if (providerOf(symbol) === "yahoo") {
    const info = symbolInfo(symbol);
    return {
      title: asset.name,
      short: asset.base,
      venue: info?.exchange || "Yahoo Finance",
      quote: info?.currency ?? "",
      watermark: asset.base,
      caption: info ? `${info.type.toUpperCase()} · ${info.exchange}` : "YAHOO FINANCE",
      delayed: info?.delayed ?? true,
      crypto: false,
      feed: "Yahoo Finance",
      streams: false,
    };
  }
  return {
    title: `${asset.name} / ${spotQuoteCurrency(symbol) === "USDT" ? "TetherUS" : spotQuoteCurrency(symbol)}`,
    short: symbol,
    venue: "BINANCE",
    quote: spotQuoteCurrency(symbol),
    watermark: symbol,
    caption: "BINANCE · SPOT",
    delayed: false,
    crypto: true,
    feed: "Binance",
    streams: true,
  };
}
