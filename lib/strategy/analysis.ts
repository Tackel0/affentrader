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

export interface SampleSegmentMetrics {
  fromTime: number;
  toTime: number;
  bars: number;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  netProfit: number;
  returnPercent: number;
  maxDrawdownPercent: number;
  sharpe: number | null;
  expectancy: number | null;
}

export type WalkForwardStatus =
  | "insufficient"
  | "robust"
  | "degraded"
  | "overfit_risk"
  | "unprofitable";

export interface InOutOfSampleResult {
  splitRatio: number;
  splitTime: number;
  inSample: SampleSegmentMetrics;
  outOfSample: SampleSegmentMetrics;
  /** Out-of-sample Sharpe divided by In-sample Sharpe (or per-bar return ratio fallback), when IS is positive. */
  oosRetentionRatio: number | null;
  status: WalkForwardStatus;
}

function segmentPerYear(report: StrategyReport): number {
  const curve = report.equityCurve;
  return (report.market.provider === "yahoo" || report.market.provider === "alpaca") &&
    curve.length > 1 &&
    curve.at(-1)!.time > curve[0].time
    ? ((curve.length - 1) * YEAR_MS) / (curve.at(-1)!.time - curve[0].time)
    : barsPerYear(report.market.timeframe);
}

function computeSegment(
  points: StrategyReport["equityCurve"],
  trades: StrategyTrade[],
  startEquity: number,
  perYear: number,
): SampleSegmentMetrics {
  const returns: number[] = [];
  let peak = Math.max(startEquity, points[0]?.equity ?? startEquity);
  let maxDdPct = 0;
  for (let i = 0; i < points.length; i++) {
    const eq = points[i].equity;
    if (eq > peak) peak = eq;
    if (peak > 0) {
      const ddPct = ((peak - eq) / peak) * 100;
      if (ddPct > maxDdPct) maxDdPct = ddPct;
    }
    const prevEq = i === 0 ? startEquity : points[i - 1].equity;
    if (prevEq > 0) returns.push(eq / prevEq - 1);
  }
  const average = mean(returns);
  const deviation =
    returns.length > 1 && average !== null
      ? Math.sqrt(
          returns.reduce((s, r) => s + (r - average) ** 2, 0) /
            (returns.length - 1),
        )
      : null;
  const wins = trades.filter((t) => t.netProfit > 0);
  const losses = trades.filter((t) => t.netProfit < 0);
  const grossWin = wins.reduce((s, t) => s + t.netProfit, 0);
  const grossLoss = losses.reduce((s, t) => s - t.netProfit, 0);
  const endEquity = points.at(-1)?.equity ?? startEquity;
  const netProfit = trades.reduce((s, t) => s + t.netProfit, 0);
  const returnPercent =
    startEquity > 0 ? ((endEquity - startEquity) / startEquity) * 100 : 0;
  return {
    fromTime: points[0].time,
    toTime: points.at(-1)!.time,
    bars: points.length,
    trades: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    profitFactor:
      grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : null,
    netProfit,
    returnPercent,
    maxDrawdownPercent: maxDdPct,
    sharpe: finite(
      deviation && average !== null
        ? (average / deviation) * Math.sqrt(perYear)
        : null,
    ),
    expectancy: trades.length ? netProfit / trades.length : null,
  };
}

/**
 * Chronological In-Sample / Out-of-Sample split of a backtest run to detect
 * performance degradation or curve-fitting outside the training window.
 */
export function inOutOfSampleSplit(
  report: StrategyReport,
  splitRatio = 0.7,
): InOutOfSampleResult | null {
  const curve = report.equityCurve;
  if (curve.length < 4) return null;
  const ratio = Math.min(0.9, Math.max(0.3, splitRatio));
  const splitIdx = Math.min(
    curve.length - 2,
    Math.max(2, Math.floor(curve.length * ratio)),
  );
  const splitTime = curve[splitIdx].time;
  const perYear = segmentPerYear(report);
  const closed = report.trades.filter((t) => !t.open);
  const isTrades = closed.filter((t) => t.entryTime < splitTime);
  const oosTrades = closed.filter((t) => t.entryTime >= splitTime);
  const isCurve = curve.slice(0, splitIdx);
  const oosCurve = curve.slice(splitIdx);
  const isStartEquity = report.initialCapital;
  const oosStartEquity = isCurve.at(-1)?.equity ?? report.initialCapital;
  const inSample = computeSegment(isCurve, isTrades, isStartEquity, perYear);
  const outOfSample = computeSegment(
    oosCurve,
    oosTrades,
    oosStartEquity,
    perYear,
  );

  let oosRetentionRatio: number | null = null;
  if (
    inSample.sharpe !== null &&
    inSample.sharpe > 0 &&
    outOfSample.sharpe !== null
  ) {
    oosRetentionRatio = finite(outOfSample.sharpe / inSample.sharpe);
  } else if (inSample.returnPercent > 0 && inSample.bars > 0 && outOfSample.bars > 0) {
    const isPerBar = inSample.returnPercent / inSample.bars;
    const oosPerBar = outOfSample.returnPercent / outOfSample.bars;
    oosRetentionRatio = finite(oosPerBar / isPerBar);
  }

  let status: WalkForwardStatus;
  if (inSample.trades < 5 || outOfSample.trades < 5) {
    status = "insufficient";
  } else if (inSample.netProfit <= 0 && outOfSample.netProfit <= 0) {
    status = "unprofitable";
  } else if (inSample.netProfit > 0 && outOfSample.netProfit <= 0) {
    status = "overfit_risk";
  } else if (
    outOfSample.netProfit > 0 &&
    (outOfSample.profitFactor === null || outOfSample.profitFactor >= 1.1) &&
    (oosRetentionRatio === null || oosRetentionRatio >= 0.5)
  ) {
    status = "robust";
  } else {
    status = "degraded";
  }

  return {
    splitRatio: ratio,
    splitTime,
    inSample,
    outOfSample,
    oosRetentionRatio,
    status,
  };
}

export interface MonteCarloBandPoint {
  tradeIndex: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  actual: number;
}

export interface MonteCarloResult {
  iterations: number;
  tradeCount: number;
  seed: number;
  actualDrawdownPercent: number;
  /** Percentage of simulated paths whose max drawdown was <= actual trade-sequence drawdown. */
  actualDrawdownPercentile: number;
  medianDrawdownPercent: number;
  p90DrawdownPercent: number;
  p95DrawdownPercent: number;
  p99DrawdownPercent: number;
  p5ReturnPercent: number;
  p50ReturnPercent: number;
  p95ReturnPercent: number;
  /** Share of bootstrap paths finishing above initial capital, in percent. */
  probabilityOfProfit: number;
  /** Share of bootstrap paths experiencing >= 50% peak-to-trough drawdown or capital depletion, in percent. */
  probabilityOfRuin: number;
  p95ConsecutiveLosses: number;
  /** Equity percentile fan bands (as % return from initial capital) sampled along trade index 0..N. */
  bands: MonteCarloBandPoint[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, q * (sorted.length - 1)),
  );
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Bootstrap Monte-Carlo simulation resampling realized closed-trade PnLs with
 * replacement to estimate drawdown tail risk and equity confidence bands.
 */
export function monteCarloDrawdown(
  report: StrategyReport,
  options: { iterations?: number; seed?: number; maxPoints?: number } = {},
): MonteCarloResult | null {
  const closed = report.trades.filter((t) => !t.open);
  const n = closed.length;
  const initial = report.initialCapital;
  if (n < 3 || !Number.isFinite(initial) || initial <= 0) return null;

  const iterations = Math.min(
    2000,
    Math.max(50, Math.round(options.iterations ?? 500)),
  );
  const seed = (options.seed ?? 0x51a7e123) >>> 0;
  const maxPoints = Math.max(8, Math.min(80, Math.round(options.maxPoints ?? 48)));
  const pnls = closed.map((t) => t.netProfit);

  // Build evenly spaced sample indices in [0..n] including both endpoints.
  const stepSet = new Set<number>([0, n]);
  if (n <= maxPoints) {
    for (let i = 1; i < n; i++) stepSet.add(i);
  } else {
    for (let k = 1; k < maxPoints; k++) {
      stepSet.add(Math.round((k * n) / maxPoints));
    }
  }
  const sampleSteps = [...stepSet].sort((a, b) => a - b);
  const stepToCol = new Map<number, number>();
  sampleSteps.forEach((step, col) => stepToCol.set(step, col));

  // Realized trade-by-trade path (for apples-to-apples comparison on the same axis).
  const actualByCol = new Float64Array(sampleSteps.length);
  actualByCol[0] = 0;
  let actualEq = initial;
  let actualPeak = initial;
  let actualMaxDd = 0;
  for (let i = 0; i < n; i++) {
    actualEq = Math.max(0, actualEq + pnls[i]);
    if (actualEq > actualPeak) actualPeak = actualEq;
    if (actualPeak > 0) {
      const dd = ((actualPeak - actualEq) / actualPeak) * 100;
      if (dd > actualMaxDd) actualMaxDd = dd;
    }
    const col = stepToCol.get(i + 1);
    if (col !== undefined) {
      actualByCol[col] = ((actualEq - initial) / initial) * 100;
    }
  }

  const rand = mulberry32(seed);
  const maxDrawdowns = new Float64Array(iterations);
  const finalReturns = new Float64Array(iterations);
  const lossStreaks = new Int32Array(iterations);
  const colBuffers = sampleSteps.map(() => new Float64Array(iterations));
  let profitableRuns = 0;
  let ruinRuns = 0;
  let ddAtOrBelowActual = 0;

  for (let iter = 0; iter < iterations; iter++) {
    let eq = initial;
    let peak = initial;
    let maxDd = 0;
    let curLoss = 0;
    let maxLoss = 0;
    colBuffers[0][iter] = 0;
    for (let i = 0; i < n; i++) {
      const pnl = pnls[Math.floor(rand() * n)];
      eq = Math.max(0, eq + pnl);
      if (pnl < 0) {
        curLoss++;
        if (curLoss > maxLoss) maxLoss = curLoss;
      } else {
        curLoss = 0;
      }
      if (eq > peak) peak = eq;
      if (peak > 0) {
        const dd = ((peak - eq) / peak) * 100;
        if (dd > maxDd) maxDd = dd;
      }
      const col = stepToCol.get(i + 1);
      if (col !== undefined) {
        colBuffers[col][iter] = ((eq - initial) / initial) * 100;
      }
    }
    maxDrawdowns[iter] = maxDd;
    finalReturns[iter] = ((eq - initial) / initial) * 100;
    lossStreaks[iter] = maxLoss;
    if (eq > initial) profitableRuns++;
    if (eq <= 0 || maxDd >= 50) ruinRuns++;
    if (maxDd <= actualMaxDd + 1e-9) ddAtOrBelowActual++;
  }

  const sortedDd = Array.from(maxDrawdowns).sort((a, b) => a - b);
  const sortedRet = Array.from(finalReturns).sort((a, b) => a - b);
  const sortedStreaks = Array.from(lossStreaks).sort((a, b) => a - b);

  const bands: MonteCarloBandPoint[] = sampleSteps.map((tradeIndex, col) => {
    const sorted = Array.from(colBuffers[col]).sort((a, b) => a - b);
    return {
      tradeIndex,
      p5: quantile(sorted, 0.05),
      p25: quantile(sorted, 0.25),
      p50: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75),
      p95: quantile(sorted, 0.95),
      actual: actualByCol[col],
    };
  });

  return {
    iterations,
    tradeCount: n,
    seed,
    actualDrawdownPercent: actualMaxDd,
    actualDrawdownPercentile: (ddAtOrBelowActual / iterations) * 100,
    medianDrawdownPercent: quantile(sortedDd, 0.5),
    p90DrawdownPercent: quantile(sortedDd, 0.9),
    p95DrawdownPercent: quantile(sortedDd, 0.95),
    p99DrawdownPercent: quantile(sortedDd, 0.99),
    p5ReturnPercent: quantile(sortedRet, 0.05),
    p50ReturnPercent: quantile(sortedRet, 0.5),
    p95ReturnPercent: quantile(sortedRet, 0.95),
    probabilityOfProfit: (profitableRuns / iterations) * 100,
    probabilityOfRuin: (ruinRuns / iterations) * 100,
    p95ConsecutiveLosses: Math.round(quantile(sortedStreaks, 0.95)),
    bands,
  };
}
