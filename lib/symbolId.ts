/**
 * Symbol identifiers. Binance spot pairs are plain (`BTCUSDT`). Everything
 * else carries a provider prefix: `YF:AAPL`, `YF:EURUSD=X`, `YF:^GSPC`
 * (Yahoo Finance tickers: stocks, ETFs, indices, forex) and `HL:BTC`,
 * `HL:xyz:TSLA` (Hyperliquid perpetuals, including builder-deployed markets).
 */
export type Provider = "binance" | "yahoo" | "hyperliquid" | "alpaca" | "kraken" | "bybit";
export type BybitCategory = "spot" | "linear";
const BYBIT_PREFIX = "BYBIT:";
export const KRAKEN_PREFIX = "KRK:";
export const KRAKEN_PAIR = /^[A-Z0-9]{1,16}\/[A-Z0-9]{1,16}$/;
export const IEX_PREFIX = "IEX:";
export const SIP_PREFIX = "SIP:";
export const IEX_TICKER = /^[A-Z][A-Z0-9.\-]{0,14}$/;
export function iexSymbol(ticker: string): string { return `${IEX_PREFIX}${ticker.trim().toUpperCase()}`; }
export function sipSymbol(ticker: string): string { return `${SIP_PREFIX}${ticker.trim().toUpperCase()}`; }

export const BINANCE_SYMBOL = /^[A-Z0-9]{4,24}$/;
export function bybitSymbol(category: BybitCategory, pair: string): string {
  return `${BYBIT_PREFIX}${category.toUpperCase()}:${pair}`;
}

export function bybitMarket(symbol: string): { category: BybitCategory; pair: string } | null {
  if (!symbol.startsWith(BYBIT_PREFIX)) return null;
  const [, category, pair, extra] = symbol.split(":");
  if (extra !== undefined || (category !== "SPOT" && category !== "LINEAR") || !pair
    || !BINANCE_SYMBOL.test(pair) || !["USDT", "USDC"].includes(spotQuoteCurrency(pair))) return null;
  return { category: category === "SPOT" ? "spot" : "linear", pair };
}
const YAHOO_TICKER = /^[A-Z0-9^][A-Z0-9._=^-]{0,19}$/;
export const YAHOO_PREFIX = "YF:";
export const HYPERLIQUID_PREFIX = "HL:";
/** A coin (`BTC`, `kPEPE`) optionally behind a builder dex (`xyz:TSLA`). */
const HL_COIN = /^(?:[a-z0-9]{2,12}:)?[A-Za-z0-9_-]{1,24}$/;

export function providerOf(symbol: string): Provider {
  if (symbol.startsWith(BYBIT_PREFIX)) return "bybit";
  if (symbol.startsWith(KRAKEN_PREFIX)) return "kraken";
  if (symbol.startsWith(IEX_PREFIX) || symbol.startsWith(SIP_PREFIX)) return "alpaca";
  if (symbol.startsWith(YAHOO_PREFIX)) return "yahoo";
  if (symbol.startsWith(HYPERLIQUID_PREFIX)) return "hyperliquid";
  return "binance";
}

export function tickerOf(symbol: string): string {
  if (symbol.startsWith(BYBIT_PREFIX)) return symbol.slice(symbol.lastIndexOf(":") + 1);
  if (symbol.startsWith(KRAKEN_PREFIX)) return symbol.slice(KRAKEN_PREFIX.length);
  if (symbol.startsWith(IEX_PREFIX) || symbol.startsWith(SIP_PREFIX)) return symbol.slice(4);
  if (symbol.startsWith(YAHOO_PREFIX)) return symbol.slice(YAHOO_PREFIX.length);
  if (symbol.startsWith(HYPERLIQUID_PREFIX)) return symbol.slice(HYPERLIQUID_PREFIX.length);
  return symbol;
}

export function hyperliquidSymbol(coin: string): string {
  return `${HYPERLIQUID_PREFIX}${coin.trim()}`;
}

export function isHyperliquidCoin(coin: string): boolean {
  return HL_COIN.test(coin);
}

/** Builder dex a coin belongs to (`xyz` for `xyz:TSLA`), or "" for the main dex. */
export function hyperliquidDex(coin: string): string {
  const i = coin.indexOf(":");
  return i > 0 ? coin.slice(0, i) : "";
}

export function yahooSymbol(ticker: string): string {
  return `${YAHOO_PREFIX}${ticker.trim().toUpperCase()}`;
}

export function isYahooTicker(ticker: string): boolean {
  return YAHOO_TICKER.test(ticker);
}

/** True for any symbol the application can chart. */
export function isSymbolId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.startsWith(BYBIT_PREFIX)) return bybitMarket(value) !== null;
  if (value.startsWith(IEX_PREFIX) || value.startsWith(SIP_PREFIX)) return IEX_TICKER.test(value.slice(4));
  if (value.startsWith(YAHOO_PREFIX)) return YAHOO_TICKER.test(value.slice(YAHOO_PREFIX.length));
  if (value.startsWith(HYPERLIQUID_PREFIX)) return HL_COIN.test(value.slice(HYPERLIQUID_PREFIX.length));
  if (value.startsWith(KRAKEN_PREFIX)) return KRAKEN_PAIR.test(tickerOf(value));
  return BINANCE_SYMBOL.test(value);
}

export type InstrumentType = "crypto" | "stock" | "etf" | "index" | "forex" | "future" | "other";

export interface SymbolInfo {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  type: InstrumentType;
  /** Quotes arrive with a delay (exchange rules, free sources). */
  delayed: boolean;
  /** IANA zone of the exchange, when known. */
  timezone?: string;
}

const registry = new Map<string, SymbolInfo>();

export function registerSymbolInfo(info: SymbolInfo) {
  registry.set(info.symbol, info);
}

export function symbolInfo(symbol: string): SymbolInfo | undefined {
  return registry.get(symbol);
}

/** Suffixes supported by spot symbol normalization; unknown pairs have no assumed currency. */
export function spotQuoteCurrency(symbol: string): string {
  return ["FDUSD", "USDT", "USDC", "BUSD", "BTC", "ETH", "BNB", "EUR", "TRY"].find(currency => symbol.endsWith(currency) && symbol.length > currency.length) ?? "";
}

const YAHOO_TYPES: Record<string, InstrumentType> = {
  EQUITY: "stock",
  ETF: "etf",
  MUTUALFUND: "etf",
  INDEX: "index",
  CURRENCY: "forex",
  FUTURE: "future",
  CRYPTOCURRENCY: "crypto",
};

export function instrumentType(quoteType: string | undefined): InstrumentType {
  return YAHOO_TYPES[(quoteType ?? "").toUpperCase()] ?? "other";
}

/** Label for headers and tables: Binance pairs stay as written, other venues lose their prefix. */
export function symbolLabel(symbol: string): string {
  return providerOf(symbol) === "binance" ? symbol : displayTicker(symbol);
}

/** Short display label for a symbol, without the provider prefix. */
export function displayTicker(symbol: string): string {
  switch (providerOf(symbol)) {
    case "bybit": return tickerOf(symbol);
    case "kraken":
    case "alpaca": return tickerOf(symbol);
    case "yahoo":
      return tickerOf(symbol).replace(/=X$/, "").replace(/=F$/, "");
    case "hyperliquid":
      return tickerOf(symbol).replace(/^[a-z0-9]+:/, "");
    default:
      return symbol.replace(/USDT$/, "");
  }
}
