import { afterEach, describe, expect, it, vi } from "vitest";
import { STOCK_UNIVERSE_IDS, universeFor } from "@/lib/stockUniverse";
import { isYahooTicker } from "@/lib/symbolId";
import { exchangeOfTicker, STOCK_EXCHANGES } from "@/lib/markets";
import { clearScreenerCache, runScreener } from "@/lib/server/screener";
import { clearYahooCache } from "@/lib/server/yahoo";

describe("stock universes", () => {
  it("only lists valid, unique Yahoo tickers", () => {
    for (const id of STOCK_UNIVERSE_IDS) {
      const universe = universeFor(id)!;
      expect(universe.tickers.length, id).toBeGreaterThan(1);
      expect(new Set(universe.tickers).size, id).toBe(universe.tickers.length);
      for (const ticker of universe.tickers) expect(isYahooTicker(ticker), `${id}:${ticker}`).toBe(true);
    }
  });
  it("keeps every ticker on its own exchange", () => {
    for (const id of STOCK_UNIVERSE_IDS.filter((x) => x !== "us"))
      for (const ticker of universeFor(id)!.tickers) expect(exchangeOfTicker(ticker).id, ticker).toBe(id);
  });
  it("offers a broad US list and rejects unknown exchanges", () => {
    expect(universeFor("us")!.tickers.length).toBeGreaterThan(90);
    expect(universeFor("us")!.tickers).toContain("AAPL");
    expect(universeFor("atlantis")).toBeNull();
    expect(STOCK_UNIVERSE_IDS.length).toBeGreaterThanOrEqual(15);
    expect(STOCK_UNIVERSE_IDS.every((id) => STOCK_EXCHANGES.some((e) => e.id === id))).toBe(true);
  });
});

describe("stock screener", () => {
  afterEach(() => {
    clearScreenerCache();
    clearYahooCache();
  });
  const day = 86_400_000;
  const fetcher = vi.fn(async (url: unknown) => {
    const u = new URL(String(url));
    if (u.pathname.includes("/spark")) {
      const symbols = (u.searchParams.get("symbols") ?? "").split(",");
      const body = Object.fromEntries(
        symbols
          .filter((s) => s !== "MISSING")
          .map((s, i) => [s, { timestamp: [1, 2, 3], close: [100, 101 + i, 102 + i], previousClose: 100 }]),
      );
      return new Response(JSON.stringify(body), { status: 200 });
    }
    // chart endpoint: a steady climb
    const timestamps = Array.from({ length: 300 }, (_, i) => Math.floor((Date.now() - (299 - i) * day) / 1000));
    const close = timestamps.map((_, i) => 100 + i * 0.5);
    return new Response(
      JSON.stringify({
        chart: {
          result: [
            {
              meta: { symbol: "X", longName: "X Corp", exchangeName: "NMS", currency: "USD", instrumentType: "EQUITY", exchangeTimezoneName: "America/New_York", regularMarketPrice: 250, chartPreviousClose: 249 },
              timestamp: timestamps,
              indicators: { quote: [{ open: close, high: close.map((c) => c + 1), low: close.map((c) => c - 1), close, volume: close.map((_, i) => (i >= 296 ? 0 : 1000)) }], adjclose: [{ adjclose: close }] },
            },
          ],
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  it("returns quotes sorted by the size of the move, without inventing volume", async () => {
    const result = await runScreener({ market: "stocks:us", limit: 5 }, fetcher);
    expect(result.rows.length).toBe(5);
    expect(result.rows.every((r) => r.symbol.startsWith("YF:"))).toBe(true);
    const moves = result.rows.map((r) => Math.abs(r.change24h));
    expect([...moves].sort((a, b) => b - a)).toEqual(moves);
    expect(result.rows[0].quoteVolume).toBeNaN();
  });
  it("rejects an unknown exchange", async () => {
    await expect(runScreener({ market: "stocks:atlantis", limit: 5 }, fetcher)).rejects.toThrow(/Unknown market/);
  });
  it("computes technicals from daily candles", async () => {
    const result = await runScreener({ market: "stocks:us", timeframe: "1D", limit: 4 }, fetcher);
    expect(result.failed).toEqual([]);
    expect(result.rows.every((r) => r.supertrend === 1)).toBe(true);
    expect(result.rows[0].rsi).toBeGreaterThan(50);
    // The empty closing bars are ignored, so volume ratios stay meaningful.
    expect(result.rows[0].rvol).toBeGreaterThan(0.5);
  });
});
