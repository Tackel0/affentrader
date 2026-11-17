import { describe, it, expect, vi, afterEach } from "vitest";
import type { OHLCV } from "@/types/trading";
import type { StrategyRunRequest } from "@/types/strategy";
import {
  DEFAULT_STRATEGY_SETTINGS,
  parseStrategyDocument,
  validateStrategySettings,
} from "@/lib/strategy/settings";
import { executeStrategy, inspectStrategy } from "@/lib/strategy/engine";
import { loadStrategyDataset } from "@/lib/strategy/data";
import { strategyTradesCSV } from "@/lib/strategy/report";
import { STRATEGY_EXAMPLES } from "@/lib/strategy/scripts";
import { generateHistory } from "@/lib/market/mock";

const start = 1700000040000;
const bars: OHLCV[] = [100, 110, 120, 130, 125, 115].map((p, i) => ({
  time: start + i * 60000,
  open: p,
  high: p + 3,
  low: p - 3,
  close: p + 1,
  volume: 10,
}));
function request(source: string, data = bars): StrategyRunRequest {
  return {
    id: "test",
    document: {
      name: "Test",
      source,
      inputs: {},
      settings: {
        ...DEFAULT_STRATEGY_SETTINGS,
        quantityType: "fixed",
        quantity: 1,
        commission: 1,
        slippage: 1,
      },
    },
    dataset: {
      market: {
        symbol: "BTCUSDT",
        timeframe: "1m",
        tickSize: 0.01,
        quantityStep: 0.00001,
        base: "BTC",
      },
      bars: data,
      source: "exchange",
      warnings: [],
    },
    libraries: {},
  };
}
const probe = `//@version=6
strategy("Fill probe")
if bar_index == 0
    strategy.entry("L", strategy.long)
if bar_index == 2
    strategy.close("L")
`;
afterEach(() => vi.unstubAllGlobals());
describe("actual PineTS broker and reports", () => {
  it("fills on the next open and includes both commissions and adverse tick slippage", async () => {
    const report = await executeStrategy(request(probe));
    expect(report.trades).toHaveLength(1);
    const trade = report.trades[0];
    expect(trade.entryTime).toBe(bars[1].time);
    expect(trade.exitTime).toBe(bars[3].time);
    expect(trade.entryPrice).toBeCloseTo(110.01);
    expect(trade.exitPrice).toBeCloseTo(129.99);
    expect(trade.commission).toBeCloseTo(2.4);
    expect(trade.netProfit).toBeCloseTo(17.58);
    expect(report.netProfit).toBeCloseTo(17.58);
    expect(report.equity).toBeCloseTo(10017.58);
    expect(report.equityCurve.at(-1)!.equity).toBeCloseTo(report.equity);
    expect(report.all.profitFactor).toBe(Infinity);
    expect(report.short.count).toBe(0);
    expect(report.short.winRate).toBeNull();
  });
  it("applies same-close fills only when explicitly selected", async () => {
    const r = request(probe);
    r.document.settings.fillOnClose = true;
    const report = await executeStrategy(r);
    expect(report.trades[0].entryTime).toBe(bars[0].time);
    expect(report.trades[0].entryPrice).toBeCloseTo(101.01);
    expect(report.trades[0].exitTime).toBe(bars[2].time);
  });
  it("keeps an open position separate from closed-trade statistics", async () => {
    const report = await executeStrategy(
      request(
        '//@version=6\nstrategy("Open")\nif bar_index == 0\n    strategy.entry("Long", strategy.long)',
      ),
    );
    expect(report.trades[0].open).toBe(true);
    expect(report.trades[0].exitTime).toBeNull();
    expect(report.all.count).toBe(0);
    expect(report.openProfit).not.toBe(0);
    expect(report.equityCurve).toHaveLength(bars.length);
  });
  it("handles short fills and a price stop through the broker emulator", async () => {
    const r = request(
      '//@version=6\nstrategy("Short stop")\nif bar_index == 0\n    strategy.entry("S", strategy.short)\nstrategy.exit("Stop", "S", stop=120)',
    );
    r.document.settings.commission = 0;
    r.document.settings.slippage = 0;
    const report = await executeStrategy(r);
    expect(report.trades[0].side).toBe("short");
    expect(report.trades[0].exitPrice).toBe(120);
    expect(report.short.netProfit).toBe(-10);
    expect(report.long.count).toBe(0);
  });
  it.each([
    ["cash_per_order", 2, 36],
    ["cash_per_contract", 0.5, 38],
  ] as const)(
    "applies %s commissions on both legs",
    async (commissionType, commission, expected) => {
      const r = request(probe);
      r.document.settings = {
        ...r.document.settings,
        quantity: 2,
        commissionType,
        commission,
        slippage: 0,
      };
      const report = await executeStrategy(r);
      expect(report.netProfit).toBeCloseTo(expected);
      expect(report.trades[0].commission).toBeCloseTo(40 - expected);
    },
  );
  it("uses the registered library resolver and secondary historical feed for a strategy", async () => {
    const r = request(
      `//@version=6
import Affentrader/Math/1 as m
strategy("MTF")
five = request.security(syminfo.tickerid, "5", close)
if bar_index == 20 and m.positive(five)
    strategy.entry("Long", strategy.long)
`,
      generateHistory("BTCUSDT", "1m", 100, start),
    );
    r.document.settings.quantity = 0.01;
    r.libraries["Affentrader/Math/1"] =
      '//@version=6\nlibrary("Math")\nexport positive(float x) =>\n    x > 0\n';
    const fetchSeries = vi
      .fn()
      .mockResolvedValue({
        ...r.dataset,
        market: { ...r.dataset.market, timeframe: "5m" },
        bars: generateHistory("BTCUSDT", "5m", 100, start),
      });
    const report = await executeStrategy(r, undefined, fetchSeries);
    expect(fetchSeries).toHaveBeenCalled();
    expect(report.trades).toHaveLength(1);
    expect(report.equityCurve).toHaveLength(100);
    await expect(
      executeStrategy(r, undefined, async () => {
        throw new Error("Historical source down");
      }),
    ).rejects.toThrow("Historical source down");
  });
  it("scans typed inputs and rejects indicator scripts", async () => {
    const result = await inspectStrategy(
      STRATEGY_EXAMPLES["EMA crossover"],
      {},
    );
    expect(result.inputs.find((i) => i.title === "Fast length")?.defval).toBe(
      12,
    );
    await expect(
      inspectStrategy(
        '//@version=6\nindicator("No strategy")\nplot(close)',
        {},
      ),
    ).rejects.toThrow("strategy()");
    const r = request(STRATEGY_EXAMPLES["EMA crossover"]);
    r.document.inputs = { in_0: 0 };
    await expect(executeStrategy(r)).rejects.toThrow("numeric range");
  });
  it.each(Object.entries(STRATEGY_EXAMPLES))(
    "executes %s across multiple runtime pages",
    async (_, source) => {
      const r = request(source, generateHistory("BTCUSDT", "1m", 1200, start));
      r.document.settings.quantity = 0.01;
      if (source === STRATEGY_EXAMPLES["EMA crossover"])
        r.document.inputs = { "Fast length": 3, "Slow length": 8 };
      const progress = vi.fn();
      const report = await executeStrategy(r, progress);
      expect(report.equityCurve).toHaveLength(1200);
      expect(report.trades.length).toBeGreaterThan(0);
      expect(progress.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(report.equityCurve.at(-1)!.equity).toBeCloseTo(report.equity, 6);
    },
  );
  it("exports precise trade records with data provenance and safe CSV quoting", async () => {
    const report = await executeStrategy(
      request(probe.replace('"L"', '"L,1"')),
    );
    const csv = strategyTradesCSV(report);
    expect(csv).toContain('"L,1"');
    expect(csv).toContain('"BTCUSDT","1m","exchange"');
    expect(csv.split("\r\n")).toHaveLength(report.trades.length + 1);
  });
});
describe("frozen historical data and validation", () => {
  it("excludes the forming candle and never falls back to simulation on an exchange error", async () => {
    const now = Date.now();
    const aligned = Math.floor(now / 60000) * 60000;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) =>
        url.includes("exchangeInfo")
          ? {
              ok: true,
              json: async () => ({
                symbols: [
                  {
                    symbol: "BTCUSDT",
                    baseAsset: "BTC",
                    filters: [
                      { filterType: "PRICE_FILTER", tickSize: "0.01" },
                      { filterType: "LOT_SIZE", stepSize: "0.00001" },
                    ],
                  },
                ],
              }),
            }
          : {
              ok: true,
              json: async () =>
                [
                  aligned - 180000,
                  aligned - 120000,
                  aligned - 60000,
                  aligned,
                ].map((t) => [t, "100", "101", "99", "100", "10"]),
            },
      ),
    );
    const data = await loadStrategyDataset(
      "BTCUSDT",
      "1m",
      { ...DEFAULT_STRATEGY_SETTINGS, bars: 100 },
      new AbortController().signal,
    );
    expect(data.bars).toHaveLength(3);
    expect(data.bars.at(-1)!.time).toBe(aligned - 60000);
    expect(data.market.tickSize).toBe(0.01);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );
    await expect(
      loadStrategyDataset(
        "BTCUSDT",
        "1m",
        DEFAULT_STRATEGY_SETTINGS,
        new AbortController().signal,
      ),
    ).rejects.toThrow("HTTP 503");
  });
  it("requires explicit synthetic source and labels it in results", async () => {
    const dataset = await loadStrategyDataset(
      "BTCUSDT",
      "1m",
      { ...DEFAULT_STRATEGY_SETTINGS, source: "simulation", bars: 100 },
      new AbortController().signal,
    );
    expect(dataset.source).toBe("simulation");
    expect(dataset.warnings[0]).toContain("Synthetic");
    expect(dataset.bars).toHaveLength(100);
    expect(dataset.bars.at(-1)!.time + 60000).toBeLessThanOrEqual(Date.now());
  });
  it("paginates 20,000 distinct completed bars without touching the live feed", async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("exchangeInfo"))
        return {
          ok: true,
          json: async () => ({
            symbols: [
              {
                symbol: "BTCUSDT",
                baseAsset: "BTC",
                filters: [
                  { filterType: "PRICE_FILTER", tickSize: "0.01" },
                  { filterType: "LOT_SIZE", stepSize: "0.00001" },
                ],
              },
            ],
          }),
        };
      const q = new URL(`http://localhost${url}`).searchParams;
      const end = Math.floor(Number(q.get("endTime")) / 60000) * 60000;
      const length = Number(q.get("limit"));
      return {
        ok: true,
        json: async () =>
          Array.from({ length }, (_, i) => [
            end - (length - i - 1) * 60000,
            100,
            101,
            99,
            100,
            10,
          ]),
      };
    });
    vi.stubGlobal("fetch", fetch);
    const data = await loadStrategyDataset(
      "BTCUSDT",
      "1m",
      { ...DEFAULT_STRATEGY_SETTINGS, bars: 20000 },
      new AbortController().signal,
    );
    expect(data.bars).toHaveLength(20000);
    expect(new Set(data.bars.map((b) => b.time)).size).toBe(20000);
    expect(fetch).toHaveBeenCalledTimes(21);
    expect(data.bars.at(-1)!.time + 60000).toBeLessThanOrEqual(Date.now());
    expect(data.warnings).toEqual([]);
  });
  it("rejects invalid ranges, nonfinite execution values and unexpected import fields", () => {
    expect(() =>
      validateStrategySettings({ ...DEFAULT_STRATEGY_SETTINGS, capital: NaN }),
    ).toThrow("Initial capital");
    expect(() =>
      validateStrategySettings({
        ...DEFAULT_STRATEGY_SETTINGS,
        from: "2026-10-23T12:00",
        to: "2026-10-22T12:00",
      }),
    ).toThrow("start");
    expect(() =>
      parseStrategyDocument({ ...request(probe).document, set: "injected" }),
    ).toThrow("Unexpected");
  });
});
