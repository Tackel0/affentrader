import { POPULAR, POPULAR_BY_EXCHANGE, STOCK_EXCHANGES } from "./markets";
import { isYahooTicker } from "./symbolId";

/**
 * Large, liquid US listings screened by default. This is a fixed starting list
 * of well-known tickers, not a live index membership: no free source publishes
 * constituents or market caps, so edits belong here.
 */
const US_LARGE_CAPS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "BRK-B", "JPM",
  "LLY", "V", "UNH", "XOM", "MA", "COST", "HD", "PG", "JNJ", "WMT",
  "NFLX", "BAC", "ABBV", "CRM", "ORCL", "CVX", "KO", "AMD", "MRK", "PEP",
  "ADBE", "TMO", "LIN", "ACN", "MCD", "CSCO", "ABT", "WFC", "DIS", "GE",
  "IBM", "INTU", "QCOM", "TXN", "CAT", "VZ", "AMGN", "PM", "NOW", "ISRG",
  "AMAT", "BKNG", "GS", "RTX", "UBER", "SPGI", "T", "NEE", "PFE", "LOW",
  "HON", "UNP", "BLK", "AXP", "MS", "PLTR", "ETN", "C", "SCHW", "COP",
  "SYK", "LMT", "ELV", "MU", "PANW", "ANET", "KLAC", "LRCX", "ADI", "DE",
  "MRSH", "BX", "CB", "GILD", "SBUX", "TJX", "VRTX", "BA", "CMG", "MDT",
  "COIN", "MSTR", "SHOP", "SNOW", "XYZ", "ABNB", "PYPL", "INTC", "NKE", "F",
];

export interface StockUniverse {
  id: string;
  label: string;
  tickers: string[];
}

function unique(list: string[]): string[] {
  return [...new Set(list.filter((t) => isYahooTicker(t)))];
}

/** Tickers to screen for an exchange id from {@link STOCK_EXCHANGES}; US also covers the curated ETFs. */
export function universeFor(exchangeId: string): StockUniverse | null {
  const exchange = STOCK_EXCHANGES.find((e) => e.id === exchangeId);
  if (!exchange) return null;
  if (exchange.id === "us")
    return {
      id: exchange.id,
      label: exchange.label,
      tickers: unique([...US_LARGE_CAPS, ...POPULAR.stock.map((p) => p.ticker), ...POPULAR.etf.map((p) => p.ticker)]),
    };
  const listed = POPULAR_BY_EXCHANGE[exchange.id] ?? [];
  return listed.length ? { id: exchange.id, label: exchange.label, tickers: unique(listed.map((p) => p.ticker)) } : null;
}

export const STOCK_UNIVERSE_IDS = STOCK_EXCHANGES.map((e) => e.id).filter((id) => universeFor(id) !== null);
