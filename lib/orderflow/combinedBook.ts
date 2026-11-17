import type { OrderBook } from "@/types/trading";
import { csvEscape } from "@/lib/watchlist";
import { depthBookStatus, ladderGrid, validateDepthLevels } from "./depthLadder";
import { canonicalDecimal } from "./priceGrid";

interface VenueBook {
  book: OrderBook;
  symbol: string;
  base: string;
  quote: string;
  tick: number;
}

export function combinedBookCsv(book: ReturnType<typeof combineVenueBooks>) {
  const header = ["side", "rank", "grouped_price", "base_tick", "combined_quantity", "venue_symbol", "venue_quantity", "venue_received_utc"];
  const receipts = new Map(book.sources.map(source => [source.symbol, new Date(source.time).toISOString()]));
  const sides = [["bid", book.bids], ["ask", book.asks]] as const;
  const rows = sides.flatMap(([side, levels]) =>
    levels.flatMap((level, index) => level.contributions.map(({ symbol, quantity }) => [
      side, index + 1, level.price, book.tick, level.quantity, /^[=+\-@\s]/.test(symbol) ? `'${symbol}` : symbol,
      quantity, receipts.get(symbol) ?? "",
    ])),
  );
  return [header, ...rows].map(row => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

/** Combines complete snapshots of compatible markets on the coarsest venue grid. */
export function combineVenueBooks(venues: readonly VenueBook[], now: number) {
  if (venues.length < 2 || new Set(venues.map(venue => venue.symbol)).size !== venues.length)
    throw new Error("Select at least two distinct markets.");
  const { base, quote } = venues[0];
  if (!base || !quote || venues.some(venue => venue.base !== base || venue.quote !== quote))
    throw new Error("Combined books require matching base and quote units.");
  for (const venue of venues) {
    const reason = depthBookStatus(venue.book, { symbol: venue.symbol, now, simulation: false, replay: false });
    if (reason) throw new Error(`${venue.symbol}: ${reason}`);
    if (!Number.isFinite(venue.tick) || venue.tick <= 0) throw new Error("Invalid venue tick size.");
  }
  const tick = Math.max(...venues.map(venue => venue.tick));
  const grid = ladderGrid(tick);
  const collect = (side: "bids" | "asks") => {
    const levels = venues.flatMap(venue => venue.book[side]);
    const exponent = Math.min(...levels.map(level => canonicalDecimal(level.quantity).exponent));
    const grouped = new Map<number, Map<string, bigint>>();
    for (const venue of venues) for (const level of venue.book[side]) {
      const price = grid.price(level.price, side === "bids" ? "bid" : "ask");
      const amount = canonicalDecimal(level.quantity);
      const units = amount.coefficient * 10n ** BigInt(amount.exponent - exponent);
      const contributions = grouped.get(price) ?? new Map<string, bigint>();
      contributions.set(venue.symbol, (contributions.get(venue.symbol) ?? 0n) + units);
      grouped.set(price, contributions);
    }
    return [...grouped].sort(([a], [b]) => side === "bids" ? b - a : a - b).slice(0, 100)
      .map(([price, contributions]) => ({
        price,
        quantity: Number(`${[...contributions.values()].reduce((sum, units) => sum + units, 0n)}e${exponent}`),
        contributions: [...contributions].map(([symbol, units]) => ({ symbol, quantity: Number(`${units}e${exponent}`) })),
      }));
  };
  const bids = collect("bids"), asks = collect("asks");
  validateDepthLevels({ bids, asks });
  const bestBid = venues.map(venue => venue.book.bids[0]).reduce((best, level) => level.price > best.price ? level : best);
  const bestAsk = venues.map(venue => venue.book.asks[0]).reduce((best, level) => level.price < best.price ? level : best);
  const observedTop = {
    bids: [bestBid], asks: [bestAsk],
    bidVenues: venues.filter(venue => venue.book.bids[0].price === bestBid.price).map(venue => venue.symbol),
    askVenues: venues.filter(venue => venue.book.asks[0].price === bestAsk.price).map(venue => venue.symbol),
  };
  return { bids, asks, tick, observedTop, sources: venues.map(({ symbol, book }) => ({
    symbol, time: book.time, bidLevels: book.bids.length, askLevels: book.asks.length,
  })) };
}
