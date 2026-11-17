import { afterEach, describe, expect, it } from "vitest";
import { currentPriceAlertDraft, priceAlertDraft } from "@/lib/alerts/priceDraft";
import { useChartStore } from "@/stores/useChartStore";
import type { Quote } from "@/types/trading";

const quote: Quote = { symbol: "BTCUSDT", price: 80000, previous: 79990, change: 10,
  changePercent: .0125, high: 81000, low: 79000, volume: 100, history: [79990, 80000],
  time: 1793059200000, simulated: false };
const original = useChartStore.getState();
afterEach(() => useChartStore.setState(original));

describe("price alert starting values", () => {
  it("leaves an unavailable or mismatched quote blank instead of inventing a threshold", () => {
    expect(priceAlertDraft("BTCUSDT", "5m")).toMatchObject({ price: undefined, source: "manual" });
    expect(priceAlertDraft("ETHUSDT", "5m", quote).price).toBeUndefined();
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid observed prices: %s", price => {
    expect(priceAlertDraft("BTCUSDT", "5m", { ...quote, price }).price).toBeUndefined();
  });
  it("keeps the quote source, observation time and target context", () => {
    expect(priceAlertDraft("BTCUSDT", "5m", quote)).toEqual({ symbol: "BTCUSDT", timeframe: "5m",
      price: 80000, source: "market", observedAt: quote.time });
    expect(priceAlertDraft("BTCUSDT", "5m", { ...quote, simulated: true }).source).toBe("simulation");
  });
  it("preserves an explicitly selected chart coordinate without calling it a market quote", () => {
    expect(priceAlertDraft("BTCUSDT", "5m", quote, 79000)).toMatchObject({ price: 79000, source: "manual", observedAt: undefined });
    expect(priceAlertDraft("BTCUSDT", "5m", quote, NaN).price).toBeUndefined();
  });
  it("does not substitute replay candles for a missing live quote", () => {
    useChartStore.setState({ symbol: "BTCUSDT", timeframe: "5m", quotes: {},
      candles: [{ time: quote.time, open: 1, high: 2, low: 1, close: 2, volume: 10 }] });
    expect(currentPriceAlertDraft().price).toBeUndefined();
  });
  it("freezes the draft target when the active chart changes", () => {
    useChartStore.setState({ symbol: "BTCUSDT", timeframe: "5m", quotes: { BTCUSDT: quote } });
    const draft = currentPriceAlertDraft();
    useChartStore.setState({ symbol: "ETHUSDT", timeframe: "1h", quotes: {} });
    expect(draft).toMatchObject({ symbol: "BTCUSDT", timeframe: "5m", price: 80000 });
    expect(currentPriceAlertDraft()).toMatchObject({ symbol: "ETHUSDT", timeframe: "1h", price: undefined });
  });
  it("supports a watchlist target independent of the active chart", () => {
    useChartStore.setState({ symbol: "ETHUSDT", timeframe: "1h", quotes: { BTCUSDT: quote } });
    expect(currentPriceAlertDraft(undefined, "BTCUSDT")).toMatchObject({ symbol: "BTCUSDT", timeframe: "1h", price: 80000 });
  });
});
