import { describe, expect, it } from "vitest";
import {
  bestIndex,
  extendedMetrics,
  histogram,
  inOutOfSampleSplit,
  monteCarloDrawdown,
  summarizeReport,
  tradePercent,
} from "@/lib/strategy/analysis";
import { auditTrades, lowerInterval } from "@/lib/strategy/audit";
import { strategyOverlays } from "@/lib/strategy/overlay";
import { tradeStatistics } from "@/lib/strategy/report";
import { DEFAULT_STRATEGY_SETTINGS } from "@/lib/strategy/settings";
import type { StrategyReport, StrategyTrade } from "@/types/strategy";
import type { OHLCV } from "@/types/trading";

const HOUR = 3_600_000;
const start = Date.UTC(2026, 0, 1);
const trade = (i: number, net: number, patch: Partial<StrategyTrade> = {}): StrategyTrade => ({
  id: `t${i}`,
  entryId: "L",
  exitId: "X",
  side: "long",
  quantity: 1,
  entryTime: start + (i * 10) * HOUR,
  exitTime: start + (i * 10 + 4) * HOUR,
  entryBar: i * 10,
  exitBar: i * 10 + 4,
  entryPrice: 100,
  exitPrice: 100 + net,
  netProfit: net,
  commission: 0,
  runup: Math.max(net, 0) + 1,
  drawdown: 2,
  open: false,
  ...patch,
});
function report(nets: number[], extra: Partial<StrategyReport> = {}): StrategyReport {
  const trades = nets.map((n, i) => trade(i, n));
  let equity = 10_000;
  const curve = Array.from({ length: 400 }, (_, i) => {
    const t = trades.find((x) => x.exitBar === i);
    if (t) equity += t.netProfit;
    return { time: start + i * HOUR, equity, netProfit: equity - 10_000, openProfit: 0, drawdown: 0, drawdownPercent: 0, buyHold: 10_000 };
  });
  const net = nets.reduce((a, b) => a + b, 0);
  return {
    id: "r",
    name: "Test",
    market: { symbol: "BTCUSDT", timeframe: "1h", tickSize: 0.01, quantityStep: 0.001, base: "BTC" },
    source: "exchange",
    document: { name: "Test", source: "", inputs: {}, settings: DEFAULT_STRATEGY_SETTINGS },
    startedAt: 0,
    completedAt: 0,
    firstTime: curve[0].time,
    lastTime: curve.at(-1)!.time,
    barCount: curve.length,
    initialCapital: 10_000,
    equity: 10_000 + net,
    netProfit: net,
    openProfit: 0,
    maxDrawdown: 400,
    maxDrawdownPercent: 4,
    maxRunup: 500,
    sharpe: null,
    sortino: null,
    buyHoldProfit: 500,
    trades,
    equityCurve: curve,
    all: tradeStatistics(trades),
    long: tradeStatistics(trades),
    short: tradeStatistics([]),
    warnings: [],
    ...extra,
  };
}

describe("extended metrics", () => {
  const r = report([100, -50, 200, -100, -100, 150]);
  const m = extendedMetrics(r);
  it("measures streaks, payoff, expectancy and Kelly", () => {
    expect(m.maxConsecutiveWins).toBe(1);
    expect(m.maxConsecutiveLosses).toBe(2);
    expect(m.expectancy).toBeCloseTo(200 / 6, 8);
    expect(m.payoffRatio).toBeCloseTo((450 / 3) / (250 / 3), 8);
    expect(m.kelly).toBeCloseTo((0.5 - 0.5 / m.payoffRatio!) * 100, 6);
    expect(m.recoveryFactor).toBeCloseTo(200 / 400, 8);
  });
  it("derives exposure, durations and alpha against buy and hold", () => {
    expect(m.exposure).toBeCloseTo(((5 * 6) / 400) * 100, 6);
    expect(m.averageTradeMs).toBe(4 * HOUR);
    expect(m.buyHoldPercent).toBeCloseTo(5, 8);
    expect(m.alphaPercent).toBeCloseTo(2 - 5, 8);
    expect(m.longestDrawdownBars).toBeGreaterThan(0);
  });
  it("annualizes ratios from bar returns and groups monthly results", () => {
    expect(m.sharpe).not.toBeNull();
    expect(m.volatility).toBeGreaterThan(0);
    expect(m.monthly[0].month).toBe("2026-01");
    expect(m.monthly.reduce((a, x) => a + x.pnl, 0)).toBeCloseTo(200, 6);
    expect(m.distribution.reduce((a, b) => a + b.count, 0)).toBe(6);
  });
  it("handles a report without trades", () => {
    const empty = extendedMetrics(report([]));
    expect(empty.expectancy).toBeNull();
    expect(empty.bestTradePercent).toBeNull();
    expect(empty.exposure).toBe(0);
    expect(histogram([])).toEqual([]);
    expect(histogram([3, 3])).toEqual([{ from: 3, to: 3, count: 2 }]);
    expect(tradePercent(trade(0, 5, { quantity: 0 }))).toBe(0);
  });
});

describe("saved reports", () => {
  it("summarizes with a bounded curve and ranks metrics", () => {
    const a = summarizeReport(report([100, 100]), "  A strategy  ");
    const b = summarizeReport(report([-50, 20]), "B");
    expect(a.name).toBe("A strategy");
    expect(a.curve.length).toBeLessThanOrEqual(301);
    expect(a.curve.at(-1)![0]).toBe(report([]).lastTime);
    expect(bestIndex([a, b], "netProfitPercent")).toBe(0);
    expect(bestIndex([a, { ...b, maxDrawdownPercent: 1 }], "maxDrawdownPercent")).toBe(1);
    expect(bestIndex([a, b], "trades")).toBe(-1);
    expect(bestIndex([{ ...a, sharpe: null }, { ...b, sharpe: null }], "sharpe")).toBe(-1);
  });
});

describe("chart markers", () => {
  it("draws entries, exits and colour-coded links, labelling only the focused trade", () => {
    const r = report([50, -20]);
    const all = strategyOverlays(r, null);
    expect(all.filter((p) => p.kind === "marker")).toHaveLength(4);
    expect(all.filter((p) => p.kind === "segment").map((p) => (p.kind === "segment" ? p.color : ""))).toEqual(["#089981", "#f23645"]);
    const focused = strategyOverlays(r, "t1");
    expect(focused.some((p) => p.kind === "segment" && p.label === "-20.00")).toBe(true);
    expect(strategyOverlays(report([1, 2, 3, 4]), null, 2).filter((p) => p.kind === "segment")).toHaveLength(2);
  });
});

describe("intrabar audit", () => {
  const lower = (rows: [number, number, number][]): OHLCV[] =>
    rows.map(([time, low, high]) => ({ time, open: low, high, low, close: high, volume: 1 }));
  it("picks a finer interval per bar size", () => {
    expect([lowerInterval("1D"), lowerInterval("4h"), lowerInterval("1h"), lowerInterval("15m"), lowerInterval("1m"), lowerInterval("1s")]).toEqual([
      "1h",
      "15m",
      "5m",
      "1m",
      "1s",
      null,
    ]);
  });
  it("verifies fills and measures the unrealized range between them", async () => {
    const r = report([20]);
    const t = r.trades[0];
    const minute = 60_000;
    const bars = lower([
      [t.entryTime + minute, 99, 101],
      [t.entryTime + 5 * minute, 95, 108],
      [t.exitTime! + 2 * minute, 118, 122],
    ]);
    const summary = await auditTrades(r, async () => bars);
    expect(summary.interval).toBe("5m");
    expect(summary.entriesVerified).toBe(1);
    expect(summary.exitsVerified).toBe(1);
    expect(summary.results[0].adverse).toBeCloseTo(100 - 95, 8);
    expect(summary.results[0].favorable).toBeGreaterThan(8);
  });
  it("flags fills that never traded in their bar", async () => {
    const r = report([20]);
    const summary = await auditTrades(r, async () => []);
    expect(summary.unverified).toEqual(["t0"]);
    await expect(auditTrades(report([1], { market: { ...report([]).market, timeframe: "1s" } }), async () => [])).rejects.toThrow(/finest/);
  });
});

describe("walk-forward in-sample / out-of-sample split", () => {
  it("classifies a consistent edge across IS and OOS as robust", () => {
    // 36 trades across 400 bars (bars 0..350), split 70/30 at bar 280 -> 28 IS, 8 OOS
    const nets = Array.from({ length: 36 }, (_, i) => (i % 3 === 0 ? -40 : 120));
    const res = inOutOfSampleSplit(report(nets), 0.7);
    expect(res).not.toBeNull();
    expect(res!.inSample.trades).toBe(28);
    expect(res!.outOfSample.trades).toBe(8);
    expect(res!.inSample.netProfit).toBeGreaterThan(0);
    expect(res!.outOfSample.netProfit).toBeGreaterThan(0);
    expect(res!.status).toBe("robust");
    expect(res!.oosRetentionRatio).not.toBeNull();
    expect(res!.oosRetentionRatio!).toBeGreaterThan(0.5);
  });

  it("flags positive IS followed by negative OOS as overfit_risk", () => {
    const nets = [
      ...Array.from({ length: 28 }, (_, i) => (i % 4 === 0 ? -30 : 150)),
      ...Array.from({ length: 8 }, () => -120),
    ];
    const res = inOutOfSampleSplit(report(nets), 0.7);
    expect(res).not.toBeNull();
    expect(res!.inSample.netProfit).toBeGreaterThan(0);
    expect(res!.outOfSample.netProfit).toBeLessThan(0);
    expect(res!.status).toBe("overfit_risk");
  });

  it("returns insufficient when either window has fewer than 5 trades, and null on tiny curves", () => {
    const small = inOutOfSampleSplit(report([100, -20, 80]), 0.7);
    expect(small?.status).toBe("insufficient");
    const tiny = report([]);
    expect(inOutOfSampleSplit({ ...tiny, equityCurve: tiny.equityCurve.slice(0, 3) })).toBeNull();
  });
});

describe("Monte-Carlo bootstrap drawdown confidence band", () => {
  it("produces deterministic monotonic drawdown & return quantiles and bounded bands", () => {
    const nets = [200, -150, 300, -100, 180, -220, 250, -80, 190, -140, 210, -90];
    const r = report(nets);
    const a = monteCarloDrawdown(r, { iterations: 400, seed: 42 });
    const b = monteCarloDrawdown(r, { iterations: 400, seed: 42 });
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
    expect(a!.medianDrawdownPercent).toBeLessThanOrEqual(a!.p90DrawdownPercent);
    expect(a!.p90DrawdownPercent).toBeLessThanOrEqual(a!.p95DrawdownPercent);
    expect(a!.p95DrawdownPercent).toBeLessThanOrEqual(a!.p99DrawdownPercent);
    expect(a!.p5ReturnPercent).toBeLessThanOrEqual(a!.p50ReturnPercent);
    expect(a!.p50ReturnPercent).toBeLessThanOrEqual(a!.p95ReturnPercent);
    expect(a!.probabilityOfProfit).toBeGreaterThan(50);
    expect(a!.probabilityOfRuin).toBeGreaterThanOrEqual(0);
    expect(a!.probabilityOfRuin).toBeLessThanOrEqual(100);
    expect(a!.bands[0]).toMatchObject({ tradeIndex: 0, p5: 0, p50: 0, p95: 0, actual: 0 });
    expect(a!.bands.at(-1)!.tradeIndex).toBe(nets.length);
    for (const pt of a!.bands) {
      expect(pt.p5).toBeLessThanOrEqual(pt.p25 + 1e-9);
      expect(pt.p25).toBeLessThanOrEqual(pt.p50 + 1e-9);
      expect(pt.p50).toBeLessThanOrEqual(pt.p75 + 1e-9);
      expect(pt.p75).toBeLessThanOrEqual(pt.p95 + 1e-9);
    }
  });

  it("returns null when fewer than 3 closed trades exist or initialCapital <= 0", () => {
    expect(monteCarloDrawdown(report([100, -50]))).toBeNull();
    expect(monteCarloDrawdown(report([100, 100, 100], { initialCapital: 0 }))).toBeNull();
  });
});
