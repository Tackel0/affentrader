export const TERMINAL_MARKETS = [
  { ticker: "^GSPC", label: "S&P 500", group: "Indices" },
  { ticker: "^IXIC", label: "Nasdaq Composite", group: "Indices" },
  { ticker: "^GDAXI", label: "DAX", group: "Indices" },
  { ticker: "^FTSE", label: "FTSE 100", group: "Indices" },
  { ticker: "^N225", label: "Nikkei 225", group: "Indices" },
  { ticker: "EURUSD=X", label: "EUR / USD", group: "FX" },
  { ticker: "GBPUSD=X", label: "GBP / USD", group: "FX" },
  { ticker: "JPY=X", label: "USD / JPY", group: "FX" },
  { ticker: "GC=F", label: "Gold futures", group: "Commodities" },
  { ticker: "CL=F", label: "WTI futures", group: "Commodities" },
  { ticker: "SI=F", label: "Silver futures", group: "Commodities" },
] as const;

export type TerminalMarket = (typeof TERMINAL_MARKETS)[number];
export interface TerminalMarketQuote {
  session: string;
  currency: string;
  close: number;
  changes: Record<1 | 5 | 20, number | null>;
}
export type TerminalMarketRow = TerminalMarket & { quote: TerminalMarketQuote | null };
