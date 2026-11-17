import type { StrategyReport, StrategyTrade } from "@/types/strategy";
import { intervalMs } from "@/lib/market/intervals";

const YEAR_MS = 365.25 * 86_400_000;

export function barsPerYear(timeframe: string): number {
  return YEAR_MS / intervalMs(timeframe);
}

export interface MonthlyReturn {
  month: string;
  returnPercent: number;
  pnl: number;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface ExtendedMetrics {
  cagr: number | null;
  /** Annualized standard deviation of bar-to-bar equity returns, in percent. */
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  recoveryFactor: number | null;
  /** Average profit per closed trade. */
  expectancy: number | null;
  payoffRatio: number | null;
  /** Kelly fraction of equity to risk, in percent (can be negative). */
  kelly: number | null;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  /** Share of bars with a position open, in percent. */
  exposure: number;
  averageTradeMs: number | null;
  longestDrawdownBars: number;
  longestDrawdownMs: number;
  bestTradePercent: number | null;
  worstTradePercent: number | null;
  averageTradePercent: number | null;
  buyHoldPercent: number;
  /** Strategy return minus buy-and-hold return, in percentage points. */
  alphaPercent: number;
  monthly: MonthlyReturn[];
  distribution: HistogramBin[];
  averageRunup: number | null;
  averageDrawdown: number | null;
}

const mean = (values: number[]) =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
const finite = (v: number | null): number | null =>
  v !== null && Number.isFinite(v) ? v : null;

export function tradePercent(t: StrategyTrade): number {
  const base = t.quantity * t.entryPrice * (t.pointValue ?? 1);
  return base ? (t.netProfit / base) * 100 : 0;
}

function streaks(trades: StrategyTrade[]): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  let currentWins = 0;
  let currentLosses = 0;
  for (const t of trades) {
    if (t.netProfit > 0) {
      currentWins++;
      currentLosses = 0;
    } else if (t.netProfit < 0) {
      currentLosses++;
      currentWins = 0;
    } else {
      currentWins = 0;
      currentLosses = 0;
    }
    wins = Math.max(wins, currentWins);
    losses = Math.max(losses, currentLosses);
  }
  return { wins, losses };
}

export function histogram(values: number[], bins = 10): HistogramBin[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ from: min, to: max, count: values.length }];
  const width = (max - min) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of values)
    out[Math.min(bins - 1, Math.floor((v - min) / width))].count++;
  return out;
}

export function extendedMetrics(report: StrategyReport): ExtendedMetrics {
  const curve = report.equityCurve;
  const closed = report.trades.filter((t) => !t.open);
  const wins = closed.filter((t) => t.netProfit > 0);
  const losses = closed.filter((t) => t.netProfit < 0);
  const initial = report.initialCapital;
  const final = curve.at(-1)?.equity ?? initial;
  const durationMs = Math.max(1, report.lastTime - report.firstTime);
  const years = durationMs / YEAR_MS;
  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++)
    if (curve[i - 1].equity > 0)
      returns.push(curve[i].equity / curve[i - 1].equity - 1);
  const average = mean(returns);
  const deviation =
    returns.length > 1 && average !== null
      ? Math.sqrt(
          returns.reduce((s, r) => s + (r - average) ** 2, 0) /
            (returns.length - 1),
        )
      : null;
  const downside =
    returns.length > 1
      ? Math.sqrt(
          returns.reduce((s, r) => s + Math.min(0, r) ** 2, 0) / returns.length,
        )
      : null;
  const perYear =
    (report.market.provider === "yahoo" || report.market.provider === "alpaca") &&
    curve.length > 1 &&
    curve.at(-1)!.time > curve[0].time
      ? ((curve.length - 1) * YEAR_MS) / (curve.at(-1)!.time - curve[0].time)
      : barsPerYear(report.market.timeframe);
  const cagr =
    initial > 0 && final > 0 && years > 0
      ? (final / initial) ** (1 / years) - 1
      : null;
  const maxDrawdownPercent = report.maxDrawdownPercent;
  const avgWin = wins.length
    ? wins.reduce((s, t) => s + t.netProfit, 0) / wins.length
    : null;
  const avgLoss = losses.length
    ? losses.reduce((s, t) => s - t.netProfit, 0) / losses.length
    : null;
  const winRate = closed.length ? wins.length / closed.length : null;
  const payoff = avgWin !== null && avgLoss ? avgWin / avgLoss : null;
  const kelly =
    winRate !== null && payoff
      ? (winRate - (1 - winRate) / payoff) * 100
      : null;
  // Exposure: bars covered by at least one trade.
  const inMarket = new Set<number>();
  for (const t of report.trades) {
    const end = t.exitBar ?? curve.length - 1;
    for (
      let b = Math.max(0, t.entryBar);
      b <= Math.min(end, curve.length - 1);
      b++
    )
      inMarket.add(b);
  }
  let longestBars = 0;
  let longestMs = 0;
  let peak = -Infinity;
  let start = 0;
  curve.forEach((p, i) => {
    if (p.equity >= peak) {
      peak = p.equity;
      start = i;
    } else {
      longestBars = Math.max(longestBars, i - start);
      longestMs = Math.max(longestMs, p.time - curve[start].time);
    }
  });
  // Monthly returns from month-end equity.
  const months = new Map<string, { first: number; last: number }>();
  let previous = initial;
  for (const p of curve) {
    const key = new Date(p.time).toISOString().slice(0, 7);
    const entry = months.get(key);
    if (entry) entry.last = p.equity;
    else months.set(key, { first: previous, last: p.equity });
    previous = p.equity;
  }
  const monthly = [...months].map(([month, v]) => ({
    month,
    returnPercent: v.first ? ((v.last - v.first) / v.first) * 100 : 0,
    pnl: v.last - v.first,
  }));
  const percents = closed.map(tradePercent);
  const buyHoldPercent = initial ? (report.buyHoldProfit / initial) * 100 : 0;
  const returnPercent = initial ? ((final - initial) / initial) * 100 : 0;
  const s = streaks(closed);
  return {
    cagr: cagr === null ? null : cagr * 100,
    volatility:
      deviation === null ? null : deviation * Math.sqrt(perYear) * 100,
    sharpe: finite(
      deviation && average !== null
        ? (average / deviation) * Math.sqrt(perYear)
        : null,
    ),
    sortino: finite(
      downside && average !== null
        ? (average / downside) * Math.sqrt(perYear)
        : null,
    ),
    calmar: finite(
      cagr !== null && maxDrawdownPercent > 0
        ? (cagr * 100) / maxDrawdownPercent
        : null,
    ),
    recoveryFactor: finite(
      report.maxDrawdown > 0 ? report.netProfit / report.maxDrawdown : null,
    ),
    expectancy: closed.length
      ? closed.reduce((a, t) => a + t.netProfit, 0) / closed.length
      : null,
    payoffRatio: finite(payoff),
    kelly: finite(kelly),
    maxConsecutiveWins: s.wins,
    maxConsecutiveLosses: s.losses,
    exposure: curve.length ? (inMarket.size / curve.length) * 100 : 0,
    averageTradeMs: closed.length
      ? closed.reduce(
          (a, t) => a + ((t.exitTime ?? t.entryTime) - t.entryTime),
          0,
        ) / closed.length
      : null,
    longestDrawdownBars: longestBars,
    longestDrawdownMs: longestMs,
    bestTradePercent: percents.length ? Math.max(...percents) : null,
    worstTradePercent: percents.length ? Math.min(...percents) : null,
    averageTradePercent: mean(percents),
    buyHoldPercent,
    alphaPercent: returnPercent - buyHoldPercent,
    monthly,
    distribution: histogram(percents),
    averageRunup: mean(closed.map((t) => t.runup)),
    averageDrawdown: mean(closed.map((t) => t.drawdown)),
  };
}

export interface SavedReport {
  id: string;
  name: string;
  savedAt: number;
  symbol: string;
  timeframe: string;
  source: StrategyReport["source"];
  currency?: string;
  magnifier?: StrategyReport["magnifier"];
  firstTime: number;
  lastTime: number;
  initialCapital: number;
  netProfit: number;
  netProfitPercent: number;
  maxDrawdownPercent: number;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  buyHoldPercent: number;
  /** Equity curve downsampled for comparison charts. */
  curve: [number, number][];
}

export const MAX_SAVED_REPORTS = 12;

export function summarizeReport(
  report: StrategyReport,
  name = report.name,
): SavedReport {
  const m = extendedMetrics(report);
  const step = Math.max(1, Math.ceil(report.equityCurve.length / 300));
  const curve = report.equityCurve
    .filter((_, i) => i % step === 0 || i === report.equityCurve.length - 1)
    .map((p): [number, number] => [p.time, Math.round(p.equity * 100) / 100]);
  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 60) || report.name,
    savedAt: Date.now(),
    symbol: report.market.symbol,
    timeframe: report.market.timeframe,
    source: report.source,
    currency: report.market.currency ?? "USDT",
    magnifier: report.magnifier ? { ...report.magnifier } : undefined,
    firstTime: report.firstTime,
    lastTime: report.lastTime,
    initialCapital: report.initialCapital,
    netProfit: report.netProfit,
    netProfitPercent: report.initialCapital
      ? (report.netProfit / report.initialCapital) * 100
      : 0,
    maxDrawdownPercent: report.maxDrawdownPercent,
    trades: report.all.count,
    winRate: report.all.winRate,
    profitFactor:
      report.all.profitFactor === Infinity ? null : report.all.profitFactor,
    sharpe: report.sharpe ?? m.sharpe,
    sortino: report.sortino ?? m.sortino,
    calmar: m.calmar,
    buyHoldPercent: m.buyHoldPercent,
    curve,
  };
}

export type ComparisonKey =
  | "netProfitPercent"
  | "maxDrawdownPercent"
  | "trades"
  | "winRate"
  | "profitFactor"
  | "sharpe"
  | "sortino"
  | "calmar";

/** Index of the best report for a metric (lowest for drawdown), or -1. */
export function bestIndex(
  reports: readonly SavedReport[],
  key: ComparisonKey,
): number {
  let best = -1;
  reports.forEach((r, i) => {
    const v = r[key];
    if (v === null || !Number.isFinite(v)) return;
    const current = best < 0 ? null : (reports[best][key] as number);
    if (
      current === null ||
      (key === "maxDrawdownPercent" ? v < current : v > current)
    )
      best = i;
  });
  return key === "trades" ? -1 : best;
}
