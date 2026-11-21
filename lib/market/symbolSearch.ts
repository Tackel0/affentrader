import { formatVolume } from "@/lib/symbols";
import { tickerOf, type InstrumentType } from "@/lib/symbolId";

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

export function rankedSearchRows(rows: readonly SearchRow[], rawQuery: string, limit: number): SearchRow[] {
  const query = normalize(rawQuery);
  const ranked = new Map<string, { row: SearchRow; match: number }>();
  for (const row of rows) {
    const score = query ? match(row, query) : 0;
    if (score < 4) ranked.set(row.symbol, { row, match: score });
  }
  const turnover = (row: SearchRow) => typeof row.turnover === "number" && Number.isFinite(row.turnover) && row.turnover >= 0 ? row.turnover : -1;
  return [...ranked.values()]
    .sort((a, b) => a.match - b.match
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
