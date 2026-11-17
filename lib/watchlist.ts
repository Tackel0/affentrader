import type { Quote, WatchFlag } from "@/types/trading";
import { baseVolume, notionalVolume, quoteRange } from "./market/quoteMetrics";
import { hyperliquidSymbol, isHyperliquidCoin, isYahooTicker, yahooSymbol } from "./symbolId";

/** Hard limit per list, matching TradingView Premium. */
export const MAX_LIST_SYMBOLS = 1000;
export const MAX_LISTS = 100;
export const SECTION_PREFIX = "###";

export const FLAG_COLORS: Record<WatchFlag, string> = {
  red: "#f23645",
  orange: "#ff9800",
  yellow: "#fdd835",
  green: "#089981",
  blue: "#2962ff",
  purple: "#9c27b0",
};
export const FLAG_ORDER: WatchFlag[] = ["red", "orange", "yellow", "green", "blue", "purple"];

export const isSection = (entry: string) => entry.startsWith(SECTION_PREFIX);
export const sectionName = (entry: string) => entry.slice(SECTION_PREFIX.length);
export const makeSection = (name: string) =>
  `${SECTION_PREFIX}${name.replace(/[\r\n]/g, " ").trim().slice(0, 40) || "Section"}`;

const QUOTES = ["USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH", "BNB", "EUR", "TRY"];

/**
 * Normalize a pasted ticker to an exchange symbol: `BINANCE:BTCUSDT`,
 * `btc/usdt`, `BTC-USDT` and a bare `BTC` all become `BTCUSDT`.
 */
export function normalizeSymbol(raw: string): string | null {
  // Hyperliquid coin names are case-sensitive (`kPEPE`); builder dex names are lower case.
  const hl = /^(?:HL|HYPERLIQUID):(.+)$/i.exec(raw.trim());
  if (hl) {
    const [first, ...rest] = hl[1].trim().split(":");
    const coin = rest.length ? `${first.toLowerCase()}:${rest.join(":")}` : first;
    return isHyperliquidCoin(coin) ? hyperliquidSymbol(coin) : null;
  }
  const text = raw.trim().toUpperCase();
  // Anything on another venue (NASDAQ:AAPL, YF:^GSPC) is charted from Yahoo Finance.
  const venue = /^([A-Z0-9]+):(.+)$/.exec(text);
  if (venue && venue[1] !== "BINANCE") {
    const ticker = venue[1] === "YF" ? venue[2] : venue[2].replace(/\s+/g, "");
    return isYahooTicker(ticker) ? yahooSymbol(ticker) : null;
  }
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9]+:/, "")
    .replace(/\.P$/, "")
    .replace(/[/\-_ ]/g, "");
  if (!cleaned || !/^[A-Z0-9]{2,24}$/.test(cleaned)) return null;
  if (QUOTES.some((q) => cleaned.endsWith(q) && cleaned.length > q.length)) return cleaned;
  return cleaned.length <= 10 ? `${cleaned}USDT` : null;
}

export interface ParsedList {
  entries: string[];
  rejected: string[];
}

/** Parse pasted text or CSV into list entries, keeping `###Section` headers. */
export function parseWatchlistText(text: string): ParsedList {
  const entries: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const csvHeader = lines[0]?.toLowerCase().includes("symbol");
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || (index === 0 && csvHeader)) continue;
    if (trimmed.startsWith(SECTION_PREFIX)) {
      entries.push(makeSection(trimmed.slice(SECTION_PREFIX.length)));
      continue;
    }
    // CSV exports lead with the symbol; free text may separate with , ; or spaces.
    const tokens = csvHeader || trimmed.includes(",") && /^[^,]+,\s*[-\d.]/.test(trimmed)
      ? [trimmed.split(",")[0]]
      : trimmed.split(/[\s,;]+/);
    for (const token of tokens) {
      if (!token) continue;
      const symbol = normalizeSymbol(token);
      if (!symbol) rejected.push(token);
      else if (!seen.has(symbol)) {
        seen.add(symbol);
        entries.push(symbol);
      }
    }
  }
  return { entries, rejected };
}

/** Plain-text export: one symbol per line with `###Section` headers. */
export function serializeWatchlist(entries: readonly string[]): string {
  return entries.join("\n");
}

export type WatchColumn =
  | "last"
  | "change"
  | "changePercent"
  | "high"
  | "low"
  | "volume"
  | "quoteVolume"
  | "range"
  | "trend";

export const COLUMN_LABELS: Record<WatchColumn, string> = {
  last: "Last",
  change: "Chg",
  changePercent: "Chg %",
  high: "High",
  low: "Low",
  volume: "Volume",
  quoteVolume: "Turnover",
  range: "Range",
  trend: "Trend",
};
export const DEFAULT_COLUMNS: WatchColumn[] = ["last", "change", "changePercent"];

/** Numeric value a column sorts by; null sorts last. */
export function columnValue(column: WatchColumn | "symbol", quote: Quote | undefined): number | null {
  if (!quote) return null;
  switch (column) {
    case "last":
      return quote.price;
    case "change":
      return Number.isFinite(quote.change) ? quote.change : null;
    case "changePercent":
      return Number.isFinite(quote.changePercent) ? quote.changePercent : null;
    case "high":
      return quoteRange(quote).high;
    case "low":
      return quoteRange(quote).low;
    case "volume":
      return baseVolume(quote);
    case "quoteVolume":
      return notionalVolume(quote);
    case "range": {
      const { high, low } = quoteRange(quote);
      return high === null || low === null ? null : high > low ? (quote.price - low) / (high - low) : 0.5;
    }
    case "trend":
      return quote.history.length > 1 ? quote.history.at(-1)! - quote.history[0] : 0;
    default:
      return null;
  }
}

export interface SortSpec {
  column: WatchColumn | "symbol" | "flag";
  direction: "asc" | "desc";
}

/**
 * Order the rows of a list. Sections keep their place when no sort is active;
 * a sort flattens the list into symbols only (sections have nothing to sort by).
 */
export function sortEntries(
  entries: readonly string[],
  quotes: Record<string, Quote>,
  sort: SortSpec | null,
  flags: Record<string, WatchFlag> = {},
): string[] {
  if (!sort) return [...entries];
  const symbols = entries.filter((e) => !isSection(e));
  const sign = sort.direction === "asc" ? 1 : -1;
  const flagRank = (s: string) => (flags[s] ? FLAG_ORDER.indexOf(flags[s]) : FLAG_ORDER.length);
  return symbols.sort((a, b) => {
    if (sort.column === "symbol") return sign * a.localeCompare(b);
    if (sort.column === "flag") return sign * (flagRank(a) - flagRank(b)) || a.localeCompare(b);
    const va = columnValue(sort.column, quotes[a]);
    const vb = columnValue(sort.column, quotes[b]);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return sign * (va - vb);
  });
}

export function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function watchlistCsv(
  entries: readonly string[],
  quotes: Record<string, Quote>,
  flags: Record<string, WatchFlag> = {},
): string {
  const header = ["symbol", "last", "change", "change_percent", "high", "low", "base_volume", "flag", "notional_volume", "notional_currency", "volume_period", "volume_as_of", "range_period", "range_from", "range_to", "range_resolution", "range_complete", "price_basis", "price_time"];
  const rows = entries.map((entry) => {
    if (isSection(entry)) return [csvEscape(entry)].join(",");
    const q = quotes[entry];
    return [
      entry,
      q?.price ?? "",
      q && Number.isFinite(q.change) ? q.change : "",
      q && Number.isFinite(q.changePercent) ? q.changePercent.toFixed(4) : "",
      quoteRange(q).high ?? "",
      quoteRange(q).low ?? "",
      baseVolume(q) ?? "",
      flags[entry] ?? "",
      notionalVolume(q) ?? "",
      q?.metrics?.volume.currency ?? "",
      q?.metrics?.volume.period ?? "",
      q?.metrics ? new Date(q.metrics.volume.asOf).toISOString() : "",
      q?.metrics?.range.period ?? "",
      q?.metrics?.range.from != null ? new Date(q.metrics.range.from).toISOString() : "",
      q?.metrics ? new Date(q.metrics.range.to).toISOString() : "",
      q?.metrics?.range.resolution ?? "",
      q?.metrics ? String(q.metrics.range.complete && quoteRange(q).high !== null) : "",
      q?.priceBasis ?? "",
      q && Number.isFinite(q.time) && q.time > 0 ? new Date(q.time).toISOString() : "",
    ]
      .map(csvEscape)
      .join(",");
  });
  return [header.join(","), ...rows].join("\r\n");
}
