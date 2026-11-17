import type { Context } from "pinets";
import type {
  EquityPoint,
  StrategyReport,
  StrategyRunRequest,
  StrategyTrade,
  TradeStatistics,
} from "@/types/strategy";

export const EQUITY_PLOT = "__AFFENTRADER_REPORT_EQUITY_7C19";
export const NET_PLOT = "__AFFENTRADER_REPORT_NET_7C19";
export const OPEN_PLOT = "__AFFENTRADER_REPORT_OPEN_7C19";
export function instrumentStrategy(source: string): string {
  return `${source}\nplot(strategy.equity, "${EQUITY_PLOT}")\nplot(strategy.netprofit, "${NET_PLOT}")\nplot(strategy.openprofit, "${OPEN_PLOT}")\n`;
}
export function tradeStatistics(trades: StrategyTrade[]): TradeStatistics {
  const closed = trades.filter((t) => !t.open),
    wins = closed.filter((t) => t.netProfit > 0),
    losses = closed.filter((t) => t.netProfit < 0);
  const sum = (items: StrategyTrade[], field: "netProfit" | "commission") =>
    items.reduce((s, t) => s + t[field], 0);
  const grossProfit = sum(wins, "netProfit"),
    grossLoss = -sum(losses, "netProfit");
  return {
    count: closed.length,
    wins: wins.length,
    losses: losses.length,
    even: closed.length - wins.length - losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    netProfit: sum(closed, "netProfit"),
    grossProfit,
    grossLoss,
    profitFactor:
      grossLoss > 0
        ? grossProfit / grossLoss
        : grossProfit > 0
          ? Infinity
          : null,
    averageTrade: closed.length
      ? sum(closed, "netProfit") / closed.length
      : null,
    averageWin: wins.length ? grossProfit / wins.length : null,
    averageLoss: losses.length ? -grossLoss / losses.length : null,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.netProfit)) : null,
    largestLoss: losses.length
      ? Math.min(...losses.map((t) => t.netProfit))
      : null,
    averageBars: closed.length
      ? closed.reduce((s, t) => s + (t.exitBar! - t.entryBar + 1), 0) /
        closed.length
      : null,
    commission: sum(closed, "commission"),
  };
}
export function buildStrategyReport(
  context: Context,
  request: StrategyRunRequest,
  startedAt: number,
): StrategyReport {
  const root = context.fullContext ?? context,
    state = root.strategy;
  if (!state)
    throw new Error(
      "This script did not produce strategy state. Use a Pine strategy() declaration.",
    );
  const bars = request.dataset.bars,
    initial = state.initial_capital;
  const trades: StrategyTrade[] = [
    ...state.closedtrades,
    ...state.opentrades,
  ].map((t, i) => ({
    id: `${t.id}-${i}`,
    entryId: t.entry_id,
    exitId: t.exit_id ?? "",
    side: t.size > 0 ? "long" : "short",
    quantity: Math.abs(t.size),
    entryTime: t.entry_time,
    exitTime: t.exit_time ?? null,
    entryBar: t.entry_bar_index,
    exitBar: t.exit_bar_index ?? null,
    entryPrice: t.entry_price,
    exitPrice: t.exit_price ?? null,
    netProfit:
      t.profit ??
      (bars.at(-1)!.close - t.entry_price) *
        t.size *
        (request.dataset.market.pointValue ?? 1) -
        (t.commission ?? 0),
    commission: t.commission ?? 0,
    runup: t.max_runup ?? 0,
    drawdown: t.max_drawdown ?? 0,
    open: t.status !== "closed",
    pointValue: request.dataset.market.pointValue ?? 1,
  }));
  type PlotPoint = { time: number; value: number };
  const points = (name: string) =>
    new Map<number, number>(
      ((root.plots[name]?.data as PlotPoint[]) ?? []).map((p) => [
        p.time,
        p.value,
      ]),
    );
  const equities = points(EQUITY_PLOT),
    nets = points(NET_PLOT),
    opens = points(OPEN_PLOT);
  let peak = initial;
  const equityCurve: EquityPoint[] = bars.map((b) => {
    const equity = equities.get(b.time);
    if (equity === undefined || !Number.isFinite(equity))
      throw new Error(
        `Runtime equity is unavailable at ${new Date(b.time).toISOString()}.`,
      );
    peak = Math.max(peak, equity);
    const drawdown = Math.max(0, peak - equity);
    return {
      time: b.time,
      equity,
      netProfit: nets.get(b.time) ?? 0,
      openProfit: opens.get(b.time) ?? 0,
      drawdown,
      drawdownPercent: peak > 0 ? (drawdown / peak) * 100 : 0,
      buyHold: (initial * b.close) / bars[0].open,
    };
  });
  const finiteRatio = (v: number) =>
    (state._monthly_equity?.length ?? 0) >= 2 && Number.isFinite(v) ? v : null;
  return {
    id: request.id,
    name: state.config.title || request.document.name,
    market: request.dataset.market,
    source: request.dataset.source,
    document: request.document,
    startedAt,
    completedAt: Date.now(),
    firstTime: bars[0].time,
    lastTime: bars.at(-1)!.time,
    barCount: bars.length,
    initialCapital: initial,
    equity: state.equity,
    netProfit: state.netprofit,
    openProfit: state.openprofit,
    maxDrawdown: state.max_drawdown,
    maxDrawdownPercent: state.max_drawdown_percent_value,
    maxRunup: state.max_runup,
    sharpe: finiteRatio(state.sharpe_ratio),
    sortino: finiteRatio(state.sortino_ratio),
    buyHoldProfit: equityCurve.at(-1)!.buyHold - initial,
    trades,
    equityCurve,
    all: tradeStatistics(trades),
    long: tradeStatistics(trades.filter((t) => t.side === "long")),
    short: tradeStatistics(trades.filter((t) => t.side === "short")),
    warnings: [
      ...request.dataset.warnings,
      ...new Set(root.warnings.map((w) => `${w.message} (bar ${w.bar})`)),
    ].slice(0, 100),
  };
}
const csvCell = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;
export function strategyTradesCSV(report: StrategyReport): string {
  return [
    [
      "trade",
      "side",
      "entry_id",
      "exit_id",
      "entry_time_utc",
      "exit_time_utc",
      "entry_price",
      "exit_price",
      "quantity",
      "net_pnl",
      "commission",
      "runup",
      "drawdown",
      "status",
      "symbol",
      "timeframe",
      "data_source",
      "account_currency",
      "contract_point_value",
      "bar_magnifier", "intrabar_interval", "magnified_chart_bars", "parent_ohlc_fallback_bars",
    ],
    ...report.trades.map((t, i) => [
      i + 1,
      t.side,
      t.entryId,
      t.exitId,
      new Date(t.entryTime).toISOString(),
      t.exitTime === null ? "" : new Date(t.exitTime).toISOString(),
      t.entryPrice,
      t.exitPrice,
      t.quantity,
      t.netProfit,
      t.commission,
      t.runup,
      t.drawdown,
      t.open ? "open" : "closed",
      report.market.symbol,
      report.market.timeframe,
      report.source,
      report.market.currency ?? "USDT",
      report.market.pointValue ?? 1,
      report.magnifier?.enabled ?? false, report.magnifier?.timeframe ?? "",
      report.magnifier?.coveredBars ?? 0, report.magnifier?.fallbackBars ?? 0,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
export function strategyEquityCSV(report: StrategyReport): string {
  return [
    [
      "time_utc",
      "equity",
      "realized_pnl",
      "open_pnl",
      "close_drawdown",
      "close_drawdown_percent",
      "buy_hold_equity",
      "symbol",
      "timeframe",
      "data_source",
      "account_currency",
      "bar_magnifier", "intrabar_interval", "magnified_chart_bars", "parent_ohlc_fallback_bars",
    ],
    ...report.equityCurve.map((p) => [
      new Date(p.time).toISOString(),
      p.equity,
      p.netProfit,
      p.openProfit,
      p.drawdown,
      p.drawdownPercent,
      p.buyHold,
      report.market.symbol,
      report.market.timeframe,
      report.source,
      report.market.currency ?? "USDT",
      report.magnifier?.enabled ?? false, report.magnifier?.timeframe ?? "",
      report.magnifier?.coveredBars ?? 0, report.magnifier?.fallbackBars ?? 0,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
