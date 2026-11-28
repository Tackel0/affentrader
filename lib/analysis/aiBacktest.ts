import { analyzeChart, type AiChartAnalysisReport, type SetupQuality } from "./aiChartAnalysis";
import type { OHLCV } from "@/types/trading";

export interface AiBacktestTrade {
  entryBarIndex: number;
  exitBarIndex: number;
  entryTime: number;
  exitTime: number;
  direction: "long" | "short";
  setupQuality: SetupQuality;
  confidence: number;
  bias: AiChartAnalysisReport["bias"];
  volatilityRegime: AiChartAnalysisReport["volatilityRegime"];
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  exitPrice: number;
  outcome: "tp2" | "tp1_trail" | "sl" | "timeout";
  rMultiple: number;
  netReturnPct: number;
}

export interface AiBacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRatePct: number;
  profitFactor: number;
  expectancyR: number;
  totalR: number;
  maxDrawdownR: number;
  avgNetReturnPct: number;
  longTrades: number;
  longExpectancyR: number;
  shortTrades: number;
  shortExpectancyR: number;
  byOutcome: Record<AiBacktestTrade["outcome"], number>;
  recentTrades: AiBacktestTrade[];
  allTrades: AiBacktestTrade[];
}

export interface AiBacktestOptions {
  symbol: string;
  timeframe: string;
  bars: readonly OHLCV[];
  /** Minimum bars before first signal (default 80). */
  warmupBars?: number;
  /** Step size between signal evaluations when flat (default 1 = every bar). */
  stepBars?: number;
  /** Minimum AI confidence required to enter (default 64). */
  minConfidence?: number;
  /** Only trade A+ breakout setups (default false -> trades A+ and B). */
  aPlusOnly?: boolean;
  /** Max bars to wait for pullback limit fill (default 4). */
  maxEntryWaitBars?: number;
  /** Max bars to hold an open trade before closing at market (default 48). */
  maxHoldBars?: number;
  /** Round-trip fee + slippage in basis points (default 10 bps = 0.10%). */
  roundTripCostBps?: number;
  /** Only evaluate signals starting at this index (for strict OOS split while preserving warmup history). */
  startIndex?: number;
  /** Stop evaluating new entries after this index (for strict IS split). */
  endIndex?: number;
}

function barAtrSeries(bars: readonly OHLCV[], period = 14): number[] {
  const out = new Array<number>(bars.length).fill(0);
  if (!bars.length) return out;
  const tr = bars.map((b, i) =>
    i === 0
      ? b.high - b.low
      : Math.max(
          b.high - b.low,
          Math.abs(b.high - bars[i - 1].close),
          Math.abs(b.low - bars[i - 1].close),
        ),
  );
  const initLen = Math.min(period, bars.length);
  let prev = tr.slice(0, initLen).reduce((a, b) => a + b, 0) / initLen;
  for (let i = 0; i < initLen; i++) out[i] = prev;
  for (let i = initLen; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Strict zero-look-ahead walk-forward backtester for `analyzeChart()` (v2).
 * - At bar `t`, `analyzeChart()` ONLY receives `bars.slice(max(0, t - 259), t + 1)`.
 * - Breakout setups enter on next bar open (`t + 1`); pullback setups fill via realistic limit touch.
 * - Conservative intra-bar tie-breaking: if both SL and TP are touched in the same candle, SL wins.
 * - 2-stage institutional exit: 50% partial at TP1 + Chandelier ATR trailing stop on the remaining 50% runner.
 */
export function backtestAiChartAnalysis(options: AiBacktestOptions): AiBacktestSummary {
  const {
    symbol,
    timeframe,
    bars,
    warmupBars = 80,
    stepBars = 1,
    minConfidence = 64,
    aPlusOnly = false,
    maxEntryWaitBars = 4,
    maxHoldBars = 48,
    roundTripCostBps = 10,
  } = options;

  const firstEval = Math.max(warmupBars, options.startIndex ?? warmupBars);
  const lastEval = Math.min(bars.length - 3, options.endIndex ?? bars.length - 3);
  const atrs = barAtrSeries(bars, 14);
  const trades: AiBacktestTrade[] = [];

  let t = firstEval;
  while (t <= lastEval) {
    const windowStart = Math.max(0, t - 259);
    const slice = bars.slice(windowStart, t + 1);
    const report = analyzeChart({ symbol, timeframe, bars: slice });
    const plan = report.tradePlan;

    if (
      !plan ||
      report.setupQuality === "WAIT" ||
      (aPlusOnly && report.setupQuality !== "A+") ||
      report.confidence < minConfidence
    ) {
      t += stepBars;
      continue;
    }

    let fillIdx = -1;
    let fillPrice = 0;

    if (plan.entryMode === "breakout") {
      // Zero-look-ahead entry at next candle open
      fillIdx = t + 1;
      fillPrice = bars[fillIdx].open;
    } else {
      const waitEnd = Math.min(bars.length - 2, t + maxEntryWaitBars);
      for (let w = t + 1; w <= waitEnd; w++) {
        const b = bars[w];
        if (plan.direction === "long") {
          if (b.low <= plan.stopLoss) break;
          if (b.low <= plan.entryHigh && b.high >= plan.entryLow) {
            fillIdx = w;
            fillPrice = Math.max(plan.entryLow, Math.min(b.open, plan.entryHigh));
            break;
          }
        } else {
          if (b.high >= plan.stopLoss) break;
          if (b.high >= plan.entryLow && b.low <= plan.entryHigh) {
            fillIdx = w;
            fillPrice = Math.min(plan.entryHigh, Math.max(b.open, plan.entryLow));
            break;
          }
        }
      }
    }

    if (fillIdx < 0 || !(fillPrice > 0)) {
      t += stepBars;
      continue;
    }

    // Re-anchor risk cleanly relative to actual fill price for breakout open fills
    const plannedRisk = Math.abs(plan.entryMid - plan.stopLoss);
    const stopLoss =
      plan.entryMode === "breakout"
        ? plan.direction === "long"
          ? Math.max(0.0001, fillPrice - plannedRisk)
          : fillPrice + plannedRisk
        : plan.stopLoss;
    const risk =
      plan.direction === "long" ? fillPrice - stopLoss : stopLoss - fillPrice;
    if (!(risk > 0)) {
      t += stepBars;
      continue;
    }
    const target1 =
      plan.entryMode === "breakout"
        ? plan.direction === "long"
          ? fillPrice + risk * plan.riskReward1
          : Math.max(0.0001, fillPrice - risk * plan.riskReward1)
        : plan.target1;
    const target2 =
      plan.entryMode === "breakout"
        ? plan.direction === "long"
          ? fillPrice + risk * plan.riskReward2
          : Math.max(0.0001, fillPrice - risk * plan.riskReward2)
        : plan.target2;

    const costFrac = roundTripCostBps / 10_000;
    const costR = (fillPrice * costFrac) / risk;

    let activeSl = stopLoss;
    let tp1Hit = false;
    let realizedR = 0;
    let bestPrice = fillPrice;
    let exitIdx = Math.min(bars.length - 1, fillIdx + maxHoldBars);
    let exitPrice = bars[exitIdx].close;
    let outcome: AiBacktestTrade["outcome"] = "timeout";

    const holdEnd = Math.min(bars.length - 1, fillIdx + maxHoldBars);
    const startBar = plan.entryMode === "breakout" ? fillIdx : fillIdx + 1;
    for (let k = startBar; k <= holdEnd; k++) {
      const b = bars[k];
      const barAtr = Math.max(atrs[k], fillPrice * 0.001);
      if (plan.direction === "long") {
        if (b.low <= activeSl) {
          exitIdx = k;
          exitPrice = Math.min(b.open, activeSl);
          const r = (exitPrice - fillPrice) / risk;
          realizedR = tp1Hit ? realizedR + 0.5 * r : r;
          outcome = tp1Hit ? "tp1_trail" : "sl";
          break;
        }
        if (b.high > bestPrice) bestPrice = b.high;
        if (!tp1Hit && b.high >= target1) {
          tp1Hit = true;
          realizedR = 0.5 * ((target1 - fillPrice) / risk);
        }
        if (tp1Hit) {
          if (plan.trailAtrMultiple > 0) {
            activeSl = Math.max(activeSl, bestPrice - plan.trailAtrMultiple * barAtr);
          } else if (b.high >= target2) {
            exitIdx = k;
            exitPrice = target2;
            realizedR += 0.5 * ((target2 - fillPrice) / risk);
            outcome = "tp2";
            break;
          }
        }
      } else {
        if (b.high >= activeSl) {
          exitIdx = k;
          exitPrice = Math.max(b.open, activeSl);
          const r = (fillPrice - exitPrice) / risk;
          realizedR = tp1Hit ? realizedR + 0.5 * r : r;
          outcome = tp1Hit ? "tp1_trail" : "sl";
          break;
        }
        if (b.low < bestPrice) bestPrice = b.low;
        if (!tp1Hit && b.low <= target1) {
          tp1Hit = true;
          realizedR = 0.5 * ((fillPrice - target1) / risk);
        }
        if (tp1Hit) {
          if (plan.trailAtrMultiple > 0) {
            activeSl = Math.min(activeSl, bestPrice + plan.trailAtrMultiple * barAtr);
          } else if (b.low <= target2) {
            exitIdx = k;
            exitPrice = target2;
            realizedR += 0.5 * ((fillPrice - target2) / risk);
            outcome = "tp2";
            break;
          }
        }
      }

      if (k === holdEnd) {
        exitIdx = k;
        exitPrice = b.close;
        const closeR =
          plan.direction === "long"
            ? (exitPrice - fillPrice) / risk
            : (fillPrice - exitPrice) / risk;
        realizedR = tp1Hit ? realizedR + 0.5 * closeR : closeR;
        outcome = "timeout";
      }
    }

    const netR = realizedR - costR;
    const netReturnPct = ((netR * risk) / fillPrice) * 100;

    trades.push({
      entryBarIndex: fillIdx,
      exitBarIndex: exitIdx,
      entryTime: bars[fillIdx].time,
      exitTime: bars[exitIdx].time,
      direction: plan.direction,
      setupQuality: report.setupQuality,
      confidence: report.confidence,
      bias: report.bias,
      volatilityRegime: report.volatilityRegime,
      entryPrice: fillPrice,
      stopLoss,
      target1,
      target2,
      exitPrice,
      outcome,
      rMultiple: netR,
      netReturnPct,
    });

    t = exitIdx + 1;
  }

  return summarizeAiBacktest(trades);
}

export function summarizeAiBacktest(trades: readonly AiBacktestTrade[]): AiBacktestSummary {
  const byOutcome: Record<AiBacktestTrade["outcome"], number> = {
    tp2: 0,
    tp1_trail: 0,
    sl: 0,
    timeout: 0,
  };
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let totalR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  let sumRetPct = 0;

  let longTrades = 0;
  let longR = 0;
  let shortTrades = 0;
  let shortR = 0;

  for (const tr of trades) {
    byOutcome[tr.outcome]++;
    totalR += tr.rMultiple;
    sumRetPct += tr.netReturnPct;
    if (tr.rMultiple > 0.05) {
      wins++;
      grossWinR += tr.rMultiple;
    } else if (tr.rMultiple < -0.05) {
      losses++;
      grossLossR += Math.abs(tr.rMultiple);
    } else {
      breakevens++;
    }
    if (totalR > peakR) peakR = totalR;
    const dd = peakR - totalR;
    if (dd > maxDrawdownR) maxDrawdownR = dd;

    if (tr.direction === "long") {
      longTrades++;
      longR += tr.rMultiple;
    } else {
      shortTrades++;
      shortR += tr.rMultiple;
    }
  }

  const n = trades.length;
  return {
    trades: n,
    wins,
    losses,
    breakevens,
    winRatePct: n > 0 ? (wins / n) * 100 : 0,
    profitFactor: grossLossR > 0 ? grossWinR / grossLossR : grossWinR > 0 ? 99 : 0,
    expectancyR: n > 0 ? totalR / n : 0,
    totalR,
    maxDrawdownR,
    avgNetReturnPct: n > 0 ? sumRetPct / n : 0,
    longTrades,
    longExpectancyR: longTrades > 0 ? longR / longTrades : 0,
    shortTrades,
    shortExpectancyR: shortTrades > 0 ? shortR / shortTrades : 0,
    byOutcome,
    recentTrades: trades.slice(-8),
    allTrades: [...trades],
  };
}
