import type { OrderBook } from "@/types/trading";
import { ladderGrid, validateDepthBook, validateDepthLevels } from "./depthLadder";
import { canonicalDecimal } from "./priceGrid";

export const BOOK_ROW_LIMITS = [5, 10, 20, 50, 100] as const;
export interface BookViewSettings { bars: "cumulative" | "level"; style: "bars" | "area" | "outline" | "line"; rows?: (typeof BOOK_ROW_LIMITS)[number]; combinedMarkets?: ("BTC" | "ETH")[] }
export const defaultBookView = (): BookViewSettings => ({ bars: "cumulative", style: "bars", rows: 10 });
export function validBookView(value: unknown): value is BookViewSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const hasRows = Object.hasOwn(v, "rows");
  const hasMarkets = Object.hasOwn(v, "combinedMarkets");
  return Object.keys(v).length === 2 + Number(hasRows) + Number(hasMarkets) && Object.hasOwn(v, "bars") && Object.hasOwn(v, "style") &&
    (!hasMarkets || Array.isArray(v.combinedMarkets) && v.combinedMarkets.length <= 2 &&
      new Set(v.combinedMarkets).size === v.combinedMarkets.length && v.combinedMarkets.every(market => market === "BTC" || market === "ETH")) &&
    (!hasRows || (BOOK_ROW_LIMITS as readonly unknown[]).includes(v.rows)) &&
    ["cumulative", "level"].includes(v.bars as string) && ["bars", "area", "outline", "line"].includes(v.style as string);
}
interface VenueQuantity { symbol: string; quantity: number }
type BookLevel = OrderBook["bids"][number] & { contributions?: readonly VenueQuantity[] };
export interface BookViewRow { price: number; quantity: number; size: number; total: number; baseTotal: number; averagePrice: number; contributions?: VenueQuantity[] }
export type BookViewDepth = { readonly bids: readonly BookLevel[]; readonly asks: readonly BookLevel[] };
function finite(value: number) {
  if (!Number.isFinite(value)) throw new Error("Book totals exceed supported numeric precision.");
  return value;
}
/** Group only observed levels, outward on the exact decimal grid. Quantities are
 * added as decimal integers before converting to the display's number format. */
export function buildBookView(book: BookViewDepth, step: number, unit: "base" | "quote", limit: number, combined = false) {
  if (combined) validateDepthLevels(book);
  else validateDepthBook(book);
  const grid = ladderGrid(step);
  if (!["base", "quote"].includes(unit) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid Book view settings.");
  const collect = (levels: readonly BookLevel[], side: "bid" | "ask"): BookViewRow[] => {
    if (!levels.length) return [];
    const exponent = Math.min(...levels.flatMap(level => [level.quantity, ...(level.contributions ?? []).map(item => item.quantity)]).map(quantity => canonicalDecimal(quantity).exponent));
    const units = (quantity: number) => {
      const decimal = canonicalDecimal(quantity);
      return decimal.coefficient * 10n ** BigInt(decimal.exponent - exponent);
    };
    const grouped: { price: number; quantity: bigint; contributions: Map<string, bigint> }[] = [];
    for (const level of levels) {
      const price = grid.price(level.price, side);
      if (price <= 0) throw new Error("Grouping produces a nonpositive Book price. Reduce the grouping.");
      const quantity = units(level.quantity), last = grouped.at(-1);
      if (last?.price !== price) {
        if (grouped.length === limit) break;
        grouped.push({ price, quantity: 0n, contributions: new Map() });
      }
      const row = grouped.at(-1)!;
      row.quantity += quantity;
      for (const item of level.contributions ?? []) {
        row.contributions.set(item.symbol, (row.contributions.get(item.symbol) ?? 0n) + units(item.quantity));
      }
    }
    let total = 0, base = 0n, notional = 0;
    return grouped.map(row => {
      const quantity = finite(Number(`${row.quantity}e${exponent}`));
      base += row.quantity;
      const baseTotal = finite(Number(`${base}e${exponent}`));
      notional = finite(notional + finite(quantity * row.price));
      const size = unit === "quote" ? finite(quantity * row.price) : quantity;
      total = finite(total + size);
      return { price: row.price, quantity, size, total, baseTotal, averagePrice: finite(notional / baseTotal),
        ...(row.contributions.size && { contributions: [...row.contributions].map(([symbol, units]) => ({ symbol, quantity: finite(Number(`${units}e${exponent}`)) })) }),
      };
    });
  };
  const bids = collect(book.bids, "bid"), asks = collect(book.asks, "ask");
  const maxTotal = Math.max(bids.at(-1)?.total ?? 0, asks.at(-1)?.total ?? 0);
  const maxSize = Math.max(0, ...bids.map(r => r.size), ...asks.map(r => r.size));
  const bid = bids.at(-1)?.baseTotal ?? 0, ask = asks.at(-1)?.baseTotal ?? 0;
  // Scaled division avoids overflowing the combined base quantity.
  const scale = Math.max(bid, ask);
  return { bids, asks, maxTotal, maxSize, bidShare: scale ? (bid / scale) / (bid / scale + ask / scale) : .5 };
}
export function bookShare(row: BookViewRow, mode: BookViewSettings["bars"], book: { maxTotal: number; maxSize: number }) {
  const denominator = mode === "cumulative" ? book.maxTotal : book.maxSize;
  return denominator ? Math.max(0, Math.min(1, (mode === "cumulative" ? row.total : row.size) / denominator)) : 0;
}
/** Step depth silhouette: asks grow upward, bids downward, both anchored right. */
export function bookDepthPaths(shares: number[], side: "bid" | "ask", rowHeight: number) {
  const height = shares.length * rowHeight, y = (i: number) => side === "bid" ? i * rowHeight : height - i * rowHeight;
  const points = shares.flatMap((share, i) => { const x = 100 * (1 - Math.min(1, Math.max(0, share))); return [`${x} ${y(i)}`, `${x} ${y(i + 1)}`]; });
  return { height, line: shares.length ? `M${points.join(" L")}` : "", area: shares.length ? `M100 ${y(0)} L${points.join(" L")} L100 ${y(shares.length)} Z` : "" };
}
