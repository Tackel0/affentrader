import { afterEach, describe, expect, it, vi } from "vitest";
import type { OHLCV } from "@/types/trading";
import type { StrategyRunRequest } from "@/types/strategy";
import { executeStrategy } from "@/lib/strategy/engine";
import { strategyEquityCSV, strategyTradesCSV } from "@/lib/strategy/report";
import { summarizeReport } from "@/lib/strategy/analysis";
import { loadStrategyDataset } from "@/lib/strategy/data";
import { DEFAULT_STRATEGY_SETTINGS, validateStrategySettings } from "@/lib/strategy/settings";
import { loadMagnifierDataset, magnifierInterval, prepareMagnifier } from "@/lib/strategy/magnifier";

const start = Date.UTC(2026, 0, 1);
afterEach(() => vi.unstubAllGlobals());
const bar = (minute: number, open = 100, high = open, low = open, close = open): OHLCV =>
  ({ time: start + minute * 60_000, open, high, low, close, volume: 10 });
function fixture(source = `//@version=6
strategy("Chronology")
if bar_index == 0
    strategy.entry("L", strategy.long, stop=110)
strategy.exit("Stop", "L", stop=90)
`): StrategyRunRequest {
  return {
    id: "magnifier", libraries: {},
    document: { name: "Chronology", source, inputs: {}, settings: {
      ...DEFAULT_STRATEGY_SETTINGS, quantityType: "fixed", quantity: 1, commission: 0, slippage: 0,
      useBarMagnifier: true, intrabarInterval: "1m",
    } },
    dataset: { market: { symbol: "BTCUSDT", timeframe: "4m", tickSize: 0.01, quantityStep: 0.001, base: "BTC" },
      source: "exchange", warnings: [], bars: [bar(0), bar(4, 100, 121, 80, 100), bar(8)],
      intrabars: { timeframe: "1m", bars: [bar(0), bar(1), bar(2), bar(3),
        bar(4, 100, 121, 100, 115), bar(5, 115, 115, 80, 90), bar(6, 90, 100, 90, 100), bar(7),
        bar(8), bar(9), bar(10), bar(11)] },
    },
  };
}
describe("in-run native broker magnification", () => {
  it("uses the lower chronology for entry and stop in the same parent candle", async () => {
    const request = fixture();
    const native = await executeStrategy({ ...request, document: { ...request.document, settings: { ...request.document.settings, useBarMagnifier: false } } });
    const fine = await executeStrategy(request);
    expect(native.trades[0].open).toBe(true);
    expect(fine.trades).toHaveLength(1);
    expect(fine.trades[0]).toMatchObject({ entryPrice: 110, exitPrice: 90, entryBar: 1, exitBar: 1, netProfit: -20, open: false });
    expect(fine.equityCurve).toHaveLength(3);
    expect(fine.trades[0].runup).toBeCloseTo(11);
    expect(fine.trades[0].drawdown).toBeCloseTo(20);
    expect(fine.magnifier).toMatchObject({ enabled: true, sourceBars: 12, coveredBars: 3, fallbackBars: 0 });
    expect(strategyTradesCSV(fine)).toContain('"bar_magnifier","intrabar_interval"');
    expect(strategyTradesCSV(fine)).toContain('"true","1m","3","0"');
    expect(strategyEquityCSV(fine)).toContain('"true","1m","3","0"');
    expect(summarizeReport(fine).magnifier).toEqual(fine.magnifier);
  });
  it("fills a gap-through stop at the next intrabar open", async () => {
    const request = fixture();
    request.dataset.intrabars!.bars[4] = bar(4, 100, 121, 100, 115);
    request.dataset.intrabars!.bars[5] = bar(5, 85, 100, 80, 90);
    const report = await executeStrategy(request);
    expect(report.trades[0]).toMatchObject({ entryPrice: 110, exitPrice: 85, netProfit: -25 });
  });
  it("preserves next-open markets, contract P&L, fees and tick slippage", async () => {
    const request = fixture(`//@version=6
strategy("Market")
if bar_index == 0
    strategy.entry("L", strategy.long)
if bar_index == 1
    strategy.close("L")`);
    request.dataset.market.pointValue = 5;
    request.document.settings.commissionType = "cash_per_order";
    request.document.settings.commission = 1;
    request.document.settings.slippage = 2;
    const report = await executeStrategy(request);
    expect(report.trades[0]).toMatchObject({ entryBar: 1, exitBar: 2, commission: 2 });
    expect(report.trades[0].entryPrice).toBeCloseTo(100.02);
    expect(report.trades[0].exitPrice).toBeCloseTo(99.98);
    expect(report.netProfit).toBeCloseTo(-2.2);
    expect(report.equityCurve.at(-1)!.equity).toBeCloseTo(report.equity);
  });
  it("keeps Pine calculations on the parent series, including recalculation on fills", async () => {
    const request = fixture(`//@version=6
strategy("Recalculation", calc_on_order_fills=true)
if bar_index == 0
    strategy.entry("L", strategy.long, stop=110)
if strategy.position_size > 0
    strategy.exit("Stop", "L", stop=90)
plot(ta.sma(close, 2), "SMA")`);
    const report = await executeStrategy(request);
    expect(report.trades[0]).toMatchObject({ entryBar: 1, exitBar: 1, entryPrice: 110, exitPrice: 90 });
    expect(report.equityCurve).toHaveLength(3);
    expect(report.equityCurve.every(point => Number.isFinite(point.equity))).toBe(true);
  });
  it("takes the first OCA entry along the lower path and cancels its sibling", async () => {
    const request = fixture(`//@version=6
strategy("OCA")
if bar_index == 0
    strategy.entry("Up", strategy.long, stop=110, oca_name="First", oca_type=strategy.oca.cancel)
    strategy.entry("Down", strategy.long, limit=90, oca_name="First", oca_type=strategy.oca.cancel)`);
    const report = await executeStrategy(request);
    expect(report.trades).toHaveLength(1);
    expect(report.trades[0]).toMatchObject({ entryId: "Up", entryPrice: 110, open: true });
  });
  it("retains stop-limit activation and protective exits across lower candles", async () => {
    const request = fixture(`//@version=6
strategy("Stop limit")
if bar_index == 0
    strategy.entry("L", strategy.long, stop=110, limit=105)
strategy.exit("Stop", "L", stop=90)`);
    const report = await executeStrategy(request);
    expect(report.trades[0]).toMatchObject({ entryPrice: 105, exitPrice: 90, netProfit: -15, entryBar: 1, exitBar: 1 });
  });
  it("walks a trailing stop across activation, a new peak and reversal", async () => {
    const request = fixture(`//@version=6
strategy("Trail")
if bar_index == 0
    strategy.entry("L", strategy.long)
strategy.exit("Trail", "L", trail_points=1000, trail_offset=500)`);
    const report = await executeStrategy(request);
    expect(report.trades[0]).toMatchObject({ entryPrice: 100, exitPrice: 116, netProfit: 16 });
  });
  it("uses short-side stop entry and take profit with the correct sign", async () => {
    const request = fixture(`//@version=6
strategy("Short")
if bar_index == 0
    strategy.entry("S", strategy.short, stop=90)
strategy.exit("TP", "S", limit=85)`);
    const report = await executeStrategy(request);
    expect(report.trades[0]).toMatchObject({ side: "short", entryPrice: 90, exitPrice: 85, netProfit: 5 });
  });
  it("honors parent-close order execution after the magnified path", async () => {
    const request = fixture(`//@version=6
strategy("Close")
if bar_index == 0
    strategy.entry("L", strategy.long)
if bar_index == 1
    strategy.close("L")`);
    request.document.settings.fillOnClose = true;
    const report = await executeStrategy(request);
    expect(report.trades[0]).toMatchObject({ entryBar: 0, exitBar: 1, entryPrice: 100, exitPrice: 100 });
  });
});
describe("coverage and frozen lower history", () => {
  it("falls back per incomplete candle and exposes exact coverage", () => {
    const dataset = fixture().dataset;
    dataset.intrabars!.bars = dataset.intrabars!.bars.filter(b => b.time !== bar(1).time);
    const result = prepareMagnifier(dataset, true);
    expect(result.summary).toMatchObject({ coveredBars: 2, fallbackBars: 1, incompleteBars: 1, mismatchedBars: 0,
      firstCoveredTime: bar(4).time, lastCoveredTime: bar(8).time });
    expect(result.paths.has(bar(0).time)).toBe(false);
  });
  it("rejects an OHLC mismatch and does not consume future lower candles", () => {
    const dataset = fixture().dataset;
    dataset.intrabars!.bars[0].high = 200;
    dataset.intrabars!.bars.push(bar(12, 500));
    const result = prepareMagnifier(dataset, true);
    expect(result.summary).toMatchObject({ coveredBars: 2, mismatchedBars: 1 });
    expect([...result.paths.values()].flatMap(p => p.prices)).not.toContain(500);
  });
  it("chooses the nearer extreme on the same tick grid used for broker fills", () => {
    const dataset = fixture().dataset;
    dataset.bars[0] = bar(0, 99.999, 110, 90, 100);
    dataset.intrabars!.bars[0] = bar(0, 99.999, 110, 90, 100);
    expect(prepareMagnifier(dataset, true).paths.get(bar(0).time)!.prices[1]).toBe(110);
  });
  it("fails explicitly when no independent coverage exists", () => {
    const dataset = fixture().dataset;
    delete dataset.intrabars;
    expect(() => prepareMagnifier(dataset, true)).toThrow("no lower-timeframe");
    expect(prepareMagnifier(dataset, false).paths.size).toBe(0);
    dataset.intrabars = { timeframe: "1m", bars: [bar(1)] };
    expect(() => prepareMagnifier(dataset, true)).toThrow("No chart candles");
  });
  it("refuses duplicate, malformed and non-divisible lower histories", () => {
    const dataset = fixture().dataset;
    dataset.intrabars!.bars[1] = bar(0);
    expect(() => prepareMagnifier(dataset, true)).toThrow("ordered, unique");
    dataset.intrabars!.bars = [bar(0, 100, 90)];
    expect(() => prepareMagnifier(dataset, true)).toThrow("valid OHLCV");
    expect(() => magnifierInterval(dataset, "3m")).toThrow("divide");
  });
  it("chooses compatible finer resolutions for each provider", () => {
    const dataset = fixture().dataset;
    dataset.market.timeframe = "15m";
    expect(magnifierInterval(dataset)).toBe("1m");
    dataset.market.timeframe = "1h";
    expect(magnifierInterval(dataset)).toBe("10m");
    dataset.market.timeframe = "1m";
    expect(magnifierInterval(dataset)).toBe("10s");
    dataset.market.provider = "hyperliquid";
    expect(() => magnifierInterval(dataset)).toThrow("No finer");
    dataset.market.timeframe = "1D";
    expect(magnifierInterval(dataset)).toBe("1h");
  });
  it("loads only the frozen window on the same source and propagates cancellation", async () => {
    const request = fixture(), signal = new AbortController().signal;
    const loader = vi.fn(async () => ({ ...request.dataset, market: { ...request.dataset.market, timeframe: "1m" }, bars: request.dataset.intrabars!.bars }));
    const result = await loadMagnifierDataset(request.dataset, request.document.settings, signal, undefined, loader);
    expect(result.intrabars!.bars).toHaveLength(12);
    expect(loader.mock.calls).toHaveLength(1);
    const args = (loader.mock.calls as unknown[][])[0];
    expect(args[0]).toBe("BTCUSDT");
    expect(args[2]).toMatchObject({ source: "exchange", useBarMagnifier: false, from: "2026-01-01T00:00:00", to: "2026-01-01T00:12:00" });
    const controller = new AbortController(); controller.abort();
    await expect(loadMagnifierDataset(request.dataset, request.document.settings, controller.signal, undefined, loader)).rejects.toThrow();
  });
  it("rejects simulation substitution and invalid saved properties", async () => {
    const request = fixture(); request.dataset.source = "simulation";
    await expect(loadMagnifierDataset(request.dataset, request.document.settings, new AbortController().signal)).rejects.toThrow("independently recorded");
    expect(() => validateStrategySettings({ ...request.document.settings, intrabarInterval: "100T" })).toThrow("valid time interval");
  });
  it("pages backwards without overlaps or future candles and stops on unavailable history", async () => {
    const request = fixture(), signal = new AbortController().signal;
    const children = request.dataset.intrabars!.bars;
    const loader = vi.fn()
      .mockResolvedValueOnce({ ...request.dataset, market: { ...request.dataset.market, timeframe: "1m" }, bars: [...children.slice(4), bar(12, 500)] })
      .mockResolvedValueOnce({ ...request.dataset, market: { ...request.dataset.market, timeframe: "1m" }, bars: children.slice(0, 5) });
    const result = await loadMagnifierDataset(request.dataset, request.document.settings, signal, undefined, loader);
    expect(result.intrabars!.bars).toEqual(children);
    expect(loader.mock.calls[1][2].to).toBe("2026-01-01T00:04:00");
    const missing = vi.fn().mockRejectedValue(new Error("The selected window contains fewer than two completed candles."));
    const unavailable = await loadMagnifierDataset(request.dataset, request.document.settings, signal, undefined, missing);
    expect(unavailable.intrabars!.bars).toEqual([]);
    const failed = vi.fn().mockRejectedValue(new Error("HTTP 503"));
    await expect(loadMagnifierDataset(request.dataset, request.document.settings, signal, undefined, failed)).rejects.toThrow("503");
  });
  it("rejects excessive lower history and a mismatched configured resolution", async () => {
    const request = fixture();
    request.document.settings.intrabarInterval = "30s";
    await expect(executeStrategy(request)).rejects.toThrow("configured magnifier interval");
    request.dataset.intrabars!.bars = Array(200_001).fill(bar(0));
    expect(() => prepareMagnifier(request.dataset, true)).toThrow("200,000");
  });
  it.each(["binance", "hyperliquid"] as const)("reuses frozen %s rules without refetching the market registry", async provider => {
    const request = fixture();
    const market = { ...request.dataset.market, symbol: provider === "binance" ? "BTCUSDT" : "HL:BTC", provider, currency: provider === "binance" ? "USDT" : "USDC" };
    const rows = Array.from({ length: 100 }, (_, i) => bar(i));
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("exchangeInfo") || url.includes("kind=assets")) throw new Error("Registry must stay frozen");
      return { ok: true, json: async () => provider === "binance" ? rows.map(b => [b.time, b.open, b.high, b.low, b.close, b.volume]) :
        { candles: rows.map(b => ({ t: b.time, o: String(b.open), h: String(b.high), l: String(b.low), c: String(b.close), v: String(b.volume) })) } };
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await loadStrategyDataset(market.symbol, "1m", { ...request.document.settings, bars: 100, to: "2026-01-01T01:40:00" }, new AbortController().signal, undefined, market);
    expect(result.bars).toHaveLength(100);
    expect(result.market).toEqual({ ...market, timeframe: "1m" });
    expect(fetcher).toHaveBeenCalled();
    await expect(loadStrategyDataset("ETHUSDT", "1m", request.document.settings, new AbortController().signal, undefined, market)).rejects.toThrow("Frozen trading rules");
  });
});
