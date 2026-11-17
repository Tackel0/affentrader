import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookView } from "@/components/BookView";
import { buildBookView, bookShare, bookDepthPaths, validBookView } from "@/lib/orderflow/bookView";
import { defaultDomPreferences, readDomPreferences, validDomPreferences } from "@/lib/orderflow/domPreferences";
const book = { symbol: "BTCUSDT", time: 0, simulated: false, bids: [{ price: 100.2, quantity: .1 }, { price: 100.1, quantity: .2 }, { price: 99.8, quantity: 2 }], asks: [{ price: 100.3, quantity: 1 }, { price: 100.4, quantity: 3 }, { price: 101.1, quantity: 2 }] };
describe("observed Book view", () => {
  it("shows overlapping venue quotes before the combined rows are rounded outward", () => {
    const markup = renderToStaticMarkup(createElement(BookView, {
      book: { bids: [{ price: 101, quantity: 1 }], asks: [{ price: 102, quantity: 1 }] },
      observedTop: { bids: [{ price: 101.9, quantity: 1 }], asks: [{ price: 101.1, quantity: 1 }] },
      symbol: "BTCUSDT", base: "BTC", quote: "USDT", contextKey: "test", live: false, fixedTick: 1,
    }));
    expect(markup).toContain('class="book-top-bid">101.9</strong>');
    expect(markup).toContain('class="book-top-ask">101.1</strong>');
    expect(markup).toContain("Cross-venue overlap <strong>-0.8 USDT");
  });
  it("keeps adjacent prices distinguishable at more than twelve significant digits", () => {
    const markup = renderToStaticMarkup(createElement(BookView, {
      book: { bids: [{ price: 1000.000000002, quantity: 1 }, { price: 1000.000000001, quantity: 1 }], asks: [] },
      symbol: "BTCUSDT", base: "BTC", quote: "USDT", contextKey: "test", live: false, fixedTick: 1e-9,
    }));
    expect(markup).toContain('class="book-top-bid">1,000.000000002</strong>');
    expect(markup).toContain('class="book-price" title="1,000.000000002 USDT">1,000.000000002</span>');
    expect(markup).toContain('class="book-price" title="1,000.000000001 USDT">1,000.000000001</span>');
  });
  it.each(["bid", "ask"] as const)("renders the observed best %s in a one-sided snapshot", side => {
    const bids = side === "bid" ? book.bids : [];
    const asks = side === "ask" ? book.asks : [];
    const markup = renderToStaticMarkup(createElement(BookView, {
      book: { bids, asks }, symbol: "BTCUSDT", base: "BTC", quote: "USDT", contextKey: "test", live: false,
    }));
    expect(markup).toContain(`class="book-top-bid">${bids[0]?.price ?? "—"}</strong>`);
    expect(markup).toContain(`class="book-top-ask">${asks[0]?.price ?? "—"}</strong>`);
    expect(markup).toContain("Midpoint <strong>—</strong>");
    expect(markup).toContain("Spread <strong>—</strong>");
    expect(markup).toMatch(side === "bid" ? /Bid 100\.0% · Ask 0\.0%/ : /Bid 0\.0% · Ask 100\.0%/);
  });
  it("keeps quantity shares unavailable for an empty snapshot", () => {
    const markup = renderToStaticMarkup(createElement(BookView, {
      book: { bids: [], asks: [] }, symbol: "BTCUSDT", base: "BTC", quote: "USDT", contextKey: "test", live: false,
    }));
    expect(markup).toContain("No depth levels in this snapshot.");
    expect(markup).not.toContain("50.0%");
  });
  it("groups outward without invented depth and accumulates exact decimal base size", () => {
    const view = buildBookView(book, 1, "base", 10);
    expect(view.bids.map(r => [r.price, r.size, r.total])).toEqual([[100, .3, .3], [99, 2, 2.3]]);
    expect(view.asks.map(r => [r.price, r.size, r.total])).toEqual([[101, 4, 4], [102, 2, 6]]);
    expect(view.bids[1].averagePrice).toBeCloseTo((30 + 198) / 2.3, 12);
    expect(view.bidShare).toBeCloseTo(2.3 / 8.3, 14);
  });
  it("uses grouped notional for quote rows and leaves inspection sum in base units", () => {
    const v = buildBookView(book, 1, "quote", 1);
    expect(v.bids[0]).toMatchObject({ price: 100, quantity: .3, size: 30, total: 30, baseTotal: .3, averagePrice: 100 });
    expect(v.asks[0]).toMatchObject({ size: 404, total: 404, baseTotal: 4, averagePrice: 101 });
    expect(bookShare(v.bids[0], "cumulative", v)).toBe(30 / 404);
    expect(bookShare(v.asks[0], "level", v)).toBe(1);
  });
  it("includes all input levels of the last retained group before applying the row cap", () => {
    const v = buildBookView(book, 1, "base", 1);
    expect(v.bids).toHaveLength(1); expect(v.bids[0].quantity).toBe(.3); expect(v.asks[0].quantity).toBe(4);
    expect(buildBookView({ ...book, bids: [], asks: [] }, 1, "base", 1).bidShare).toBe(.5);
    expect(buildBookView(book, .1, "base", 10).bids.map(r => r.price)).toEqual([100.2, 100.1, 99.8]);
  });
  it("fails closed for malformed, crossed, oversized or overflowing snapshots", () => {
    for (const b of [{ ...book, bids: [...book.bids].reverse() }, { ...book, asks: [{ price: 100, quantity: 1 }] }, { ...book, bids: [{ price: 100, quantity: NaN }] }, { ...book, bids: Array(1001).fill(book.bids[0]) }, { ...book, bids: [{ price: 100, quantity: 1e308 }] }]) expect(() => buildBookView(b, .1, "quote", 10)).toThrow();
    for (const limit of [0, 101, 1.5]) expect(() => buildBookView(book, 1, "base", limit)).toThrow();
    expect(() => buildBookView(book, 0, "base", 10)).toThrow();
    expect(() => buildBookView(book, 1000, "base", 10)).toThrow(/nonpositive/);
  });
  it("draws the two step silhouettes in the same best-outward order", () => {
    expect(bookDepthPaths([.25, 1], "bid", 20)).toEqual({ height: 40, line: "M75 0 L75 20 L0 20 L0 40", area: "M100 0 L75 0 L75 20 L0 20 L0 40 L100 40 Z" });
    expect(bookDepthPaths([.25, 1], "ask", 20).line).toBe("M75 40 L75 20 L0 20 L0 0");
    expect(bookDepthPaths([], "ask", 20)).toEqual({ height: 0, line: "", area: "" });
  });
  it("upgrades earlier views and rejects malformed persisted Book settings", () => {
    const old = defaultDomPreferences(); delete old.book; old.follow = "fixed";
    expect(readDomPreferences(old)).toMatchObject({ follow: "fixed", book: { bars: "cumulative", style: "bars", rows: 10 } });
    expect(readDomPreferences({ ...old, book: { bars: "level", style: "line" } }).book).toEqual({ bars: "level", style: "line", rows: 10 });
    expect(readDomPreferences({ ...old, book: { bars: "level", style: "line", rows: 50 } }).book?.rows).toBe(50);
    expect(validBookView({ bars: "level", style: "line", rows: 15 })).toBe(false);
    for (const value of [{ bars: "cumulative", style: "glow" }, { bars: "all", style: "line" }, { bars: "level", style: "area", unlocked: true }, null]) { expect(validBookView(value)).toBe(false); expect(validDomPreferences({ ...old, book: value })).toBe(false); }
  });
});
