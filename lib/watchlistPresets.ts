import type { SymbolInfo } from "./symbolId";

export const LIQUID_MARKETS_ID = "default-us-markets-commodities";
export const LIQUID_MARKETS_NAME = "US-Märkte & Rohstoffe";

type Listing = readonly [ticker: string, name: string, exchange: string];
type Group = { name: string; type: "stock" | "etf" | "future"; listings: readonly Listing[] };

// US primary listings and US futures benchmarks supported by the public Yahoo feed.
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
for (const group of LIQUID_MARKET_GROUPS) {
  for (const [ticker, name, exchange] of group.listings) {
    const symbol = `YF:${ticker}`;
    listings.set(symbol, { symbol, name, exchange, currency: "USD", type: group.type, delayed: true });
  }
}

export const liquidMarketListing = (symbol: string): SymbolInfo | undefined => listings.get(symbol);
