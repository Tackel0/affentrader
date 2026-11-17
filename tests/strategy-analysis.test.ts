import { describe, expect, it } from "vitest";
import {
  bestIndex,
  extendedMetrics,
  histogram,
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
