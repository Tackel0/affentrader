import { afterEach, describe, expect, it, vi } from "vitest";
import { executeStrategy, strategySymbolInfo } from "@/lib/strategy/engine";
import { loadStrategyDataset, strategyTimeframe } from "@/lib/strategy/data";
import { DEFAULT_STRATEGY_SETTINGS } from "@/lib/strategy/settings";
import { strategyTradesCSV } from "@/lib/strategy/report";
import { tradePercent, summarizeReport } from "@/lib/strategy/analysis";
import { nextBucket } from "@/lib/market/intervals";
import type { StrategyMarket, StrategyRunRequest } from "@/types/strategy";

const start = Date.UTC(2026, 9, 1);
function request(
  currency: string,
  market: Partial<StrategyMarket> = {},
): StrategyRunRequest {
  return {
    id: "multi-market",
    libraries: {},
    document: {
      name: "Accounting",
      inputs: {},
      settings: {
        ...DEFAULT_STRATEGY_SETTINGS,
        quantityType: "fixed",
        quantity: 1,
        commission: 0,
        slippage: 0,
      },
      source: `//@version=6\nstrategy("Accounting")\nif bar_index == 0 and strategy.account_currency == "${currency}" and syminfo.currency == "${currency}"\n    strategy.entry("L", strategy.long)\nif bar_index == 2\n    strategy.close("L")`,
    },
    dataset: {
      source: "exchange",
      warnings: [],
      market: {
        symbol: "YF:SAP.DE",
        timeframe: "1m",
        tickSize: 0.01,
        quantityStep: 1,
        base: "SAP.DE",
        provider: "yahoo",
        currency,
        timezone: "Europe/Berlin",
        type: "stock",
        ...market,
      },
      bars: [100, 110, 120, 130, 125, 115].map((p, i) => ({
        time: start + i * 60000,
        open: p,
        high: p + 3,
        low: p - 3,
        close: p + 1,
        volume: 100,
      })),
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("strategy broker uses the actual provider and account units", () => {
  it.each(["EUR", "USD", "USDC", "GBp"])(
    "keeps %s as the runtime and report unit without FX conversion",
    async (currency) => {
      const r = request(currency);
      const result = await executeStrategy(r);
      expect(result.trades).toHaveLength(1);
      expect(result.netProfit).toBe(20);
      expect(result.market.currency).toBe(currency);
      expect(summarizeReport(result).currency).toBe(currency);
      const csv = strategyTradesCSV(result);
      expect(csv).toContain('"account_currency"');
      expect(csv).toContain(`"${currency}"`);
      expect(csv).not.toContain("pnl_usdt");
    },
  );
  it("applies contract point value to broker P&L, open positions and percentage returns", async () => {
    const r = request("USD", {
      symbol: "YF:GC=F",
      pointValue: 10,
      type: "future",
    });
    const report = await executeStrategy(r);
    expect(report.netProfit).toBe(200);
    expect(report.trades[0].pointValue).toBe(10);
    expect(tradePercent(report.trades[0])).toBeCloseTo((200 / 1100) * 100);
    r.document.source = r.document.source.replace(
      "if bar_index == 2",
      "if bar_index == 200",
    );
    const open = await executeStrategy(r);
    expect(open.trades[0].open).toBe(true);
    expect(open.trades[0].netProfit).toBe(60);
    expect(open.equity).toBe(10060);
  });
  it("supports Hyperliquid prefixed symbols, lot sizes and USDC accounting", async () => {
    const r = request("USDC", {
      symbol: "HL:xyz:TSLA",
      provider: "hyperliquid",
      base: "TSLA",
      quantityStep: 0.01,
    });
    expect(strategySymbolInfo(r.dataset.market)).toMatchObject({
      tickerid: "HL:xyz:TSLA",
      prefix: "HYPERLIQUID",
      mincontract: 0.01,
    });
    expect((await executeStrategy(r)).netProfit).toBe(20);
  });
  it.each(["45S", "7", "180", "3D", "2W", "1M", "10080"])(
    "canonicalizes and executes custom %s intervals",
    async (raw) => {
      const timeframe = strategyTimeframe(raw),
        r = request("USDT", {
          symbol: "BTCUSDT",
          provider: "binance",
          timeframe,
        });
      let time = start;
      r.dataset.bars = r.dataset.bars.map((bar) => {
        const out = { ...bar, time };
        time = nextBucket(timeframe, time);
        return out;
      });
      const report = await executeStrategy(r);
      expect(report.equityCurve).toHaveLength(6);
      expect(report.trades[0].entryTime).toBe(r.dataset.bars[1].time);
      expect(report.netProfit).toBe(20);
    },
  );
  it("rejects synthetic tick-clock backtests instead of substituting a time interval", () => {
    expect(() => strategyTimeframe("100T")).toThrow("event-time");
  });
});
describe("provider-specific historical datasets", () => {
  const settings = {
    ...DEFAULT_STRATEGY_SETTINGS,
    bars: 100,
    to: "2026-10-23T00:00",
  };
  const rows = Array.from({ length: 110 }, (_, i) => [
    Date.UTC(2026, 5, 1 + i, 13, 30),
    100,
    110,
    90,
    105,
    1000,
  ]);
  function yahooFetch(type = "stock") {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        meta: { currency: "EUR", timezone: "Europe/Berlin", type },
        rows,
        adj: [],
        events: { dividends: [], splits: [] },
      }),
    });
  }
  it("loads Yahoo history with real currency and retains session timestamps and notices", async () => {
    vi.stubGlobal("fetch", yahooFetch());
    const dataset = await loadStrategyDataset(
      "YF:SAP.DE",
      "1D",
      settings,
      new AbortController().signal,
    );
    expect(dataset.market).toMatchObject({
      currency: "EUR",
      provider: "yahoo",
      tickSource: "estimated",
      timezone: "Europe/Berlin",
    });
    expect(new Date(dataset.bars[0].time).getUTCHours()).toBe(13);
    expect(dataset.warnings.some((w) => w.includes("unofficial"))).toBe(true);
    expect(dataset.warnings.some((w) => w.includes("time_close"))).toBe(true);
  });
  it("requires a futures contract multiplier and records explicit execution-rule overrides", async () => {
    vi.stubGlobal("fetch", yahooFetch("future"));
    await expect(
      loadStrategyDataset(
        "YF:GC=F",
        "1D",
        settings,
        new AbortController().signal,
      ),
    ).rejects.toThrow("point value");
    const dataset = await loadStrategyDataset(
      "YF:GC=F",
      "1D",
      { ...settings, pointValue: 100, tickSize: 0.1, quantityStep: 1 },
      new AbortController().signal,
    );
    expect(dataset.market).toMatchObject({
      pointValue: 100,
      tickSize: 0.1,
      tickSource: "user",
      quantitySource: "user",
    });
  });
  it("omits flat zero-volume stock rows without removing legitimate zero-volume forex prices", async () => {
    const flatTime = rows.at(-1)![0] + 86400000;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            meta: { currency: "EUR", timezone: "Europe/Berlin", type: "stock" },
            rows: [...rows, [flatTime, 105, 105, 105, 105, 0]],
            adj: [],
            events: {},
          }),
        }),
    );
    const stocks = await loadStrategyDataset(
      "YF:SAP.DE",
      "1D",
      settings,
      new AbortController().signal,
    );
    expect(stocks.bars.some((b) => b.time === flatTime)).toBe(false);
    expect(stocks.warnings.some((w) => w.includes("zero-volume"))).toBe(true);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            meta: { currency: "USD", timezone: "UTC", type: "forex" },
            rows: [...rows, [flatTime, 105, 105, 105, 105, 0]],
            adj: [],
            events: {},
          }),
        }),
    );
    expect(
      (
        await loadStrategyDataset(
          "YF:EURUSD=X",
          "1D",
          settings,
          new AbortController().signal,
        )
      ).bars.some((b) => b.time === flatTime),
    ).toBe(true);
  });
  it("builds requested custom Binance candles from validated native bars", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("exchangeInfo"))
          return {
            ok: true,
            json: async () => ({
              symbols: [
                {
                  symbol: "BTCUSDT",
                  baseAsset: "BTC",
                  quoteAsset: "USDT",
                  filters: [
                    { filterType: "PRICE_FILTER", tickSize: ".01" },
                    { filterType: "LOT_SIZE", stepSize: ".00001" },
                  ],
                },
              ],
            }),
          };
        const params = new URL(`http://localhost${url}`).searchParams;
        expect(params.get("interval")).toBe("1m");
        const last = Math.floor(Number(params.get("endTime")) / 60000) * 60000;
        const length = Number(params.get("limit"));
        return {
          ok: true,
          json: async () =>
            Array.from({ length }, (_, i) => [
              last - (length - i - 1) * 60000,
              100,
              110,
              90,
              105,
              10,
            ]),
        };
      }),
    );
    const dataset = await loadStrategyDataset(
      "BTCUSDT",
      "7m",
      settings,
      new AbortController().signal,
    );
    expect(dataset.bars).toHaveLength(100);
    expect(
      dataset.bars.every((b) => b.time % 420000 === 0 && b.volume === 70),
    ).toBe(true);
    expect(dataset.bars.at(-1)!.time + 420000).toBeLessThanOrEqual(
      Date.parse(settings.to + "Z"),
    );
  });
  it("loads Hyperliquid data through its own metadata and candle route", async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) =>
      url.includes("kind=assets")
        ? {
            ok: true,
            json: async () => ({
              assets: [
                {
                  symbol: "HL:BTC",
                  name: "BTC",
                  mark: 100000,
                  szDecimals: 5,
                },
              ],
            }),
          }
        : {
            ok: true,
            json: async () => ({
              candles: rows.slice(0, 50).map((r) => ({
                t: r[0],
                o: 100,
                h: 110,
                l: 90,
                c: 105,
                v: 10,
              })),
            }),
          },
    );
    vi.stubGlobal("fetch", fetcher);
    const dataset = await loadStrategyDataset(
      "HL:BTC",
      "1D",
      settings,
      new AbortController().signal,
    );
    expect(dataset.market).toMatchObject({
      currency: "USDC",
      quantityStep: 0.00001,
      quantitySource: "exchange",
    });
    expect(
      fetcher.mock.calls.every(([url]) =>
        String(url).startsWith("/api/hyperliquid"),
      ),
    ).toBe(true);
    expect(dataset.warnings.some((w) => w.includes("funding"))).toBe(true);
  });
});
