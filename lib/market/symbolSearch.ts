import { formatVolume } from "@/lib/symbols";
import { providerOf, tickerOf, type InstrumentType, type Provider } from "@/lib/symbolId";

export type SearchExchangeId = Provider;

export const SEARCH_EXCHANGES: readonly { id: SearchExchangeId; label: string; shortLabel: string }[] = [
  { id: "binance", label: "Binance", shortLabel: "Binance" },
  { id: "hyperliquid", label: "Hyperliquid", shortLabel: "Hyperliquid" },
  { id: "bybit", label: "Bybit", shortLabel: "Bybit" },
  { id: "kraken", label: "Kraken", shortLabel: "Kraken" },
  { id: "yahoo", label: "Yahoo Finance", shortLabel: "Yahoo" },
  { id: "alpaca", label: "Alpaca", shortLabel: "Alpaca" },
];

export const DEFAULT_SEARCH_EXCHANGE_PRIORITY: readonly SearchExchangeId[] = [
  "binance",
  "hyperliquid",
  "bybit",
  "kraken",
  "yahoo",
  "alpaca",
];

const EXCHANGE_SET = new Set<string>(DEFAULT_SEARCH_EXCHANGE_PRIORITY);

export interface SearchPreferences {
  enabledExchanges: SearchExchangeId[];
  exchangePriority: SearchExchangeId[];
}

export function defaultSearchPreferences(): SearchPreferences {
  return {
    enabledExchanges: [...DEFAULT_SEARCH_EXCHANGE_PRIORITY],
    exchangePriority: [...DEFAULT_SEARCH_EXCHANGE_PRIORITY],
  };
}

export function isSearchExchangeId(value: unknown): value is SearchExchangeId {
  return typeof value === "string" && EXCHANGE_SET.has(value);
}

export function validSearchPreferences(value: unknown): value is SearchPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.length !== 2 || !keys.includes("enabledExchanges") || !keys.includes("exchangePriority")) return false;
  const { enabledExchanges, exchangePriority } = candidate;
  if (!Array.isArray(enabledExchanges) || !Array.isArray(exchangePriority)) return false;
  if (!enabledExchanges.every(isSearchExchangeId) || new Set(enabledExchanges).size !== enabledExchanges.length) return false;
  if (exchangePriority.length !== DEFAULT_SEARCH_EXCHANGE_PRIORITY.length) return false;
  if (!exchangePriority.every(isSearchExchangeId) || new Set(exchangePriority).size !== DEFAULT_SEARCH_EXCHANGE_PRIORITY.length) return false;
  return true;
}

export function readSearchPreferences(value: unknown): SearchPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultSearchPreferences();
  const candidate = value as Record<string, unknown>;
  const enabledRaw = Array.isArray(candidate.enabledExchanges)
    ? candidate.enabledExchanges.filter(isSearchExchangeId)
    : [...DEFAULT_SEARCH_EXCHANGE_PRIORITY];
  const enabledExchanges = [...new Set(enabledRaw)];
  const priorityRaw = Array.isArray(candidate.exchangePriority)
    ? candidate.exchangePriority.filter(isSearchExchangeId)
    : [];
  const exchangePriority = [
    ...new Set([...priorityRaw, ...DEFAULT_SEARCH_EXCHANGE_PRIORITY]),
  ];
  return { enabledExchanges, exchangePriority };
}

export function moveExchangePriority(
  order: readonly SearchExchangeId[],
  id: SearchExchangeId,
  direction: "up" | "down" | "top",
): SearchExchangeId[] {
  const normalized = [...new Set([...order.filter(isSearchExchangeId), ...DEFAULT_SEARCH_EXCHANGE_PRIORITY])];
  const index = normalized.indexOf(id);
  if (index < 0) return normalized;
  if (direction === "top") {
    if (index === 0) return normalized;
    return [id, ...normalized.filter(item => item !== id)];
  }
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= normalized.length) return normalized;
  const next = [...normalized];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function searchExchangeLabel(id: SearchExchangeId, short = false): string {
  const meta = SEARCH_EXCHANGES.find(item => item.id === id);
  return (short ? meta?.shortLabel : meta?.label) ?? id;
}

export interface SearchRow {
  symbol: string;
  base: string;
  name: string;
  venue: string;
  quote: string;
  type?: InstrumentType;
  realTime?: boolean;
  turnover?: number;
  price?: number;
}

function normalize(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function match(row: SearchRow, query: string) {
  const base = normalize(row.base);
  const ticker = normalize(tickerOf(row.symbol));
  const pair = base + normalize(row.quote);
  const unquoted = query.replace(/(USDT|USDC)$/, "");
  if (base === query || ticker === query || pair === query) return 0;
  if (unquoted && unquoted !== query && base === unquoted) return 1;
  if (base.startsWith(query) || ticker.startsWith(query)) return 2;
  if (normalize(`${row.base} ${row.name} ${row.symbol} ${row.venue}`).includes(query)) return 3;
  return 4;
}

export function rankedSearchRows(
  rows: readonly SearchRow[],
  rawQuery: string,
  limit: number,
  preferences?: Partial<SearchPreferences>,
): SearchRow[] {
  const query = normalize(rawQuery);
  const enabled = preferences?.enabledExchanges ? new Set(preferences.enabledExchanges) : null;
  const priorityOrder = preferences?.exchangePriority?.length ? preferences.exchangePriority : null;
  const priorityRank = (symbol: string) => {
    if (!priorityOrder) return 0;
    const index = priorityOrder.indexOf(providerOf(symbol));
    return index >= 0 ? index : priorityOrder.length;
  };
  const ranked = new Map<string, { row: SearchRow; match: number }>();
  for (const row of rows) {
    if (enabled && !enabled.has(providerOf(row.symbol))) continue;
    const score = query ? match(row, query) : 0;
    if (score < 4) ranked.set(row.symbol, { row, match: score });
  }
  const turnover = (row: SearchRow) => typeof row.turnover === "number" && Number.isFinite(row.turnover) && row.turnover >= 0 ? row.turnover : -1;
  return [...ranked.values()]
    .sort((a, b) => a.match - b.match
      || priorityRank(a.row.symbol) - priorityRank(b.row.symbol)
      || Number(Boolean(b.row.realTime)) - Number(Boolean(a.row.realTime))
      || turnover(b.row) - turnover(a.row))
    .slice(0, limit)
    .map(entry => entry.row);
}

export function searchVenue(row: SearchRow): string {
  return [row.venue, row.realTime === undefined ? "" : row.realTime ? "Live" : "Delayed",
    row.turnover && row.turnover > 0 ? `$${formatVolume(row.turnover)} / 24h` : "",
  ].filter(Boolean).join(" · ");
}
