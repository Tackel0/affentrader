import { bybitSymbol, providerOf, registerSymbolInfo, tickerOf, type InstrumentType, type Provider, type SymbolInfo } from "./symbolId";
import { isSection } from "./watchlist";
import type { HyperliquidAsset } from "./market/hyperliquid";
import type { MarketSymbol } from "@/types/trading";

export const LIQUID_MARKETS_ID = "default-us-markets-commodities";
export const LIQUID_MARKETS_NAME = "US-Märkte & Rohstoffe";

export const WATCHLIST_VENUE_RULES: Record<"crypto" | "stock" | "index" | "commodity", readonly Provider[]> = {
  crypto: ["binance"],
  stock: ["binance", "hyperliquid", "bybit", "yahoo"],
  index: ["hyperliquid", "yahoo"],
  commodity: ["hyperliquid", "yahoo"],
};

type Listing = readonly [ticker: string, name: string, exchange: string];
type Group = { name: string; type: "stock" | "etf" | "future"; listings: readonly Listing[] };

// US primary listings and US futures benchmarks with live venue resolution
// (Stocks: Binance -> Hyperliquid -> Bybit -> Yahoo; Indices & Commodities: Hyperliquid -> Yahoo).
export const LIQUID_MARKET_GROUPS: readonly Group[] = [
  { name: "Magnificent 7", type: "stock", listings: [
    ["NVDA", "Nvidia", "NASDAQ"],
    ["AAPL", "Apple", "NASDAQ"],
    ["MSFT", "Microsoft", "NASDAQ"],
    ["AMZN", "Amazon", "NASDAQ"],
    ["GOOGL", "Alphabet Class A", "NASDAQ"],
    ["META", "Meta Platforms", "NASDAQ"],
    ["TSLA", "Tesla", "NASDAQ"],
  ] },
  { name: "Halbleiter", type: "stock", listings: [
    ["AVGO", "Broadcom", "NASDAQ"],
    ["AMD", "Advanced Micro Devices", "NASDAQ"],
    ["TSM", "Taiwan Semiconductor ADR", "NYSE"],
    ["MU", "Micron Technology", "NASDAQ"],
    ["INTC", "Intel", "NASDAQ"],
    ["QCOM", "Qualcomm", "NASDAQ"],
    ["ASML", "ASML US listing", "NASDAQ"],
    ["ARM", "Arm Holdings ADR", "NASDAQ"],
    ["AMAT", "Applied Materials", "NASDAQ"],
    ["LRCX", "Lam Research", "NASDAQ"],
    ["KLAC", "KLA", "NASDAQ"],
    ["TXN", "Texas Instruments", "NASDAQ"],
    ["ADI", "Analog Devices", "NASDAQ"],
    ["MRVL", "Marvell Technology", "NASDAQ"],
    ["NXPI", "NXP Semiconductors", "NASDAQ"],
    ["ON", "onsemi", "NASDAQ"],
  ] },
  { name: "Rohstoff-Futures", type: "future", listings: [
    ["CL=F", "WTI-Öl", "NYMEX"],
    ["GC=F", "Gold", "COMEX"],
    ["SI=F", "Silber", "COMEX"],
    ["NG=F", "Erdgas", "NYMEX"],
    ["HG=F", "Kupfer", "COMEX"],
    ["PL=F", "Platin", "NYMEX"],
    ["ZC=F", "Mais", "CBOT"],
    ["ZW=F", "Weizen", "CBOT"],
    ["ZS=F", "Soja", "CBOT"],
  ] },
  { name: "Index- & Sektor-ETFs", type: "etf", listings: [
    ["SPY", "SPDR S&P 500 ETF", "NYSE Arca"],
    ["QQQ", "Invesco Nasdaq 100 ETF", "NASDAQ"],
    ["IWM", "iShares Russell 2000 ETF", "NYSE Arca"],
    ["DIA", "SPDR Dow Jones ETF", "NYSE Arca"],
    ["VOO", "Vanguard S&P 500 ETF", "NYSE Arca"],
    ["SMH", "VanEck Semiconductor ETF", "NASDAQ"],
    ["SOXX", "iShares Semiconductor ETF", "NASDAQ"],
    ["XLK", "Technology Select Sector SPDR", "NYSE Arca"],
    ["XLF", "Financial Select Sector SPDR", "NYSE Arca"],
    ["XLE", "Energy Select Sector SPDR", "NYSE Arca"],
    ["TLT", "iShares 20+ Year Treasury Bond ETF", "NASDAQ"],
  ] },
  { name: "Rohstoff-ETPs", type: "etf", listings: [
    ["GLD", "SPDR Gold Shares", "NYSE Arca"],
    ["SLV", "iShares Silver Trust", "NYSE Arca"],
    ["USO", "United States Oil Fund", "NYSE Arca"],
    ["UNG", "United States Natural Gas Fund", "NYSE Arca"],
  ] },
  { name: "Software & Internet", type: "stock", listings: [
    ["PLTR", "Palantir", "NASDAQ"],
    ["NFLX", "Netflix", "NASDAQ"],
    ["ORCL", "Oracle", "NYSE"],
    ["CRM", "Salesforce", "NYSE"],
    ["NOW", "ServiceNow", "NYSE"],
    ["UBER", "Uber", "NYSE"],
    ["ADBE", "Adobe", "NASDAQ"],
    ["CRWD", "CrowdStrike", "NASDAQ"],
    ["PANW", "Palo Alto Networks", "NASDAQ"],
    ["COIN", "Coinbase", "NASDAQ"],
  ] },
  { name: "Finanzen", type: "stock", listings: [
    ["JPM", "JPMorgan Chase", "NYSE"],
    ["BRK-B", "Berkshire Hathaway Class B", "NYSE"],
    ["BAC", "Bank of America", "NYSE"],
    ["WFC", "Wells Fargo", "NYSE"],
    ["C", "Citigroup", "NYSE"],
    ["GS", "Goldman Sachs", "NYSE"],
    ["MS", "Morgan Stanley", "NYSE"],
    ["V", "Visa", "NYSE"],
    ["MA", "Mastercard", "NYSE"],
    ["HOOD", "Robinhood Markets", "NASDAQ"],
  ] },
  { name: "Konsum & Gesundheit", type: "stock", listings: [
    ["WMT", "Walmart", "NASDAQ"],
    ["COST", "Costco", "NASDAQ"],
    ["HD", "Home Depot", "NYSE"],
    ["MCD", "McDonald's", "NYSE"],
    ["KO", "Coca-Cola", "NYSE"],
    ["PEP", "PepsiCo", "NASDAQ"],
    ["NKE", "Nike", "NYSE"],
    ["LLY", "Eli Lilly", "NYSE"],
    ["UNH", "UnitedHealth", "NYSE"],
    ["JNJ", "Johnson & Johnson", "NYSE"],
    ["ABBV", "AbbVie", "NYSE"],
    ["MRK", "Merck & Co.", "NYSE"],
  ] },
  { name: "Energie, Bergbau & Industrie", type: "stock", listings: [
    ["XOM", "Exxon Mobil", "NYSE"],
    ["CVX", "Chevron", "NYSE"],
    ["COP", "ConocoPhillips", "NYSE"],
    ["SLB", "SLB", "NYSE"],
    ["OXY", "Occidental Petroleum", "NYSE"],
    ["FCX", "Freeport-McMoRan", "NYSE"],
    ["NEM", "Newmont", "NYSE"],
    ["GE", "GE Aerospace", "NYSE"],
    ["CAT", "Caterpillar", "NYSE"],
    ["BA", "Boeing", "NYSE"],
    ["RTX", "RTX", "NYSE"],
  ] },
];

export const LIQUID_MARKETS_SIZE = LIQUID_MARKET_GROUPS.reduce((count, group) => count + group.listings.length, 0);

const listings = new Map<string, SymbolInfo>();
const resolvedListings = new Map<string, SymbolInfo>();
const presetByTicker = new Map<string, { ticker: string; name: string; exchange: string; type: InstrumentType }>();

for (const group of LIQUID_MARKET_GROUPS) {
  for (const [ticker, name, exchange] of group.listings) {
    const symbol = `YF:${ticker}`;
    listings.set(symbol, { symbol, name, exchange, currency: "USD", type: group.type, delayed: true });
    presetByTicker.set(ticker.toUpperCase(), { ticker: ticker.toUpperCase(), name, exchange, type: group.type });
  }
}

export const liquidMarketListing = (symbol: string): SymbolInfo | undefined =>
  listings.get(symbol) ?? resolvedListings.get(symbol);

/** Hyperliquid builder-DEX underlying aliases for commodities and indices. */
const HYPERLIQUID_ALIASES: Record<string, readonly string[]> = {
  "CL=F": ["CL", "USOIL", "WTI", "OIL", "BRENTOIL"],
  "GC=F": ["GOLD", "XAU"],
  "SI=F": ["SILVER", "XAG"],
  "NG=F": ["NATGAS", "NG"],
  "HG=F": ["COPPER", "HG"],
  "PL=F": ["PLATINUM", "PL"],
  "ZC=F": ["CORN", "ZC"],
  "ZW=F": ["WHEAT", "ZW"],
  "ZS=F": ["SOY", "SOYBEAN", "ZS"],
  "^GSPC": ["SP500", "SPX500", "USA500", "US500"],
  "^NDX": ["XYZ100", "NDX", "NAS100", "USTEC"],
  "^IXIC": ["XYZ100", "NDX", "NAS100", "USTEC"],
  "^DJI": ["US30", "DJI"],
  "^RUT": ["US2000", "RUT"],
  SPY: ["SP500", "SPX500", "USA500", "US500", "SPY"],
  QQQ: ["XYZ100", "NDX", "NAS100", "USTEC", "QQQ"],
  IWM: ["US2000", "RUT", "IWM"],
  DIA: ["US30", "DJI", "DIA"],
};

/** Short tickers that collide with unrelated crypto tokens on spot/perp CEXes. */
const CRYPTO_TICKER_COLLISIONS = new Set([
  "A", "B", "C", "D", "F", "G", "H", "J", "K", "L", "M", "N", "O", "P", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
  "ON", "MA", "BA", "GS", "KO", "HD", "MU", "GE", "CAT", "NOW", "COST", "ICE", "COMP", "AMP", "GAS", "KEY",
  "ONE", "FLOW", "HOOK", "HIGH", "MAGIC", "MBOX", "SAND", "RUNE", "SUN", "WIN", "DASH", "ACE", "AR",
]);

const KNOWN_CRYPTO_CATEGORIES = new Set(["Layer 1", "DeFi", "Meme", "Infrastructure"]);

export interface WatchlistVenueCatalogs {
  binance?: readonly (Pick<MarketSymbol, "symbol" | "base" | "name"> & { category?: string })[];
  hyperliquid?: readonly Pick<HyperliquidAsset, "coin" | "symbol" | "name" | "dex" | "dexName" | "volume">[];
  bybit?: readonly { category: "spot" | "linear"; ticker: { pair: string; turnover: number } }[];
}

function bestHyperliquidMatch(
  candidates: readonly string[],
  assets: readonly Pick<HyperliquidAsset, "coin" | "symbol" | "name" | "dex" | "dexName" | "volume">[],
) {
  const wanted = new Set(candidates.map(c => c.toUpperCase()));
  const matches = assets
    .filter(asset => Boolean(asset.dex) && wanted.has(asset.name.toUpperCase()))
    .sort((a, b) => {
      const rankA = candidates.findIndex(c => c.toUpperCase() === a.name.toUpperCase());
      const rankB = candidates.findIndex(c => c.toUpperCase() === b.name.toUpperCase());
      return rankA - rankB || b.volume - a.volume;
    });
  return matches[0] ?? null;
}

function bestBinanceEquityMatch(
  ticker: string,
  catalog: readonly (Pick<MarketSymbol, "symbol" | "base" | "name"> & { category?: string })[],
) {
  const upper = ticker.toUpperCase();
  if (CRYPTO_TICKER_COLLISIONS.has(upper) || upper.includes("=") || upper.startsWith("^")) return null;
  const preferredPairs = [`${upper}USDT`, `${upper}USDC`];
  for (const pair of preferredPairs) {
    const found = catalog.find(
      item => item.symbol.toUpperCase() === pair && !(item.category && KNOWN_CRYPTO_CATEGORIES.has(item.category)),
    );
    if (found) return found;
  }
  return null;
}

function bestBybitEquityMatch(
  ticker: string,
  catalog: readonly { category: "spot" | "linear"; ticker: { pair: string; turnover: number } }[],
) {
  const upper = ticker.toUpperCase();
  if (CRYPTO_TICKER_COLLISIONS.has(upper) || upper.includes("=") || upper.startsWith("^")) return null;
  const pairs = new Set([`${upper}USDT`, `${upper}USDC`]);
  const matches = catalog
    .filter(item => pairs.has(item.ticker.pair.toUpperCase()))
    .sort((a, b) => {
      if (a.category !== b.category) return a.category === "linear" ? -1 : 1;
      return b.ticker.turnover - a.ticker.turnover;
    });
  return matches[0] ?? null;
}

function classifyPresetAsset(ticker: string, type?: InstrumentType): "stock" | "index" | "commodity" {
  const upper = ticker.toUpperCase();
  if (type === "future" || upper.endsWith("=F")) return "commodity";
  if (type === "index" || type === "etf" || upper.startsWith("^")) return "index";
  return "stock";
}

function rememberResolvedListing(symbol: string, info: SymbolInfo) {
  resolvedListings.set(symbol, info);
  registerSymbolInfo(info);
}

/**
 * Resolves a Yahoo equity/index/commodity symbol to the user's preferred live venue:
 * - Stocks: Binance -> Hyperliquid -> Bybit -> Yahoo fallback
 * - Indices & Commodities: Hyperliquid -> Yahoo fallback
 */
export function resolvePreferredWatchlistSymbol(
  symbol: string,
  catalogs: WatchlistVenueCatalogs,
): string {
  if (providerOf(symbol) !== "yahoo") return symbol;
  const ticker = tickerOf(symbol).toUpperCase();
  const preset = presetByTicker.get(ticker);
  const kind = classifyPresetAsset(ticker, preset?.type);
  const displayName = preset?.name ?? ticker;

  if (kind === "stock") {
    const binance = catalogs.binance?.length ? bestBinanceEquityMatch(ticker, catalogs.binance) : null;
    if (binance) {
      rememberResolvedListing(binance.symbol, {
        symbol: binance.symbol,
        name: displayName,
        exchange: "Binance",
        currency: "USDT",
        type: "stock",
        delayed: false,
      });
      return binance.symbol;
    }

    const hl = catalogs.hyperliquid?.length ? bestHyperliquidMatch([ticker], catalogs.hyperliquid) : null;
    if (hl) {
      rememberResolvedListing(hl.symbol, {
        symbol: hl.symbol,
        name: displayName,
        exchange: hl.dexName ? `Hyperliquid · ${hl.dexName}` : "Hyperliquid",
        currency: "USD",
        type: "stock",
        delayed: false,
      });
      return hl.symbol;
    }

    const bybit = catalogs.bybit?.length ? bestBybitEquityMatch(ticker, catalogs.bybit) : null;
    if (bybit) {
      const id = bybitSymbol(bybit.category, bybit.ticker.pair);
      rememberResolvedListing(id, {
        symbol: id,
        name: displayName,
        exchange: bybit.category === "linear" ? "Bybit · Perp" : "Bybit · Spot",
        currency: "USDT",
        type: "stock",
        delayed: false,
      });
      return id;
    }
    return symbol;
  }

  // Indices & Commodities -> Hyperliquid first, Yahoo fallback.
  const aliases = HYPERLIQUID_ALIASES[ticker] ?? [ticker];
  const hl = catalogs.hyperliquid?.length ? bestHyperliquidMatch(aliases, catalogs.hyperliquid) : null;
  if (hl) {
    rememberResolvedListing(hl.symbol, {
      symbol: hl.symbol,
      name: displayName,
      exchange: hl.dexName ? `Hyperliquid · ${hl.dexName}` : "Hyperliquid",
      currency: "USD",
      type: kind === "commodity" ? "future" : preset?.type ?? "index",
      delayed: false,
    });
    return hl.symbol;
  }

  return symbol;
}

/**
 * Maps a watchlist's entries to preferred live venues while preserving sections,
 * order, flags, and avoiding duplicate symbol IDs.
 */
export function resolveWatchlistEntries(
  entries: readonly string[],
  catalogs: WatchlistVenueCatalogs,
): { entries: string[]; replacements: Map<string, string>; changed: number } {
  const seen = new Set<string>();
  const replacements = new Map<string, string>();
  const next: string[] = [];
  let changed = 0;

  for (const entry of entries) {
    if (isSection(entry)) {
      next.push(entry);
      continue;
    }
    const candidate = resolvePreferredWatchlistSymbol(entry, catalogs);
    const chosen = candidate !== entry && !seen.has(candidate) ? candidate : entry;
    if (seen.has(chosen)) continue;
    seen.add(chosen);
    next.push(chosen);
    if (chosen !== entry) {
      replacements.set(entry, chosen);
      changed++;
    }
  }
  return { entries: next, replacements, changed };
}

