import { describe, expect, it } from "vitest";
import { combinedBookCsv, combineVenueBooks } from "@/lib/orderflow/combinedBook";
import { buildBookView } from "@/lib/orderflow/bookView";

const now = 10_000;
const venues = [
  { symbol: "BTCUSDT", base: "BTC", quote: "USDT", tick: .1, book: {
    symbol: "BTCUSDT", time: now, simulated: false, bids: [{ price: 100.2, quantity: .1 }], asks: [{ price: 101.1, quantity: .2 }],
  } },
  { symbol: "KRK:BTC/USDT", base: "BTC", quote: "USDT", tick: 1, book: {
    symbol: "KRK:BTC/USDT", time: now - 100, simulated: false, bids: [{ price: 100, quantity: .2 }], asks: [{ price: 102, quantity: .3 }],
  } },
];

describe("combined venue books", () => {
  it("retains overlapping prices from valid individual venues", () => {
    const second = { ...venues[1], book: { ...venues[1].book, bids: [{ price: 103, quantity: 1 }], asks: [{ price: 104, quantity: 1 }] } };
    const combined = combineVenueBooks([venues[0], second], now);
    expect(combined.bids[0].price).toBe(103);
    expect(combined.asks[0].price).toBe(102);
    expect(buildBookView(combined, 1, "base", 10, true).bids[0].price).toBe(103);
    expect(() => buildBookView(combined, 1, "base", 10)).toThrow(/crossed/);
  });
  it("adds observed sizes on the coarsest grid with source timestamps", () => {
    expect(combineVenueBooks(venues, now)).toEqual({
      tick: 1,
      observedTop: { bids: [venues[0].book.bids[0]], asks: [venues[0].book.asks[0]], bidVenues: ["BTCUSDT"], askVenues: ["BTCUSDT"] },
      bids: [{ price: 100, quantity: .3, contributions: [{ symbol: "BTCUSDT", quantity: .1 }, { symbol: "KRK:BTC/USDT", quantity: .2 }] }],
      asks: [{ price: 102, quantity: .5, contributions: [{ symbol: "BTCUSDT", quantity: .2 }, { symbol: "KRK:BTC/USDT", quantity: .3 }] }],
      sources: venues.map(venue => ({ symbol: venue.symbol, time: venue.book.time, bidLevels: 1, askLevels: 1 })),
    });
  });

  it("retains both venues when the ungrouped best prices tie", () => {
    const second = { ...venues[1], book: { ...venues[1].book, bids: venues[0].book.bids, asks: venues[0].book.asks } };
    const { observedTop } = combineVenueBooks([venues[0], second], now);
    expect(observedTop.bidVenues).toEqual(["BTCUSDT", "KRK:BTC/USDT"]);
    expect(observedTop.askVenues).toEqual(observedTop.bidVenues);
  });
  it("carries exact venue quantities through the display grouping", () => {
    const first = { ...venues[0], book: { ...venues[0].book, bids: [{ price: 100.2, quantity: .1 }, { price: 99.9, quantity: .2 }] } };
    const second = { ...venues[1], book: { ...venues[1].book, bids: [{ price: 99, quantity: .4 }] } };
    const combined = combineVenueBooks([first, second], now);
    expect(combined.sources.map(({ bidLevels, askLevels }) => [bidLevels, askLevels])).toEqual([[2, 1], [1, 1]]);
    expect(buildBookView(combined, 5, "base", 10, true).bids.map(row => row.contributions)).toEqual([
      [{ symbol: "BTCUSDT", quantity: .1 }],
      [{ symbol: "BTCUSDT", quantity: .2 }, { symbol: "KRK:BTC/USDT", quantity: .4 }],
    ]);
  });

  it("rejects mixed units, duplicate markets and stale snapshots", () => {
    expect(() => combineVenueBooks([venues[0], { ...venues[1], quote: "USD" }], now)).toThrow(/matching/);
    expect(() => combineVenueBooks([venues[0], venues[0]], now)).toThrow(/distinct/);
    expect(() => combineVenueBooks(venues, now + 5000)).toThrow(/stale/);
  });

  it("exports one row per venue contribution with the matching receipt time", () => {
    const rows = combinedBookCsv(combineVenueBooks(venues, now)).trim().split("\r\n");
    expect(rows).toHaveLength(5);
    expect(rows[1]).toBe("bid,1,100,1,0.3,BTCUSDT,0.1,1970-01-01T00:00:10.000Z");
    expect(rows[2]).toBe("bid,1,100,1,0.3,KRK:BTC/USDT,0.2,1970-01-01T00:00:09.900Z");
  });
});
