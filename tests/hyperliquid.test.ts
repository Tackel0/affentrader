import { describe, expect, it, vi } from "vitest";
import {
  parseAssets,
  parseBook,
  parseCandles,
  parseTrade,
  priceTick,
  HYPERLIQUID_NATIVES,
} from "@/lib/market/hyperliquid";
import { loadHyperliquidBars } from "@/lib/market/hyperliquidClient";
import { validateCandleRequest } from "@/lib/server/hyperliquid";
import { displayTicker, hyperliquidDex, isSymbolId, providerOf, tickerOf } from "@/lib/symbolId";
import { planSource } from "@/lib/market/intervals";

const candle = (t: number, o = 100, c = 101) => ({ t, T: t + 59_999, s: "BTC", i: "1m", o: String(o), c: String(c), h: String(Math.max(o, c) + 1), l: String(Math.min(o, c) - 1), v: "5.5", n: 10 });

describe("hyperliquid symbol ids", () => {
  it("recognises main and builder markets", () => {
    for (const id of ["HL:BTC", "HL:kPEPE", "HL:xyz:TSLA", "HL:flx:GOLD"]) expect(isSymbolId(id)).toBe(true);
    for (const id of ["HL:", "HL:BT C", "HL:xyz:", "HL:a:b:c", "HL:<x>"]) expect(isSymbolId(id)).toBe(false);
    expect(providerOf("HL:xyz:TSLA")).toBe("hyperliquid");
    expect(tickerOf("HL:xyz:TSLA")).toBe("xyz:TSLA");
    expect(displayTicker("HL:xyz:TSLA")).toBe("TSLA");
    expect(displayTicker("HL:BTC")).toBe("BTC");
    expect(hyperliquidDex("xyz:TSLA")).toBe("xyz");
    expect(hyperliquidDex("BTC")).toBe("");
  });
  it("does not disturb Binance or Yahoo ids", () => {
    expect(providerOf("BTCUSDT")).toBe("binance");
    expect(providerOf("YF:AAPL")).toBe("yahoo");
    expect(isSymbolId("BTCUSDT")).toBe(true);
  });
});

describe("hyperliquid parsers", () => {
  it("parses candles, drops bad rows and sorts", () => {
    const rows = [candle(120_000), candle(60_000), { t: 1, o: "0", h: "0", l: "0", c: "0", v: "0" }, null, candle(180_000, 5, 6)];
    const bars = parseCandles(rows);
    expect(bars.map((b) => b.time)).toEqual([60_000, 120_000, 180_000]);
    expect(bars[2]).toMatchObject({ open: 5, close: 6, volume: 5.5 });
    expect(parseCandles("nope")).toEqual([]);
  });
  it("merges meta with contexts and skips delisted or unpriced assets", () => {
    const meta = { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "OLD", szDecimals: 1, maxLeverage: 3, isDelisted: true }, { name: "xyz:TSLA", szDecimals: 3, maxLeverage: 10 }, { name: "ZERO", szDecimals: 0, maxLeverage: 1 }] };
    const ctx = [
      { markPx: "80000", prevDayPx: "79000", dayNtlVlm: "5e9", openInterest: "100", funding: "0.0000125" },
      { markPx: "1" },
      { markPx: "380.5", prevDayPx: "375" },
      { markPx: "0" },
    ];
    const assets = parseAssets(meta, ctx, "", "Hyperliquid");
    expect(assets.map((a) => a.coin)).toEqual(["BTC", "xyz:TSLA"]);
    expect(assets[0]).toMatchObject({ symbol: "HL:BTC", mark: 80000, previousDay: 79000, volume: 5e9, maxLeverage: 40 });
    expect(assets[1]).toMatchObject({ name: "TSLA", symbol: "HL:xyz:TSLA", previousDay: 375 });
    expect(parseAssets(null, ctx, "")).toEqual([]);
  });
  it("classifies trades by taker side", () => {
    const buy = parseTrade({ coin: "BTC", side: "B", px: "80000.5", sz: "0.25", time: 1_700_000_000_000, tid: 42 });
    expect(buy).toMatchObject({ symbol: "HL:BTC", side: "buy", price: 80000.5, quantity: 0.25, seq: 42, simulated: false });
    expect(parseTrade({ coin: "xyz:TSLA", side: "A", px: "380", sz: "1", time: 5, tid: 1 })?.side).toBe("sell");
    expect(parseTrade({ coin: "BTC", side: "X", px: "1", sz: "1", time: 5 })).toBeNull();
    expect(parseTrade({ coin: "BTC", side: "B", px: "0", sz: "1", time: 5 })).toBeNull();
    expect(parseTrade(null)).toBeNull();
  });
  it("reads an order book with bids first", () => {
    const book = parseBook({ coin: "BTC", time: 9, levels: [[{ px: "99", sz: "2", n: 1 }, { px: "98", sz: "0", n: 1 }], [{ px: "101", sz: "3", n: 1 }]] });
    expect(book?.bids).toEqual([{ price: 99, quantity: 2 }]);
    expect(book?.asks).toEqual([{ price: 101, quantity: 3 }]);
    expect(parseBook({ coin: "BTC", levels: [[]] })).toBeNull();
  });
  it("derives price ticks from five significant figures", () => {
    expect(priceTick(80000.5, 5)).toBe(1);
    expect(priceTick(0.0123, 0)).toBeCloseTo(1e-6);
    expect(priceTick(380.55, 3)).toBeCloseTo(0.01);
    expect(priceTick(-1)).toBe(0.01);
  });
});

describe("hyperliquid requests", () => {
  const now = 1_800_000_000_000;
  it("validates candle requests strictly", () => {
    const ok = { coin: "BTC", interval: "15m", startTime: now - 3_600_000, endTime: now };
    expect(() => validateCandleRequest(ok, now)).not.toThrow();
    expect(() => validateCandleRequest({ ...ok, coin: "bad coin" }, now)).toThrow(/coin/);
    expect(() => validateCandleRequest({ ...ok, interval: "7m" }, now)).toThrow(/interval/);
    expect(() => validateCandleRequest({ ...ok, startTime: now, endTime: now - 1 }, now)).toThrow(/window/);
    expect(() => validateCandleRequest({ ...ok, endTime: now + 3 * 86_400_000 }, now)).toThrow(/future/);
    expect(() => validateCandleRequest({ ...ok, startTime: 0 }, now)).toThrow(/long/);
  });
  it("plans custom intervals from the coarsest dividing native", () => {
    expect(planSource("1h", HYPERLIQUID_NATIVES)).toMatchObject({ nativeId: "1h", resample: false });
    expect(planSource("45m", HYPERLIQUID_NATIVES)).toMatchObject({ nativeId: "15m", resample: true });
    expect(planSource("3D", HYPERLIQUID_NATIVES)).toMatchObject({ nativeId: "1D", resample: true });
    expect(planSource("6h", HYPERLIQUID_NATIVES)).toMatchObject({ nativeId: "2h", resample: true });
  });
  it("pages backwards, de-duplicates and resamples", async () => {
    const minute = 60_000;
    const base = Math.floor(1_700_000_000_000 / minute) * minute;
    const all = Array.from({ length: 2400 }, (_, i) => candle(base - (2399 - i) * minute, 100 + i, 101 + i));
    const calls: number[] = [];
    const fetcher = vi.fn(async (url: string) => {
      const q = new URL(url, "http://x").searchParams;
      const start = Number(q.get("start"));
      const end = Number(q.get("end"));
      calls.push(start);
      return new Response(JSON.stringify({ candles: all.filter((c) => c.t >= start && c.t <= end) }), { status: 200 });
    }) as unknown as typeof fetch;
    const bars = await loadHyperliquidBars({ coin: "BTC", timeframe: "1m", count: 2000, end: base, fetcher });
    expect(bars).toHaveLength(2000);
    expect(bars.at(-1)!.time).toBe(base);
    expect(new Set(bars.map((b) => b.time)).size).toBe(2000);
    expect(calls.length).toBe(2);
    const resampled = await loadHyperliquidBars({ coin: "BTC", timeframe: "45m", count: 10, end: base, fetcher });
    expect(resampled.length).toBeGreaterThan(5);
    expect(resampled.every((b) => b.time % (45 * minute) === 0)).toBe(true);
  });
  it("reports server errors and unsupported intervals", async () => {
    const failing = vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 503 })) as unknown as typeof fetch;
    await expect(loadHyperliquidBars({ coin: "BTC", timeframe: "15m", count: 10, fetcher: failing })).rejects.toThrow("boom");
    await expect(loadHyperliquidBars({ coin: "BTC", timeframe: "100T", count: 10, fetcher: failing })).rejects.toThrow(/not available/);
  });
});
