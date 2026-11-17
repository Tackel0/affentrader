import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyFilters,
  BUILT_IN_PRESETS,
  computeTechnicals,
  matchesFilter,
  ratingLabel,
  SCREENER_FIELDS,
  type ScreenerRow,
} from "@/lib/screener/technical";
import { passesPineFilters, runPineOnBars } from "@/lib/screener/pine";
import { isTradableUsdtPair } from "@/lib/server/exchange";
import { clearScreenerCache, runScreener } from "@/lib/server/screener";
import type { OHLCV } from "@/types/trading";

const series = (count: number, fn: (i: number) => number, volume = 100): OHLCV[] =>
  Array.from({ length: count }, (_, i) => {
    const close = fn(i);
    return { time: i * 3_600_000, open: close - 0.2, high: close + 0.6, low: close - 0.6, close, volume };
  });

describe("technical metrics", () => {
  it("needs enough history", () => {
    expect(computeTechnicals(series(30, (i) => 100 + i))).toBeNull();
  });
  it("rates a steady uptrend as a buy with a rising supertrend", () => {
    const t = computeTechnicals(series(260, (i) => 100 + i * 0.5))!;
    expect(t.supertrend).toBe(1);
    expect(t.ema50).toBeGreaterThan(0);
    expect(t.ema200).toBeGreaterThan(0);
    expect(t.adx).toBeGreaterThan(25);
    expect(t.rating).toBeGreaterThan(0.1);
    expect(["Buy", "Strong buy"]).toContain(t.ratingLabel);
  });
  it("rates a steady downtrend as a sell", () => {
    const t = computeTechnicals(series(260, (i) => 400 - i * 0.5))!;
    expect(t.supertrend).toBe(-1);
    expect(t.rating).toBeLessThan(-0.1);
  });
  it("flags oversold conditions and volume spikes", () => {
    const bars = series(100, (i) => 200 - i * 1.5);
    bars[bars.length - 1].volume = 1000;
    const t = computeTechnicals(bars)!;
    expect(t.rsi).toBeLessThan(30);
    expect(t.rvol).toBeGreaterThan(5);
    expect(t.fromHigh20).toBeLessThan(0);
  });
  it("maps scores to labels", () => {
    expect([ratingLabel(-0.9), ratingLabel(-0.3), ratingLabel(0), ratingLabel(0.3), ratingLabel(0.9)]).toEqual([
      "Strong sell",
      "Sell",
      "Neutral",
      "Buy",
      "Strong buy",
    ]);
  });
});

describe("filters", () => {
  const row = (patch: Partial<ScreenerRow>): ScreenerRow => ({
    symbol: "AAAUSDT",
    price: 1,
    change24h: 0,
    quoteVolume: 0,
    volume: 0,
    trades: 0,
    high24h: 1,
    low24h: 1,
    rangePosition: 50,
    ...patch,
  });
  it("supports every operator and rejects missing metrics", () => {
    const r = row({ rsi: 25 });
    const f = (op: Parameters<typeof matchesFilter>[1]["op"], value: number, value2?: number) =>
      matchesFilter(r, { id: "x", field: "rsi", op, value, value2 });
    expect([f("<", 30), f(">", 30), f(">=", 25), f("<=", 24), f("=", 25), f("between", 20, 30), f("between", 30, 40)]).toEqual([
      true,
      false,
      true,
      false,
      true,
      true,
      false,
    ]);
    expect(matchesFilter(row({}), { id: "x", field: "rsi", op: "<", value: 30 })).toBe(false);
  });
  it("ANDs filters and ships sensible presets", () => {
    const rows = [row({ symbol: "A", rsi: 20, rvol: 3 }), row({ symbol: "B", rsi: 20, rvol: 1 }), row({ symbol: "C", rsi: 60, rvol: 3 })];
    const out = applyFilters(rows, [
      { id: "1", field: "rsi", op: "<", value: 30 },
      { id: "2", field: "rvol", op: ">", value: 2 },
    ]);
    expect(out.map((r) => r.symbol)).toEqual(["A"]);
    const keys = new Set(SCREENER_FIELDS.map((f) => f.key));
    for (const preset of BUILT_IN_PRESETS) for (const filter of preset.filters) expect(keys.has(filter.field)).toBe(true);
  });
});

describe("universe selection", () => {
  it("drops leveraged tokens and stablecoin pairs", () => {
    expect(isTradableUsdtPair("BTCUSDT")).toBe(true);
    expect(isTradableUsdtPair("ETHUPUSDT")).toBe(false);
    expect(isTradableUsdtPair("BNBDOWNUSDT")).toBe(false);
    expect(isTradableUsdtPair("USDCUSDT")).toBe(false);
    expect(isTradableUsdtPair("ETHBTC")).toBe(false);
    expect(isTradableUsdtPair("UPUSDT")).toBe(true);
  });
});

describe("server screener", () => {
  afterEach(() => clearScreenerCache());
  const tickers = [
    { symbol: "BTCUSDT", lastPrice: "100", prevClosePrice: "99", priceChangePercent: "1.5", volume: "10", quoteVolume: "50000000", highPrice: "110", lowPrice: "90", count: 1000 },
    { symbol: "ETHUSDT", lastPrice: "10", prevClosePrice: "10", priceChangePercent: "-2", volume: "10", quoteVolume: "20000000", highPrice: "11", lowPrice: "9", count: 500 },
    { symbol: "TINYUSDT", lastPrice: "1", prevClosePrice: "1", priceChangePercent: "0", volume: "1", quoteVolume: "10", highPrice: "1", lowPrice: "1", count: 1 },
    { symbol: "ETHUPUSDT", lastPrice: "1", prevClosePrice: "1", priceChangePercent: "0", volume: "1", quoteVolume: "90000000", highPrice: "1", lowPrice: "1", count: 1 },
  ];
  const candles = Array.from({ length: 250 }, (_, i) => [i * 3_600_000, "100", "101", "99", String(100 + i * 0.1), "10"]);
  const fetcher = () =>
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/ticker/24hr")) return new Response(JSON.stringify(tickers));
      if (url.includes("symbol=ETHUSDT")) return new Response("nope", { status: 500 });
      return new Response(JSON.stringify(candles));
    });
  it("returns quote-only rows ordered by turnover without fetching candles", async () => {
    const f = fetcher();
    const result = await runScreener({}, f as unknown as typeof fetch, 1);
    expect(result.rows.map((r) => r.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(result.rows[0].rangePosition).toBeCloseTo(50, 8);
    expect(f.mock.calls.every((c) => String(c[0]).includes("ticker"))).toBe(true);
  });
  it("adds technicals, reports failed symbols and caches the result", async () => {
    const f = fetcher();
    const result = await runScreener({ timeframe: "1h" }, f as unknown as typeof fetch, 1);
    expect(result.rows[0].rsi).toBeGreaterThan(50);
    expect(result.failed).toEqual(["ETHUSDT"]);
    const calls = f.mock.calls.length;
    await runScreener({ timeframe: "1h" }, f as unknown as typeof fetch, 2);
    expect(f.mock.calls.length).toBe(calls);
  });
  it("rejects tick and invalid intervals", async () => {
    await expect(runScreener({ timeframe: "100T" }, fetcher() as unknown as typeof fetch)).rejects.toThrow(/time-based/);
    await expect(runScreener({ timeframe: "zz" }, fetcher() as unknown as typeof fetch)).rejects.toThrow(/time-based/);
  });
});

describe("pine screener", () => {
  const bars = series(120, (i) => 100 + Math.sin(i / 6) * 10);
  it("returns the latest value of every plot from the real PineTS runtime", async () => {
    const values = await runPineOnBars(
      '//@version=5\nindicator("t")\nplot(ta.rsi(close, 14), "RSI")\nplot(close > open ? 1 : 0, "Up")',
      bars,
      "1h",
    );
    expect(Object.keys(values).sort()).toEqual(["RSI", "Up"]);
    expect(values.RSI).toBeGreaterThanOrEqual(0);
    expect(values.RSI).toBeLessThanOrEqual(100);
  });
  it("surfaces script errors and filters rows", async () => {
    await expect(runPineOnBars("this is not pine", bars, "1h")).rejects.toThrow();
    const row = { symbol: "A", values: { RSI: 25, Other: null } };
    expect(passesPineFilters(row, [{ column: "RSI", op: "<", value: 30 }])).toBe(true);
    expect(passesPineFilters(row, [{ column: "Other", op: ">", value: 0 }])).toBe(false);
    expect(passesPineFilters(row, [{ column: "Missing", op: ">", value: 0 }])).toBe(false);
  });
});

describe("Hyperliquid screener", () => {
  const minute = 3_600_000;
  const base = Math.floor(Date.now() / minute) * minute;
  const meta = (names: string[]) => ({ universe: names.map((name) => ({ name, szDecimals: 3, maxLeverage: 10 })) });
  const ctx = (mark: number, prev: number, volume: number) => ({ markPx: String(mark), prevDayPx: String(prev), dayNtlVlm: String(volume) });
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { type: string; dex?: string; req?: { coin: string; startTime: number; endTime: number } };
    if (body.type === "perpDexs") return new Response(JSON.stringify([null, { name: "xyz", fullName: "XYZ" }]), { status: 200 });
    if (body.type === "metaAndAssetCtxs")
      return new Response(
        JSON.stringify(
          body.dex === "xyz"
            ? [meta(["xyz:TSLA", "xyz:GOLD"]), [ctx(380, 400, 90_000_000), ctx(4000, 3980, 5_000)]]
            : [meta(["BTC", "ETH"]), [ctx(80_000, 78_000, 2_000_000_000), ctx(2400, 2500, 500_000_000)]],
        ),
        { status: 200 },
      );
    const { coin, startTime, endTime } = body.req!;
    const rows = Array.from({ length: 300 }, (_, i) => base - (299 - i) * minute)
      .filter((t) => t >= startTime && t <= endTime)
      .map((t, i) => {
        const close = coin === "BTC" ? 100 + i * 0.5 : 400 - i * 0.5;
        return { t, o: String(close - 0.2), h: String(close + 0.6), l: String(close - 0.6), c: String(close), v: "100" };
      });
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as unknown as typeof fetch;

  afterEach(() => clearScreenerCache());

  it("lists crypto perps by turnover with 24h change and no invented range", async () => {
    const result = await runScreener({ market: "hyperliquid", limit: 10 }, fetcher);
    expect(result.rows.map((r) => r.symbol)).toEqual(["HL:BTC", "HL:ETH"]);
    expect(result.rows[0]).toMatchObject({ price: 80_000, quoteVolume: 2_000_000_000 });
    expect(result.rows[0].change24h).toBeCloseTo(2.564, 2);
    expect(result.rows[1].change24h).toBeCloseTo(-4, 5);
    expect(result.rows[0].rangePosition).toBeNaN();
  });
  it("lists builder-dex equities and metals separately and drops thin markets", async () => {
    const result = await runScreener({ market: "hyperliquid-markets", limit: 10 }, fetcher);
    expect(result.rows.map((r) => r.symbol)).toEqual(["HL:xyz:TSLA"]);
    const all = await runScreener({ market: "hyperliquid-markets", limit: 10, minTurnover: 0 }, fetcher);
    expect(all.rows.map((r) => r.symbol)).toEqual(["HL:xyz:TSLA", "HL:xyz:GOLD"]);
  });
  it("computes technicals from Hyperliquid candles", async () => {
    const result = await runScreener({ market: "hyperliquid", timeframe: "1h", limit: 10 }, fetcher);
    const btc = result.rows.find((r) => r.symbol === "HL:BTC")!;
    const eth = result.rows.find((r) => r.symbol === "HL:ETH")!;
    expect(btc.supertrend).toBe(1);
    expect(eth.supertrend).toBe(-1);
    expect(result.failed).toEqual([]);
  });
  it("keeps markets apart in the cache and rejects unknown ones", async () => {
    const a = await runScreener({ market: "hyperliquid", limit: 10 }, fetcher);
    const b = await runScreener({ market: "hyperliquid-markets", limit: 10 }, fetcher);
    expect(a.rows[0].symbol).not.toBe(b.rows[0].symbol);
    await expect(runScreener({ market: "nasdaq" as never, limit: 10 }, fetcher)).rejects.toThrow(/Unknown market/);
  });
});
