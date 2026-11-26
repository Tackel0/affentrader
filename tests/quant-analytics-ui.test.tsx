// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnalyticsView } from "@/components/StrategyAnalytics";
import { tradeStatistics } from "@/lib/strategy/report";
import { DEFAULT_STRATEGY_SETTINGS } from "@/lib/strategy/settings";
import type { StrategyReport, StrategyTrade } from "@/types/strategy";

const HOUR = 3_600_000;
const START = Date.UTC(2026, 0, 1);

function buildReport(nets: number[]): StrategyReport {
  const trades: StrategyTrade[] = nets.map((net, i) => ({
    id: `t${i}`,
    entryId: "L",
    exitId: "X",
    side: "long",
    quantity: 1,
    entryTime: START + i * 10 * HOUR,
    exitTime: START + (i * 10 + 4) * HOUR,
    entryBar: i * 10,
    exitBar: i * 10 + 4,
    entryPrice: 100,
    exitPrice: 100 + net,
    netProfit: net,
    commission: 0,
    runup: Math.max(net, 0) + 5,
    drawdown: 10,
    open: false,
  }));
  let equity = 10_000;
  const curve = Array.from({ length: 400 }, (_, i) => {
    const t = trades.find((x) => x.exitBar === i);
    if (t) equity += t.netProfit;
    return {
      time: START + i * HOUR,
      equity,
      netProfit: equity - 10_000,
      openProfit: 0,
      drawdown: 0,
      drawdownPercent: 0,
      buyHold: 10_000,
    };
  });
  const net = nets.reduce((a, b) => a + b, 0);
  return {
    id: "quant-ui-report",
    name: "Quant UI Test",
    market: { symbol: "BTCUSDT", timeframe: "1h", tickSize: 0.01, quantityStep: 0.001, base: "BTC" },
    source: "exchange",
    document: { name: "Quant UI Test", source: "", inputs: {}, settings: DEFAULT_STRATEGY_SETTINGS },
    startedAt: 0,
    completedAt: 0,
    firstTime: curve[0].time,
    lastTime: curve.at(-1)!.time,
    barCount: curve.length,
    initialCapital: 10_000,
    equity: 10_000 + net,
    netProfit: net,
    openProfit: 0,
    maxDrawdown: 350,
    maxDrawdownPercent: 3.5,
    maxRunup: 900,
    sharpe: null,
    sortino: null,
    buyHoldProfit: 400,
    trades,
    equityCurve: curve,
    all: tradeStatistics(trades),
    long: tradeStatistics(trades),
    short: tradeStatistics([]),
    warnings: [],
  };
}

afterEach(() => {
  cleanup();
});

describe("StrategyAnalytics Walk-Forward & Monte-Carlo UI", () => {
  it("renders Walk-Forward IS/OOS split with interactive ratio presets and Monte-Carlo fan chart", () => {
    const nets = Array.from({ length: 36 }, (_, i) => (i % 3 === 0 ? -45 : 130));
    const { container } = render(<AnalyticsView report={buildReport(nets)} />);

    const wf = within(container).getByRole("region", { name: "In-Sample vs Out-of-Sample split" });
    expect(wf.textContent).toContain("Robust OOS");
    expect(wf.textContent).toContain("In-Sample (70%)");
    expect(wf.textContent).toContain("Out-of-Sample (30%)");

    fireEvent.click(within(wf).getByRole("button", { name: "60/40" }));
    expect(wf.textContent).toContain("In-Sample (60%)");
    expect(wf.textContent).toContain("Out-of-Sample (40%)");

    const mc = within(container).getByRole("region", { name: "Monte-Carlo drawdown confidence band" });
    expect(mc.textContent).toContain("Monte-Carlo Bootstrap (500 paths)");
    expect(within(mc).getByRole("img", { name: "Monte-Carlo equity confidence bands" })).toBeTruthy();

    fireEvent.click(within(mc).getByRole("button", { name: "1000×" }));
    expect(mc.textContent).toContain("Monte-Carlo Bootstrap (1000 paths)");

    fireEvent.click(within(mc).getByRole("button", { name: /Resample/i }));
    expect(mc.textContent).toContain("P(Profit)");
  });

  it("shows overfit risk badge when IS is profitable and OOS turns negative", () => {
    const nets = [
      ...Array.from({ length: 28 }, (_, i) => (i % 4 === 0 ? -25 : 160)),
      ...Array.from({ length: 8 }, () => -140),
    ];
    const { container } = render(<AnalyticsView report={buildReport(nets)} />);
    const wf = within(container).getByRole("region", { name: "In-Sample vs Out-of-Sample split" });
    expect(wf.textContent).toContain("Overfit risk");
  });
});
