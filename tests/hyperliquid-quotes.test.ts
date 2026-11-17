import { describe, expect, it } from "vitest";
import { hyperliquidQuoteTradeSymbols, mergeHyperliquidQuote, quotePriceLabel, type HyperliquidQuoteUpdate } from "@/lib/market/hyperliquidQuotes";
import { basicMetrics } from "@/lib/market/quoteMetrics";
const update = (patch: Partial<HyperliquidQuoteUpdate> = {}): HyperliquidQuoteUpdate => ({ symbol: "HL:BTC", price: 100, time: 1000, basis: "mark", ...patch });
describe("Hyperliquid quote price contracts", () => {
  it("promotes price sources without splicing incompatible histories", () => {
    const mark = mergeHyperliquidQuote(undefined, update())!;
    const mid = mergeHyperliquidQuote(mark, update({ basis: "mid", price: 102, time: 1100 }))!;
    const trade = mergeHyperliquidQuote(mid, update({ basis: "trade", price: 101, time: 900 }))!;
    expect(mid.history).toEqual([102]);
    expect(trade).toMatchObject({ price: 101, time: 900, priceBasis: "trade", previous: 101, history: [101] });
    const metadata = mergeHyperliquidQuote(trade, update({ price: 110, time: 1200, referencePrice: 95, metrics: basicMetrics("HL:BTC", 12, 1200, 0, 0, "24h", 1200) }))!;
    expect(metadata).toMatchObject({ price: 101, time: 900, referencePrice: 95, change: 6, volume: 12 });
    expect(metadata.history).toBe(trade.history);
    expect(mergeHyperliquidQuote(metadata, update({ basis: "mid", price: 120, time: 1300 }))!.price).toBe(101);
    expect(quotePriceLabel(metadata)).toBe("Last trade");
  });
  it("rejects old prices and references independently", () => {
    const first = mergeHyperliquidQuote(undefined, update({ basis: "trade", referencePrice: 90, metadataTime: 2000 }))!;
    const stale = mergeHyperliquidQuote(first, update({ basis: "trade", price: 80, time: 900, referencePrice: 85, metadataTime: 1900 }))!;
    expect(stale).toMatchObject({ price: 100, time: 1000, referencePrice: 90, referenceTime: 2000 });
    expect(stale.history).toBe(first.history);
  });
  it("does not invent a zero percent change before the provider reference arrives", () => {
    const quote = mergeHyperliquidQuote(undefined, update({ basis: "mid" }))!;
    expect(quote.referencePrice).toBeNull();
    expect(Number.isNaN(quote.changePercent)).toBe(true);
    expect(quote.metrics!.range.complete).toBe(false);
    expect(quotePriceLabel(quote)).toBe("Midpoint");
  });
  it("appends changed trades only, caps history, and clears a pulse on a flat trade", () => {
    let quote = mergeHyperliquidQuote(undefined, update({ basis: "trade" }))!;
    for (let i = 1; i <= 60; i++) quote = mergeHyperliquidQuote(quote, update({ basis: "trade", price: 100 + i, time: 1000 + i }))!;
    expect(quote.history).toHaveLength(48);
    const flat = mergeHyperliquidQuote(quote, update({ basis: "trade", price: 160, time: 1100 }))!;
    expect(flat.history).toBe(quote.history);
    expect(flat.previous).toBe(160);
    expect(flat.time).toBe(1100);
  });
  it("rejects invalid first observations and preserves an existing valid price", () => {
    for (const value of [0, -1, NaN, Infinity]) {
      expect(mergeHyperliquidQuote(undefined, update({ price: value }))).toBeUndefined();
      expect(mergeHyperliquidQuote(undefined, update({ time: value }))).toBeUndefined();
    }
    const quote = mergeHyperliquidQuote(undefined, update())!;
    expect(mergeHyperliquidQuote(quote, update({ price: NaN }))!.price).toBe(100);
  });
  it("retains candle ranges while independently refreshing volume metadata", () => {
    const metrics = basicMetrics("HL:BTC", 12, 1200, 110, 90, "24h", 1000);
    metrics.range = { ...metrics.range, resolution: "1m", complete: true };
    const quote = mergeHyperliquidQuote(undefined, update({ metrics }))!;
    const next = mergeHyperliquidQuote(quote, update({ metrics: basicMetrics("HL:BTC", 15, 1500, 0, 0, "24h", 2000) }))!;
    expect(next.metrics!.range).toBe(metrics.range);
    expect(next.volume).toBe(15);
    expect(mergeHyperliquidQuote(next, update({ metrics }))!.volume).toBe(15);
  });
  it("prioritizes visible markets, excludes full streams, and reserves subscription capacity", () => {
    const quotes = Array.from({ length: 1000 }, (_, i) => `HL:T${i}`);
    const selected = hyperliquidQuoteTradeSymbols(["HL:T0"], quotes, ["HL:T999", "HL:T0", "HL:T999"], 2, 10);
    expect(selected).toHaveLength(150);
    expect(selected[0]).toBe("HL:T999");
    expect(selected).not.toContain("HL:T0");
    expect(hyperliquidQuoteTradeSymbols([], quotes, [], 2, 860)).toHaveLength(10);
    expect(hyperliquidQuoteTradeSymbols([], quotes, [], 2, 1000)).toEqual([]);
  });
});
