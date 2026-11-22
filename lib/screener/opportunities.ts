import { atr, bollinger, ema, rsi, sma } from "@/lib/ta";
import { csvEscape } from "@/lib/watchlist";
import type { DailyStockBar } from "./stockBase";

export type OpportunityCategory = "structural-bottom" | "value-garp" | "high-conviction";

export type OpportunitySubType =
  | "wyckoff-spring"
  | "bos-hl-reclaim"
  | "double-bottom"
  | "value-garp"
  | "vcp-squeeze"
  | "insider-cluster"
  | "earnings-drift";

export interface InsiderFilingSummary {
  date: string;
  transactionDate?: string;
  filedAt?: string;
  sourceUrl?: string;
  insider: string;
  role: string;
  shares: number;
  price: number;
  valueUsd: number;
  form: string;
}

export interface AnalystRatingAction {
  date: string;
  firm: string;
  toGrade: string;
  action: string;
}

export interface AnalystConsensus {
  strongBuy?: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell?: number;
  ratingLabel: string;
  analystCount: number;
  targetLow: number | null;
  targetMean: number | null;
  targetHigh: number | null;
  recentActions?: AnalystRatingAction[];
}

export interface FundamentalSnapshot {
  ticker: string;
  name: string;
  sector: string;
  currency: string;
  marketCapBn: number | null;
  forwardPe: number | null;
  sectorMedianPe: number | null;
  historicalMedianPe?: number | null;
  peVsHistoryPct?: number | null;
  evToEbitda: number | null;
  sectorMedianEvEbitda: number | null;
  historicalMedianEvEbitda?: number | null;
  priceToFcf: number | null;
  fcfYieldPct: number | null;
  pegRatio: number | null;
  netDebtToEbitda: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  roePct: number | null;
  epsRevisionPct: number | null;
  revenueGrowthPct: number | null;
  analystTarget: number | null;
  fairValue: number | null;
  analystConsensus?: AnalystConsensus | null;
  insiderBuys90d: number;
  insiderNetValueUsd: number;
  recentInsiderFilings: InsiderFilingSummary[];
  earningsSurprisePct: number | null;
  lastEarningsDate: string | null;
  verifiedEarningsSession?: string;
  valuationEvidence?: Pick<FundamentalSnapshot, "forwardPe" | "evToEbitda" | "pegRatio" | "fcfYieldPct" | "netDebtToEbitda" | "operatingMarginPct" | "analystTarget">;
  dataSources?: string[];
  source: "tradingview+sec+yahoo" | "yahoo+sec" | "curated-baseline";
}

export interface OpportunityKeyLevels {
  lastClose: number;
  entryZone: [number, number];
  invalidation: number;
  target1: number;
  target2: number;
  riskReward: number;
  entryTrigger?: number;
}

export function opportunityPlan(levels: OpportunityKeyLevels) {
  if (!Array.isArray(levels?.entryZone) || levels.entryZone.length !== 2) return null;
  const [low, high] = levels.entryZone;
  const { invalidation: stop, target1 } = levels;
  if (![low, high, stop, target1].every(value => Number.isFinite(value) && value > 0) ||
    !(stop < low && low <= high && high < target1)) return null;
  const target2 = Number.isFinite(levels.target2) && levels.target2 > target1 ? levels.target2 : target1;
  const midpoint = low + (high - low) / 2;
  const rounded = midpoint >= 1 ? Math.round(midpoint * 100) / 100 : Number(midpoint.toPrecision(6));
  const entry = Math.min(high, Math.max(low, rounded));
  const risk = entry - stop;
  const reward = (target1 - entry) / risk;
  return Number.isFinite(reward) && risk > 0 ? { entry, stop, target1, target2, risk, reward } : null;
}

export function opportunityEntryState(levels: OpportunityKeyLevels): "invalid" | "target" | "zone" | "below" | "above" {
  return entryState(levels, opportunityPlan(levels));
}

function entryState(levels: OpportunityKeyLevels, plan: ReturnType<typeof opportunityPlan>) {
  if (!plan || !Number.isFinite(levels.lastClose) || levels.lastClose <= plan.stop) return "invalid";
  if (levels.lastClose >= levels.target1) return "target";
  if (levels.lastClose < levels.entryZone[0]) return "below";
  return levels.lastClose > levels.entryZone[1] ? "above" : "zone";
}

export function opportunityEntryDistance(levels: OpportunityKeyLevels) {
  const { lastClose, entryZone: [low, high] } = levels;
  if (![lastClose, low, high].every(value => Number.isFinite(value) && value > 0) || low > high) return null;
  return Math.max(0, low - lastClose, lastClose - high) / lastClose * 100;
}

export const MIN_SETUP_REWARD = 1.5;
export const setupReadinessLabels = {
  ready: "In Einstiegszone", pullback: "Rücklauf abwarten", trigger: "Ausbruch abwarten",
  below: "Zone unterschritten", weak: "CRV zu gering", target: "Kurs am Ziel", invalid: "Invalidiert",
} as const;

export function opportunityReadiness(levels: OpportunityKeyLevels) {
  const plan = opportunityPlan(levels);
  const state = entryState(levels, plan);
  if (!plan || state === "invalid" || state === "target") return { status: state === "target" ? "target" as const : "invalid" as const, maxEntry: null, edgeReward: null, canPrepare: false };
  const [low, high] = levels.entryZone;
  const maxEntry = plan.stop + (plan.target1 - plan.stop) / (1 + MIN_SETUP_REWARD);
  const edgeReward = (plan.target1 - high) / (high - plan.stop);
  const canPrepare = plan.reward >= MIN_SETUP_REWARD && state !== "below";
  const status = plan.reward < MIN_SETUP_REWARD ? "weak" : state === "below"
    ? levels.entryTrigger === low ? "trigger" : "below"
    : state === "above" || levels.lastClose > maxEntry ? "pullback" : "ready";
  return { status, maxEntry, edgeReward, canPrepare } as const;
}

const opportunityPriority = { ready: 0, pullback: 1, trigger: 2, below: 3, weak: 4, target: 5, invalid: 6 } as const;
export function rankOpportunities(a: TradeOpportunity, b: TradeOpportunity) {
  const first = opportunityReadiness(a.levels), second = opportunityReadiness(b.levels);
  return opportunityPriority[first.status] - opportunityPriority[second.status] ||
    (opportunityEntryDistance(a.levels) ?? Infinity) - (opportunityEntryDistance(b.levels) ?? Infinity) ||
    b.score - a.score || (second.edgeReward ?? 0) - (first.edgeReward ?? 0) || a.ticker.localeCompare(b.ticker);
}

export function opportunityShareSize(plan: Pick<NonNullable<ReturnType<typeof opportunityPlan>>, "risk" | "entry">, budget: number) {
  if (!Number.isFinite(budget) || budget <= 0 || !(plan.risk > 0)) return null;
  let quantity = Math.floor(budget / plan.risk);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;
  if (quantity * plan.risk > budget) quantity--;
  const capital = quantity * plan.entry;
  return quantity >= 1 && Number.isFinite(capital) ? { quantity, capital, risk: quantity * plan.risk } : null;
}

export interface OpportunityTechnicals {
  rsi14: number;
  ema20: number;
  ema50: number;
  vwap20: number;
  ema20DistPct: number;
  ema50DistPct: number;
  vwap20DistPct: number;
  relativeStrengthPct: number;
  benchmarkReturnPct: number;
  rvol20: number;
  volumeDryUpRatio: number;
  upDownVolumeRatio: number;
  obvDivergence: boolean;
  adDivergence: boolean;
  bbBandwidthPct: number;
  bbSqueezePercentile: number;
  vcpContractions: number;
  priorDrawdownPct: number;
}

export interface TradeOpportunity {
  id: string;
  symbol: string;
  ticker: string;
  name: string;
  market: string;
  sector: string;
  currency: string;
  session: string;
  category: OpportunityCategory;
  subType: OpportunitySubType;
  setupLabel: string;
  score: number;
  scoreBreakdown: Record<string, number>;
  whySetup: string[];
  structure?: {
    firstLow: { session: string; price: number };
    retest: { session: string; price: number };
    neckline: number;
    localSwingHigh: number;
  };
  levels: OpportunityKeyLevels;
  technicals: OpportunityTechnicals;
  fundamentals: FundamentalSnapshot | null;
  chart: Pick<DailyStockBar, "session" | "open" | "high" | "low" | "close" | "volume">[];
}

export interface OpportunityScanResult {
  market: string;
  benchmark: string;
  benchmarkSession: string;
  benchmarkRevision?: string;
  generatedAt: number;
  evaluated: number;
  excluded?: number;
  universe: number;
  totalUniverse?: number;
  page?: number;
  pages?: number;
  dataSources: string[];
  opportunities: TradeOpportunity[];
  unavailable: { symbol: string; reason: string }[];
}

export function mergeOpportunityGroups(previous: OpportunityScanResult | null, next: OpportunityScanResult): OpportunityScanResult {
  if ((next.page ?? 0) !== (previous ? (previous.page ?? 0) + 1 : 0) || previous && (
    previous.market !== next.market || previous.benchmark !== next.benchmark ||
    previous.benchmarkSession !== next.benchmarkSession || previous.benchmarkRevision !== next.benchmarkRevision ||
    previous.pages !== next.pages || previous.totalUniverse !== next.totalUniverse
  )) throw new Error("Marktdaten oder Scan-Universum haben sich geändert. Starte einen neuen Scan.");
  if (!previous) return next;
  const opportunities = new Map(previous.opportunities.map(item => [item.id, item]));
  for (const item of next.opportunities) opportunities.set(item.id, item);
  return {
    ...next,
    generatedAt: Math.min(previous.generatedAt, next.generatedAt),
    evaluated: previous.evaluated + next.evaluated,
    excluded: (previous.excluded ?? 0) + (next.excluded ?? 0),
    universe: previous.universe + next.universe,
    dataSources: [...new Set([...previous.dataSources, ...next.dataSources])],
    opportunities: [...opportunities.values()],
    unavailable: [...previous.unavailable, ...next.unavailable],
  };
}

const CATEGORY_LABELS: Record<OpportunityCategory, string> = {
  "structural-bottom": "Kat. A · Bodenbildung & Struktur",
  "value-garp": "Kat. B · Value & GARP Qualität",
  "high-conviction": "Kat. C · VCP / Insider / Earnings",
};

export const SUBTYPE_LABELS: Record<OpportunitySubType, string> = {
  "wyckoff-spring": "Wyckoff Accumulation / Spring + Reclaim",
  "bos-hl-reclaim": "Higher Low + Break of Structure (BoS)",
  "double-bottom": "Bestätigter Doppelboden + EMA/VWAP-Reclaim",
  "value-garp": "Unterbewertete Qualitätsaktie (Value & GARP)",
  "vcp-squeeze": "VCP & Bollinger-Squeeze vor Widerstand",
  "insider-cluster": "Insider-Käufe & Technische Stabilisierung",
  "earnings-drift": "Earnings-Gap & Post-Earnings-Drift (PEAD)",
};

export function categoryLabel(category: OpportunityCategory): string {
  return CATEGORY_LABELS[category];
}

function mean(values: readonly number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Compute On-Balance Volume (OBV) series aligned to bars. */
export function computeObv(bars: readonly DailyStockBar[]): number[] {
  const out = new Array<number>(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const prev = out[i - 1];
    if (bars[i].close > bars[i - 1].close) out[i] = prev + bars[i].volume;
    else if (bars[i].close < bars[i - 1].close) out[i] = prev - bars[i].volume;
    else out[i] = prev;
  }
  return out;
}

/** Compute Accumulation/Distribution (A/D) cumulative series aligned to bars. */
export function computeAccumulationDistribution(bars: readonly DailyStockBar[]): number[] {
  const out = new Array<number>(bars.length).fill(0);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const span = b.high - b.low;
    const mfm = span > 0 ? ((b.close - b.low) - (b.high - b.close)) / span : 0;
    const mfv = mfm * (Number.isFinite(b.volume) ? b.volume : 0);
    out[i] = (i > 0 ? out[i - 1] : 0) + mfv;
  }
  return out;
}

/** Rolling volume-weighted average price (typical price * volume / volume). */
export function rollingVwap(bars: readonly DailyStockBar[], length = 20): number {
  const slice = bars.slice(-length);
  let pv = 0;
  let vol = 0;
  for (const b of slice) {
    const typical = (b.high + b.low + b.close) / 3;
    const v = Number.isFinite(b.volume) && b.volume > 0 ? b.volume : 0;
    pv += typical * v;
    vol += v;
  }
  return vol > 0 ? pv / vol : (bars.at(-1)?.close ?? 0);
}

/** Compute Risk:Reward ratio given entry midpoint, invalidation stop, and target1. */
function computeRiskReward(entryMid: number, invalidation: number, target1: number): number {
  const risk = entryMid - invalidation;
  const reward = target1 - entryMid;
  if (!(risk > 0) || !(reward > 0)) return 0;
  const ratio = reward / risk;
  return Number.isFinite(ratio) ? ratio : 0;
}

function isConfirmedPivotLow(bars: readonly DailyStockBar[], index: number): boolean {
  if (index < 2 || index >= bars.length - 2) return false;
  const low = bars[index].low;
  return (
    low < Math.min(bars[index - 1].low, bars[index - 2].low) &&
    low <= Math.min(bars[index + 1].low, bars[index + 2].low)
  );
}

function computeUpDownVolumeRatio(bars: readonly DailyStockBar[], startIndex: number): number {
  let upVol = 0, upCount = 0, downVol = 0, downCount = 0;
  for (let i = Math.max(1, startIndex); i < bars.length; i++) {
    if (bars[i].close > bars[i - 1].close) {
      upVol += bars[i].volume;
      upCount++;
    } else if (bars[i].close < bars[i - 1].close) {
      downVol += bars[i].volume;
      downCount++;
    }
  }
  if (upCount === 0) return 0.5;
  if (downCount === 0 || downVol === 0) return 2.2;
  return round2((upVol / upCount) / (downVol / downCount));
}

function computeVcpContractions(bars: readonly DailyStockBar[]): { contractions: number; latestRangePct: number } {
  if (bars.length < 45) return { contractions: 0, latestRangePct: 100 };
  const windows = [
    bars.slice(-45, -30),
    bars.slice(-30, -15),
    bars.slice(-15),
  ];
  const ranges = windows.map(w => {
    const hi = Math.max(...w.map(b => b.high));
    const lo = Math.min(...w.map(b => b.low));
    return lo > 0 ? ((hi - lo) / lo) * 100 : 100;
  });
  let contractions = 0;
  if (ranges[1] < ranges[0] * 0.88) contractions++;
  if (ranges[2] < ranges[1] * 0.88 && ranges[1] <= ranges[0] * 1.02) contractions++;
  if (ranges[2] < ranges[0] * 0.72 && ranges[1] < ranges[0] && contractions === 1) contractions++;
  return { contractions, latestRangePct: ranges[2] };
}

/**
 * Ensures the stock's latest completed session aligns with the benchmark, recent sessions have
 * positive finite volume (rejecting zero-volume holiday placeholder bars), and the lookback window
 * has no unadjusted split/reverse-split discontinuities (> +120% or < -55% single-bar jump).
 */
export function hasCleanRecentHistory(
  bars: readonly DailyStockBar[],
  benchmark: readonly DailyStockBar[],
): boolean {
  return opportunityHistoryIssue(bars, benchmark) === null;
}

export function opportunityHistoryIssue(bars: readonly DailyStockBar[], benchmark: readonly DailyStockBar[]): string | null {
  if (bars.length < 60 || benchmark.length < 20) return "Fewer than the required completed sessions.";
  if (bars.at(-1)?.session !== benchmark.at(-1)?.session) return "Latest completed session differs from benchmark.";
  const startSession = [bars.at(-60)!.session, benchmark.at(-60)?.session ?? benchmark[0].session].sort()[1];
  const stockDates = new Set(bars.filter(bar => bar.session >= startSession).map(bar => bar.session));
  const benchmarkDates = new Set(benchmark.filter(bar => bar.session >= startSession).map(bar => bar.session));
  for (const session of benchmarkDates) if (!stockDates.has(session)) return `Stock candle missing for benchmark session ${session}.`;
  for (const session of stockDates) if (!benchmarkDates.has(session)) return `Benchmark candle missing for stock session ${session}.`;
  if (!bars.slice(-22).every(b => Number.isFinite(b.volume) && b.volume > 0 && Number.isFinite(b.close) && b.close > 0)) {
    return "Recent prices or volume failed the scanner's data checks.";
  }
  const start = Math.max(1, bars.length - 60);
  for (let i = start; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    const curClose = bars[i].close;
    if (!(prevClose > 0) || !(curClose > 0)) return "Recent prices failed the scanner's data checks.";
    const ratio = curClose / prevClose;
    if (ratio > 2.2 || ratio < 0.45) return "Recent prices contain an abrupt discontinuity.";
  }
  return null;
}

export function buildOpportunityTechnicals(
  bars: readonly DailyStockBar[],
  benchmark: readonly DailyStockBar[],
  firstLowIdx?: number,
  secondLowIdx?: number,
): OpportunityTechnicals | null {
  if (!hasCleanRecentHistory(bars, benchmark)) return null;
  const closes = bars.map(b => b.close);
  const last = bars.at(-1)!;
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const bb = bollinger(closes, 20, 2);
  const obv = computeObv(bars);
  const ad = computeAccumulationDistribution(bars);

  const ema20Val = ema20Series.at(-1)!;
  const ema50Val = ema50Series.at(-1)!;
  const vwap20Val = rollingVwap(bars, 20);
  const rsi14Val = Number.isFinite(rsiSeries.at(-1)) ? rsiSeries.at(-1)! : 50;

  const avgVol20 = mean(bars.slice(-21, -1).map(b => b.volume));
  const rvol20 = avgVol20 > 0 ? last.volume / avgVol20 : 1;

  // Matched 15-session relative strength vs benchmark
  const benchMap = new Map(benchmark.map(b => [b.session, b.close]));
  const matched = bars.filter(b => benchMap.has(b.session)).slice(-16);
  let relativeStrengthPct = 0;
  let benchmarkReturnPct = 0;
  if (matched.length >= 6) {
    const startBar = matched[0];
    const endBar = matched.at(-1)!;
    const bStart = benchMap.get(startBar.session)!;
    const bEnd = benchMap.get(endBar.session)!;
    const stockRatio = endBar.close / startBar.close;
    const benchRatio = bEnd / bStart;
    benchmarkReturnPct = (benchRatio - 1) * 100;
    relativeStrengthPct = ((stockRatio / benchRatio) - 1) * 100;
  }

  // Bollinger bandwidth & 60-bar percentile
  const bandwidths: number[] = [];
  for (let i = Math.max(0, bars.length - 60); i < bars.length; i++) {
    const mid = bb.basis[i];
    const up = bb.upper[i];
    const lo = bb.lower[i];
    if (Number.isFinite(mid) && mid > 0 && Number.isFinite(up) && Number.isFinite(lo)) {
      bandwidths.push(((up - lo) / mid) * 100);
    }
  }
  const bbBandwidthPct = bandwidths.at(-1) ?? 8;
  const narrowerCount = bandwidths.filter(w => w <= bbBandwidthPct).length;
  const bbSqueezePercentile = bandwidths.length ? (narrowerCount / bandwidths.length) * 100 : 50;

  // Prior drawdown from 55-bar high
  const lookbackPeak = Math.max(...bars.slice(-55, -3).map(b => b.high));
  const recentLow = Math.min(...bars.slice(-30).map(b => b.low));
  const priorDrawdownPct = lookbackPeak > 0 ? ((lookbackPeak - recentLow) / lookbackPeak) * 100 : 0;

  // Volume dry-up and divergences around lows
  const idx1 = firstLowIdx ?? Math.max(5, bars.length - 18);
  const idx2 = secondLowIdx ?? Math.max(idx1 + 3, bars.length - 5);
  const selloffVol = mean(bars.slice(Math.max(0, idx1 - 4), idx1 + 2).map(b => b.volume));
  const retestVol = mean(bars.slice(Math.max(0, idx2 - 1), idx2 + 2).map(b => b.volume));
  const volumeDryUpRatio = selloffVol > 0 ? retestVol / selloffVol : 1;

  const obvDivergence = obv[idx2] > obv[idx1] && bars[idx2].low <= bars[idx1].low * 1.03;
  const adDivergence = ad[idx2] > ad[idx1] && bars[idx2].low <= bars[idx1].low * 1.03;
  const upDownVolumeRatio = computeUpDownVolumeRatio(bars, secondLowIdx ?? Math.max(1, bars.length - 15));
  const { contractions } = computeVcpContractions(bars);

  return {
    rsi14: round2(rsi14Val),
    ema20: round2(ema20Val),
    ema50: round2(ema50Val),
    vwap20: round2(vwap20Val),
    ema20DistPct: round2(((last.close - ema20Val) / ema20Val) * 100),
    ema50DistPct: round2(((last.close - ema50Val) / ema50Val) * 100),
    vwap20DistPct: round2(((last.close - vwap20Val) / vwap20Val) * 100),
    relativeStrengthPct: round2(relativeStrengthPct),
    benchmarkReturnPct: round2(benchmarkReturnPct),
    rvol20: round2(rvol20),
    volumeDryUpRatio: round2(volumeDryUpRatio),
    upDownVolumeRatio,
    obvDivergence,
    adDivergence,
    bbBandwidthPct: round2(bbBandwidthPct),
    bbSqueezePercentile: round2(bbSqueezePercentile),
    vcpContractions: contractions,
    priorDrawdownPct: round2(priorDrawdownPct),
  };
}

/**
 * Category A: Oversold + True Structural Bottom & Relative Strength
 * (Explicitly rejects cheap RSI < 30 without structural/volume/RS confirmation).
 */
export function detectStructuralBottomOpportunity(
  bars: readonly DailyStockBar[],
  benchmark: readonly DailyStockBar[],
  meta: { symbol: string; ticker: string; name: string; market: string; sector: string; currency: string },
  fundamentals: FundamentalSnapshot | null = null,
): TradeOpportunity | null {
  if (bars.length < 70 || benchmark.length < 30) return null;
  const lastIdx = bars.length - 1;
  const current = bars[lastIdx];
  const atrSeries = atr(bars, 14);
  const rsiSeries = rsi(bars.map(b => b.close), 14);
  const obv = computeObv(bars);
  const ad = computeAccumulationDistribution(bars);

  let best: TradeOpportunity | null = null;

  for (let first = lastIdx - 32; first <= lastIdx - 6; first++) {
    if (!isConfirmedPivotLow(bars, first)) continue;
    const unit = atrSeries[first];
    if (!Number.isFinite(unit) || unit <= 0) continue;

    // Require meaningful prior selloff (>= 10% and >= 3.2 ATR from prior 45-bar peak)
    const peakSlice = bars.slice(Math.max(0, first - 45), first - 2);
    if (!peakSlice.length) continue;
    const peakHigh = Math.max(...peakSlice.map(b => b.high));
    const drop = peakHigh - bars[first].low;
    const drawdownPct = (drop / peakHigh) * 100;
    if (drawdownPct < 10 || drop < 3.2 * unit) continue;

    for (let second = first + 4; second <= lastIdx - 2; second++) {
      if (!isConfirmedPivotLow(bars, second)) continue;
      const firstLow = bars[first].low;
      const secondLow = bars[second].low;

      // Allow Wyckoff Spring (slight undercut up to 0.45 ATR with close back above firstLow)
      // OR Double Bottom / Higher Low (up to +2.4 ATR above firstLow)
      const isWyckoffSpring =
        secondLow < firstLow &&
        secondLow >= firstLow - 0.45 * unit &&
        Math.max(bars[second].close, bars[second + 1].close) >= firstLow;
      const isHigherLow = secondLow > firstLow && secondLow <= firstLow + 2.4 * unit;
      const isDoubleBottom = !isWyckoffSpring && !isHigherLow && Math.abs(secondLow - firstLow) <= 0.35 * unit;

      if (!isWyckoffSpring && !isHigherLow && !isDoubleBottom) continue;

      const between = bars.slice(first + 1, second);
      if (!between.length) continue;
      const baseLow = Math.min(firstLow, secondLow);
      if (between.some(bar => bar.low < baseLow)) continue;
      const supportFloor = baseLow - 0.35 * unit;
      if (supportFloor <= 0 || bars.slice(first + 1).some(b => b.low < supportFloor)) continue;

      const neckline = Math.max(...between.map(b => b.high));
      if (neckline - firstLow < 1.3 * unit) continue;

      const tech = buildOpportunityTechnicals(bars, benchmark, first, second);
      if (!tech) continue;

      // Reclaim check: price must have reclaimed VWAP20, EMA20, or upper half of base
      const reclaimedEmaOrVwap = current.close >= tech.ema20 || current.close >= tech.vwap20;
      const reclaimedMidBase = current.close >= secondLow + 0.5 * (neckline - secondLow);
      if (!reclaimedEmaOrVwap && !reclaimedMidBase) continue;
      if (current.close > neckline + 2.2 * unit) continue;

      // Break of Structure (BoS) / Change of Character (CHoCH) check
      const minorSwingHigh = Math.max(...bars.slice(Math.max(first + 2, second - 4), second + 1).map(b => b.high));
      const priorBearSwingHigh = Math.max(...bars.slice(Math.max(0, first - 14), first + 1).map(b => b.high));
      const hasChoch = current.close > Math.min(neckline, priorBearSwingHigh) && current.close > minorSwingHigh;
      const hasBoS = current.close > minorSwingHigh || current.close >= neckline;

      // Volume Confirmation: Volume Dry-Up on retest OR OBV/AD bullish divergence OR strong up/down participation
      const hasVolumeDryUp = tech.volumeDryUpRatio <= 0.95;
      const hasBullishDivergence = tech.obvDivergence || tech.adDivergence || (obv[lastIdx] > obv[second] && ad[lastIdx] > ad[second]);
      const hasParticipation = tech.upDownVolumeRatio >= 1.1;
      if (!hasVolumeDryUp && !hasBullishDivergence && !hasParticipation) continue;

      // Relative Strength: must beat benchmark over window OR advance since retest while benchmark is weak
      const benchMap = new Map(benchmark.map(b => [b.session, b.close]));
      const bRetest = benchMap.get(bars[second].session);
      const bCurrent = benchMap.get(current.session);
      const rsSinceRetest = bRetest && bCurrent
        ? (((current.close / bars[second].close) / (bCurrent / bRetest)) - 1) * 100
        : tech.relativeStrengthPct;
      if (tech.relativeStrengthPct < 0.25 && rsSinceRetest < 0.4) continue;
      if (current.close <= bars[second].close) continue;

      const subType: OpportunitySubType = isWyckoffSpring
        ? "wyckoff-spring"
        : isHigherLow && hasBoS
          ? "bos-hl-reclaim"
          : "double-bottom";

      const scoreBreakdown: Record<string, number> = {
        "Marktstruktur (CHoCH & BoS)": isWyckoffSpring ? 28 : isHigherLow && hasChoch ? 28 : isHigherLow && hasBoS ? 27 : 23,
        "EMA20 / VWAP-Rückeroberung": (current.close >= tech.ema20 ? 8 : 0) + (current.close >= tech.vwap20 ? 6 : 0) + (current.close >= tech.ema50 ? 4 : 0),
        "Volumen Dry-Up & Partizipation": clamp(Math.round((1.05 - tech.volumeDryUpRatio) * 22 + (tech.upDownVolumeRatio - 1) * 8), 4, 20),
        "OBV / A-D Divergenz": (tech.obvDivergence ? 8 : 0) + (tech.adDivergence ? 6 : 0),
        "Relative Stärke vs. Index": clamp(Math.round(Math.max(tech.relativeStrengthPct, rsSinceRetest) * 2.5), 4, 18),
        "Überverkaufte Ausgangslage": (rsiSeries[first] ?? 50) < 38 ? 6 : 3,
      };
      const score = clamp(Math.round(Object.values(scoreBreakdown).reduce((a, b) => a + b, 0)), 50, 99);

      const support = Math.min(neckline, Math.max(secondLow, Math.min(tech.ema20, tech.vwap20)));
      const entryLow = round2(Math.max(secondLow, support - 0.35 * unit));
      const entryHigh = round2(Math.min(neckline, support + 0.35 * unit));
      const invalidation = round2(supportFloor);
      const measuredMove = neckline + (neckline - Math.min(firstLow, secondLow));
      const fib618 = Math.min(firstLow, secondLow) + 0.618 * (peakHigh - Math.min(firstLow, secondLow));
      const target1 = round2(Math.min(measuredMove, fib618, peakHigh));
      const target2 = round2(peakHigh);
      const lastClose = round2(current.close);
      const entryZone: TradeOpportunity["levels"]["entryZone"] = [entryLow, entryHigh];
      const entryMid = (entryZone[0] + entryZone[1]) / 2;

      const whySetup: string[] = [
        isWyckoffSpring
          ? `Wyckoff-Spring / Secondary Test am ${bars[second].session} (${secondLow.toFixed(2)} ${meta.currency}) nach ${drawdownPct.toFixed(1)}% Korrektur mit sofortiger Rückeroberung der Range${hasChoch ? " & CHoCH" : ""}.`
          : isHigherLow
            ? `Strukturelles Higher Low am ${bars[second].session} (${secondLow.toFixed(2)} vs. ${firstLow.toFixed(2)}).`
            : `Bestätigter Doppelboden (${bars[first].session} / ${bars[second].session}) nach ${drawdownPct.toFixed(1)}% Abverkauf${hasChoch ? " mit CHoCH-Reclaim" : ""}.`,
        `Schlusskurs ${current.close > neckline ? "über dem" : current.close === neckline ? "am" : "unter dem"} Zwischenhoch (${neckline.toFixed(2)} ${meta.currency}) und ${current.close > minorSwingHigh ? "über dem" : current.close === minorSwingHigh ? "am" : "unter dem"} lokalen Swing-Hoch (${minorSwingHigh.toFixed(2)} ${meta.currency}).`,
        `Retest-Volumen bei ${(tech.volumeDryUpRatio * 100).toFixed(0)}% des Selloff-Volumens${hasVolumeDryUp ? " (Volume Dry-Up)" : ""} · Aufwärts-/Abwärts-Volumenverhältnis ${tech.upDownVolumeRatio.toFixed(2)}×${tech.obvDivergence || tech.adDivergence ? " · Bullische OBV/A-D-Divergenz." : "."}`,
        `Relative Stärke: +${Math.max(tech.relativeStrengthPct, rsSinceRetest).toFixed(1)}% Outperformance gegenüber Benchmark${tech.benchmarkReturnPct < 0 ? ` trotz schwachem Gesamtmarkt (${tech.benchmarkReturnPct.toFixed(1)}%)` : ""}.`,
        `Schlusskurs ${current.close.toFixed(2)} · EMA 20 ${tech.ema20.toFixed(2)} · 20-Tage-VWAP ${tech.vwap20.toFixed(2)}.`,
      ];

      const candidate: TradeOpportunity = {
        id: `${meta.symbol}:${subType}`,
        symbol: meta.symbol,
        ticker: meta.ticker,
        name: meta.name,
        market: meta.market,
        sector: meta.sector,
        currency: meta.currency,
        session: current.session,
        category: "structural-bottom",
        subType,
        setupLabel: SUBTYPE_LABELS[subType],
        score,
        scoreBreakdown,
        whySetup,
        structure: {
          firstLow: { session: bars[first].session, price: firstLow },
          retest: { session: bars[second].session, price: secondLow },
          neckline,
          localSwingHigh: minorSwingHigh,
        },
        levels: {
          lastClose,
          entryZone,
          invalidation,
          target1,
          target2,
          riskReward: computeRiskReward(entryMid, invalidation, target1),
        },
        technicals: tech,
        fundamentals,
        chart: bars.slice(-45).map(({ session, open, high, low, close, volume }) => ({ session, open, high, low, close, volume })),
      };

      if (opportunityPlan(candidate.levels) && (!best || rankOpportunities(candidate, best) < 0)) best = candidate;
    }
  }
  return best;
}

/**
 * Category B: Fundamentally Undervalued Quality Stocks (Value & GARP)
 * Combines valuation discount vs. sector median, healthy balance sheet, FCF yield,
 * reported margins and analyst upside with technical stability.
 */
export function detectValueGarpOpportunity(
  bars: readonly DailyStockBar[],
  benchmark: readonly DailyStockBar[],
  meta: { symbol: string; ticker: string; name: string; market: string; sector: string; currency: string },
  fundamentals: FundamentalSnapshot | null,
): TradeOpportunity | null {
  if (!fundamentals?.valuationEvidence || bars.length < 60 || benchmark.length < 20) return null;
  const tech = buildOpportunityTechnicals(bars, benchmark);
  if (!tech) return null;

  const current = bars.at(-1)!;
  const unit = atr(bars, 14).at(-1) ?? current.close * 0.02;

  const inputs = fundamentals.valuationEvidence;
  if (Object.values(inputs).some(value => value !== null && !Number.isFinite(value))) return null;
  const { forwardPe, evToEbitda, fcfYieldPct, pegRatio, netDebtToEbitda, operatingMarginPct, analystTarget } = inputs;
  const { sectorMedianPe, historicalMedianPe, sectorMedianEvEbitda, analystConsensus } = fundamentals;

  // Valuation discount vs sector median, own historical multiple, or PEG <= 1.35
  const peDiscountPct =
    forwardPe !== null && forwardPe > 0 && sectorMedianPe !== null && sectorMedianPe > 0
      ? ((sectorMedianPe - forwardPe) / sectorMedianPe) * 100
      : 0;
  const evDiscountPct =
    evToEbitda !== null && evToEbitda > 0 && sectorMedianEvEbitda !== null && sectorMedianEvEbitda > 0
      ? ((sectorMedianEvEbitda - evToEbitda) / sectorMedianEvEbitda) * 100
      : 0;
  const histDiscountPct =
    forwardPe !== null && forwardPe > 0 && historicalMedianPe && historicalMedianPe > forwardPe
      ? (1 - forwardPe / historicalMedianPe) * 100
      : 0;

  const hasValuationDiscount =
    peDiscountPct >= 10 ||
    evDiscountPct >= 10 ||
    histDiscountPct >= 12 ||
    (pegRatio !== null && pegRatio > 0 && pegRatio <= 1.35);
  if (!hasValuationDiscount) return null;

  // Balance sheet health & FCF quality
  if (fcfYieldPct === null && operatingMarginPct === null) return null;
  if (netDebtToEbitda !== null && netDebtToEbitda > 2.6) return null;
  if (fcfYieldPct !== null && fcfYieldPct < 3.2) return null;
  if (operatingMarginPct !== null && operatingMarginPct < 10) return null;

  // Target / Fair-Value upside >= 12%
  const modelTarget = analystTarget ?? 0;
  const upsidePct = modelTarget > current.close ? ((modelTarget - current.close) / current.close) * 100 : 0;
  if (upsidePct < 12) return null;

  // Technical stabilization guard: do not buy free-falling stocks without support reclaim
  const recentSwingLow = Math.min(...bars.slice(-15).map(b => b.low));
  const priorSwingLow = Math.min(...bars.slice(-35, -15).map(b => b.low));
  const technicallyStabilized =
    current.close >= tech.ema20 * 0.99 ||
    current.close >= tech.vwap20 * 0.99 ||
    recentSwingLow >= priorSwingLow * 0.985;
  if (!technicallyStabilized) return null;

  const buyRatio =
    analystConsensus && analystConsensus.analystCount > 0
      ? ((analystConsensus.strongBuy ?? 0) + analystConsensus.buy) / analystConsensus.analystCount
      : 0;

  const scoreBreakdown: Record<string, number> = {
    "Bewertung vs. Sektor & Historie": clamp(
      Math.round(Math.max(peDiscountPct, evDiscountPct) * 0.72 + histDiscountPct * 0.28 + (pegRatio && pegRatio <= 1.2 ? 7 : 0)),
      8,
      26,
    ),
    "Free-Cashflow-Yield & Margen": clamp(Math.round((fcfYieldPct ?? 0) * 2.2 + Math.max(0, (operatingMarginPct ?? 0) - 10) * 0.45), 0, 22),
    "Bilanzqualität (Net Debt/EBITDA)": netDebtToEbitda !== null ? clamp(Math.round((2.5 - netDebtToEbitda) * 7), 0, 16) : 0,
    "Analystenziel": clamp(Math.round(upsidePct * 0.55 + buyRatio * 6), 6, 18),
    "Technische Basis": (current.close >= tech.ema20 ? 10 : 4) + (tech.relativeStrengthPct > 0 ? 8 : 0),
  };
  const score = clamp(Math.round(Object.values(scoreBreakdown).reduce((a, b) => a + b, 0)), 55, 98);

  const supportLevel = Math.max(0.01, Math.min(recentSwingLow, current.close - 1.5 * unit));
  const invalidation = round2(Math.max(0.01, supportLevel - 0.35 * unit));
  const entryLow = round2(Math.min(current.close * 0.985, Math.max(supportLevel, tech.ema20 * 0.99)));
  const entryHigh = round2(current.close * 1.01);
  const target1 = round2(Math.min(modelTarget, current.close + Math.max(2.5 * unit, (modelTarget - current.close) * 0.65)));
  const target2 = round2(modelTarget);

  const historyNote =
    historicalMedianPe && histDiscountPct >= 5
      ? ` · Historischer KGV-Median ${historicalMedianPe.toFixed(1)}× (−${histDiscountPct.toFixed(0)}%)`
      : "";
  const consensusNote = analystConsensus?.analystCount
    ? ` · Konsens: ${analystConsensus.ratingLabel} (${analystConsensus.analystCount} Analysten)`
    : "";

  const whySetup: string[] = [
    `Attraktive Bewertung (${meta.sector}): Forward-KGV ${forwardPe?.toFixed(1) ?? "—"}× (Sektor-Median ${sectorMedianPe?.toFixed(1) ?? "—"}×, ${peDiscountPct.toFixed(0)}% Abschlag${historyNote}) · EV/EBITDA ${evToEbitda?.toFixed(1) ?? "—"}×${pegRatio ? ` · PEG ${pegRatio.toFixed(2)}` : ""}.`,
    `Starke Bilanz & Cashflow: Free-Cashflow-Yield ${fcfYieldPct?.toFixed(1) ?? "—"}% · Net Debt/EBITDA ${netDebtToEbitda?.toFixed(2) ?? "—"}× · Operative Marge ${operatingMarginPct?.toFixed(1) ?? "—"}%.`,
    `Gemeldetes Analystenziel ${modelTarget.toFixed(2)} ${meta.currency} · Abstand zum Schlusskurs +${upsidePct.toFixed(1)}%${consensusNote}.`,
    `Technische Stabilisierung: Kurs hält über Support (${recentSwingLow.toFixed(2)}) mit ${current.close >= tech.ema20 ? "Rückeroberung des 20-EMA" : "stabiler Bodenbildung"} und RVOL ${tech.rvol20.toFixed(2)}×.`,
  ];

  return {
    id: `${meta.symbol}:value-garp`,
    symbol: meta.symbol,
    ticker: meta.ticker,
    name: meta.name,
    market: meta.market,
    sector: meta.sector,
    currency: meta.currency,
    session: current.session,
    category: "value-garp",
    subType: "value-garp",
    setupLabel: SUBTYPE_LABELS["value-garp"],
    score,
    scoreBreakdown,
    whySetup,
    levels: {
      lastClose: round2(current.close),
      entryZone: [entryLow, entryHigh],
      invalidation,
      target1,
      target2,
      riskReward: computeRiskReward((entryLow + entryHigh) / 2, invalidation, target1),
    },
    technicals: tech,
    fundamentals,
    chart: bars.slice(-45).map(({ session, open, high, low, close, volume }) => ({ session, open, high, low, close, volume })),
  };
}

/**
 * Category C: High-Conviction Setups
 * C1: VCP & Bollinger-Squeeze near resistance
 * C2: Insider-Cluster & Institutional Accumulation (SEC Form 4 + technical stabilization)
 * C3: Earnings-Gap & Post-Earnings-Drift (PEAD pullback to gap/VWAP support)
 */
export function detectHighConvictionOpportunities(
  bars: readonly DailyStockBar[],
  benchmark: readonly DailyStockBar[],
  meta: { symbol: string; ticker: string; name: string; market: string; sector: string; currency: string },
  fundamentals: FundamentalSnapshot | null = null,
): TradeOpportunity[] {
  if (bars.length < 60 || benchmark.length < 20) return [];
  const tech = buildOpportunityTechnicals(bars, benchmark);
  if (!tech) return [];

  const out: TradeOpportunity[] = [];
  const current = bars.at(-1)!;
  const unit = atr(bars, 14).at(-1) ?? current.close * 0.02;

  // --- C1: Volatility Contraction / Bollinger-Squeeze ---
  const high40 = Math.max(...bars.slice(-41, -1).map(b => b.high));
  const distToHighPct = ((high40 - current.close) / high40) * 100;
  const recentVol5 = mean(bars.slice(-6, -1).map(b => b.volume));
  const avgVol30 = mean(bars.slice(-35, -5).map(b => b.volume));
  const squeezeVolRatio = avgVol30 > 0 ? recentVol5 / avgVol30 : 1;
  const trigger = round2(high40 + Math.max(0.01, 0.1 * unit));
  const beyondTrigger = round2(current.close) >= trigger;

  const isTightSqueeze = (tech.vcpContractions >= 2 || tech.bbSqueezePercentile <= 28 || tech.bbBandwidthPct <= 6.5) &&
    distToHighPct >= -1 && distToHighPct <= 5.5 &&
    squeezeVolRatio <= 0.92 &&
    current.close >= tech.ema20 * 0.99 &&
    tech.relativeStrengthPct >= 0 &&
    (!beyondTrigger || tech.rvol20 >= 1.25);

  if (isTightSqueeze) {
    const tightLow = Math.min(...bars.slice(-10).map(b => b.low));
    const invalidation = round2(Math.max(0.01, tightLow - 0.35 * unit));
    const entryLow = trigger;
    const entryHigh = round2(trigger + Math.min(high40 * 0.005, unit * 0.35));
    const target1 = round2(high40 + 2.5 * unit);
    const target2 = round2(high40 + 4.5 * unit);
    const scoreBreakdown: Record<string, number> = {
      "VCP / Bollinger-Kontraktion": clamp(Math.round((35 - Math.min(30, tech.bbSqueezePercentile)) * 0.6 + tech.vcpContractions * 7), 14, 28),
      "Volumen Dry-Up vor Widerstand": clamp(Math.round((1.05 - squeezeVolRatio) * 35), 8, 22),
      "Nähe zum Breakout-Pivot": clamp(Math.round((6 - Math.max(0, distToHighPct)) * 3.2), 8, 18),
      "Relative Stärke & Trend": clamp(Math.round(tech.relativeStrengthPct * 2.2 + (current.close >= tech.ema50 ? 8 : 4)), 8, 20),
    };
    const score = clamp(Math.round(Object.values(scoreBreakdown).reduce((a, b) => a + b, 0)), 58, 97);

    out.push({
      id: `${meta.symbol}:vcp-squeeze`,
      symbol: meta.symbol,
      ticker: meta.ticker,
      name: meta.name,
      market: meta.market,
      sector: meta.sector,
      currency: meta.currency,
      session: current.session,
      category: "high-conviction",
      subType: "vcp-squeeze",
      setupLabel: SUBTYPE_LABELS["vcp-squeeze"],
      score,
      scoreBreakdown,
      whySetup: [
        `Volatility Contraction (VCP): ${tech.vcpContractions} Kontraktionswellen · Bollinger-Bandbreite ${tech.bbBandwidthPct.toFixed(1)}% (${tech.bbSqueezePercentile.toFixed(0)}. Perzentil).`,
        `Widerstands-Kompression: Kurs (${current.close.toFixed(2)}) notiert nur ${Math.max(0, distToHighPct).toFixed(1)}% unter dem 40d-Breakout-Level (${high40.toFixed(2)}).`,
        beyondTrigger ? `Ausbruch über ${trigger.toFixed(2)} mit ${tech.rvol20.toFixed(2)}× Tagesvolumen bestätigt.`
          : `Ausbruch ab ${trigger.toFixed(2)} mit mindestens 1,25× Tagesvolumen abwarten.`,
        `Volumen-Austrocknung in der Base (${(squeezeVolRatio * 100).toFixed(0)}% des 30d-Schnitts) bei +${tech.relativeStrengthPct.toFixed(1)}% Relativer Stärke vs. Index.`,
      ],
      levels: {
        lastClose: round2(current.close),
        entryZone: [entryLow, entryHigh],
        entryTrigger: entryLow,
        invalidation,
        target1,
        target2,
        riskReward: computeRiskReward((entryLow + entryHigh) / 2, invalidation, target1),
      },
      technicals: tech,
      fundamentals,
      chart: bars.slice(-45).map(({ session, open, high, low, close, volume }) => ({ session, open, high, low, close, volume })),
    });
  }

  // Only filings already published by the signal session qualify as a catalyst.
  const disclosedBuys = fundamentals?.recentInsiderFilings?.filter(filing =>
    filing.sourceUrl && filing.filedAt && filing.filedAt <= current.session && filing.shares > 0) ?? [];
  const disclosedValue = disclosedBuys.reduce((sum, filing) => sum + filing.valueUsd, 0);
  // --- C2: Insider-Cluster & Institutional Accumulation ---
  if (
    fundamentals &&
    (disclosedBuys.length >= 2 || disclosedValue >= 250_000) &&
    current.close >= tech.ema20 * 0.985 &&
    (tech.upDownVolumeRatio >= 1.05 || tech.obvDivergence || tech.adDivergence)
  ) {
    const recentLow = Math.min(...bars.slice(-12).map(b => b.low));
    const invalidation = round2(Math.max(0.01, recentLow - 0.4 * unit));
    const entryLow = round2(Math.min(current.close * 0.99, tech.ema20));
    const entryHigh = round2(current.close * 1.01);
    const target1 = round2(current.close + 2.6 * unit);
    const target2 = round2(current.close + 4.6 * unit);
    const scoreBreakdown: Record<string, number> = {
      "SEC Form 4 Insider-Cluster": clamp(disclosedBuys.length * 9 + (disclosedValue >= 1_000_000 ? 10 : 5), 16, 32),
      "Kaufdruck (OBV/Volumen)": clamp(Math.round((tech.upDownVolumeRatio - 0.9) * 18 + (tech.obvDivergence ? 7 : 0)), 8, 22),
      "Technische Stabilisierung (EMA/VWAP)": (current.close >= tech.ema20 ? 10 : 5) + (current.close >= tech.vwap20 ? 8 : 4),
      "Relative Stärke": clamp(Math.round(Math.max(0, tech.relativeStrengthPct) * 2), 0, 18),
    };
    const score = clamp(Math.round(Object.values(scoreBreakdown).reduce((a, b) => a + b, 0)), 60, 98);
    const topFiling = disclosedBuys[0];

    out.push({
      id: `${meta.symbol}:insider-cluster`,
      symbol: meta.symbol,
      ticker: meta.ticker,
      name: meta.name,
      market: meta.market,
      sector: meta.sector,
      currency: meta.currency,
      session: current.session,
      category: "high-conviction",
      subType: "insider-cluster",
      setupLabel: SUBTYPE_LABELS["insider-cluster"],
      score,
      scoreBreakdown,
      whySetup: [
        `Veröffentlichte SEC-Meldungen: ${disclosedBuys.length} Käufe mit Volumen $${(disclosedValue / 1_000).toFixed(0)}k${topFiling ? ` (zuletzt ${topFiling.insider}, ${topFiling.role} am ${topFiling.date})` : ""}.`,
        `Aufwärts-/Abwärts-Volumen ${tech.upDownVolumeRatio.toFixed(2)}× · Schlusskurs ${current.close.toFixed(2)} · VWAP20 ${tech.vwap20.toFixed(2)} · EMA20 ${tech.ema20.toFixed(2)}.`,
      ],
      levels: {
        lastClose: round2(current.close),
        entryZone: [entryLow, entryHigh],
        invalidation,
        target1,
        target2,
        riskReward: computeRiskReward((entryLow + entryHigh) / 2, invalidation, target1),
      },
      technicals: tech,
      fundamentals,
      chart: bars.slice(-45).map(({ session, open, high, low, close, volume }) => ({ session, open, high, low, close, volume })),
    });
  }

  // --- C3: Earnings-Gap & Post-Earnings-Drift (PEAD) ---
  for (let i = bars.length - 14; i <= bars.length - 2; i++) {
    if (i < 21) continue;
    const prev = bars[i - 1];
    const eventBar = bars[i];
    if (fundamentals?.verifiedEarningsSession !== eventBar.session && fundamentals?.verifiedEarningsSession !== prev.session) continue;
    const gapPct = ((eventBar.open - prev.close) / prev.close) * 100;
    const dayReturnPct = ((eventBar.close - prev.close) / prev.close) * 100;
    const baseVol = mean(bars.slice(i - 20, i).map(b => b.volume));
    const eventRvol = baseVol > 0 ? eventBar.volume / baseVol : 1;

    if ((gapPct >= 2.2 || dayReturnPct >= 4.2) && dayReturnPct <= 45 && eventRvol >= 1.55 && eventBar.close >= eventBar.open) {
      const postBars = bars.slice(i + 1);
      const gapSupport = Math.min(eventBar.low, (prev.close + eventBar.open) / 2);
      const heldGapSupport = postBars.every(b => b.close >= gapSupport && b.low >= gapSupport - 0.3 * unit);
      const anchoredPv = postBars.reduce((acc, b) => acc + ((b.high + b.low + b.close) / 3) * b.volume, ((eventBar.high + eventBar.low + eventBar.close) / 3) * eventBar.volume);
      const anchoredVol = postBars.reduce((acc, b) => acc + b.volume, eventBar.volume);
      const anchoredVwap = anchoredVol > 0 ? anchoredPv / anchoredVol : eventBar.close;

      if (heldGapSupport && current.close >= anchoredVwap * 0.985 && current.close <= eventBar.high * 1.06) {
        const invalidation = round2(Math.max(0.01, gapSupport - 0.35 * unit));
        const entryLow = round2(Math.max(gapSupport, anchoredVwap - 0.35 * unit));
        const entryHigh = round2(anchoredVwap + 0.35 * unit);
        const target1 = round2(eventBar.high + 2.2 * unit);
        const target2 = round2(eventBar.high + 4.2 * unit);
        const scoreBreakdown: Record<string, number> = {
          "Impuls-Gap & Relativvolumen": clamp(Math.round(eventRvol * 8 + dayReturnPct * 1.8), 16, 30),
          "Anchored-VWAP & Gap-Support": current.close >= anchoredVwap ? 22 : 16,
          "Konsolidierungs-Qualität (PEAD)": clamp(Math.round((1.1 - tech.volumeDryUpRatio) * 18), 8, 20),
          "Relative Stärke vs. Benchmark": clamp(Math.round(Math.max(4, tech.relativeStrengthPct * 2.5)), 6, 20),
        };
        const score = clamp(Math.round(Object.values(scoreBreakdown).reduce((a, b) => a + b, 0)), 60, 97);

        out.push({
          id: `${meta.symbol}:earnings-drift`,
          symbol: meta.symbol,
          ticker: meta.ticker,
          name: meta.name,
          market: meta.market,
          sector: meta.sector,
          currency: meta.currency,
          session: current.session,
          category: "high-conviction",
          subType: "earnings-drift",
          setupLabel: SUBTYPE_LABELS["earnings-drift"],
          score,
          scoreBreakdown,
          whySetup: [
            `Katalysator-Impuls am ${eventBar.session}: +${dayReturnPct.toFixed(1)}% Tagessprung (Gap +${Math.max(0, gapPct).toFixed(1)}%) unter ${eventRvol.toFixed(2)}× Relativvolumen.`,
            `Sauberer Pullback auf den Event-Anchored-VWAP (${anchoredVwap.toFixed(2)}) und Verteidigung des Gap-Supports (${gapSupport.toFixed(2)}).`,
            `Post-Earnings-Announcement-Drift (PEAD) mit +${tech.relativeStrengthPct.toFixed(1)}% Relativer Stärke gegenüber dem Index.`,
          ],
          levels: {
            lastClose: round2(current.close),
            entryZone: [entryLow, entryHigh],
            invalidation,
            target1,
            target2,
            riskReward: computeRiskReward((entryLow + entryHigh) / 2, invalidation, target1),
          },
          technicals: tech,
          fundamentals,
          chart: bars.slice(-45).map(({ session, open, high, low, close, volume }) => ({ session, open, high, low, close, volume })),
        });
        break;
      }
    }
  }

  return out;
}

/** Run all three multi-strategy detectors on a ticker and return sorted opportunities. */
export function evaluateTickerOpportunities(
  bars: readonly DailyStockBar[],
  benchmark: readonly DailyStockBar[],
  meta: { symbol: string; ticker: string; name: string; market: string; sector: string; currency: string },
  fundamentals: FundamentalSnapshot | null = null,
): TradeOpportunity[] {
  const results: TradeOpportunity[] = [];
  const catA = detectStructuralBottomOpportunity(bars, benchmark, meta, fundamentals);
  if (catA) results.push(catA);
  const catB = detectValueGarpOpportunity(bars, benchmark, meta, fundamentals);
  if (catB) results.push(catB);
  const catC = detectHighConvictionOpportunities(bars, benchmark, meta, fundamentals);
  results.push(...catC);
  return results.filter(({ levels }) => opportunityPlan(levels)).sort(rankOpportunities);
}

const encodeCsvCell = (value: string | number) =>
  typeof value === "string"
    ? csvEscape(/^[\s\uFEFF]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value) ? `'${value.replace(/[\r\n]/g, " ")}` : value.replace(/\r/g, " "))
    : csvEscape(value);

/** Export opportunities to RFC-4180 CSV with formula-injection protection. */
export function opportunitiesToCsv(rows: readonly TradeOpportunity[], scan?: OpportunityScanResult, combined = false): string {
  const header = [
    "symbol",
    "ticker",
    "name",
    "market",
    "sector",
    "category",
    "subtype",
    "setup_label",
    "score",
    "session",
    "currency",
    "last_close",
    "entry_low",
    "entry_high",
    "invalidation",
    "target_1",
    "target_2",
    "risk_reward",
    "relative_strength_pct",
    "rvol_20",
    "volume_dry_up_ratio",
    "forward_pe",
    "fcf_yield_pct",
    "insider_buys_90d",
    "rationale",
    "first_low_session", "first_low_price", "retest_session", "retest_low_price", "neckline", "local_swing_high",
    "benchmark", "benchmark_session", "scan_group", "scan_groups", "group_evaluated", "group_symbols", "group_unavailable", "group_excluded",
    ...(combined ? ["groups_processed", "universe_total", "evaluated_total", "attempted_total", "unavailable_total", "excluded_total"] : []),
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.symbol,
        row.ticker,
        row.name,
        row.market,
        row.sector,
        row.category,
        row.subType,
        row.setupLabel,
        row.score,
        row.session,
        row.currency,
        row.levels.lastClose,
        row.levels.entryZone[0],
        row.levels.entryZone[1],
        row.levels.invalidation,
        row.levels.target1,
        row.levels.target2,
        row.levels.riskReward,
        row.technicals.relativeStrengthPct,
        row.technicals.rvol20,
        row.technicals.volumeDryUpRatio,
        row.fundamentals?.forwardPe ?? "",
        row.fundamentals?.fcfYieldPct ?? "",
        row.fundamentals?.insiderBuys90d ?? "",
        row.whySetup.join(" | "),
        row.structure?.firstLow.session ?? "", row.structure?.firstLow.price ?? "", row.structure?.retest.session ?? "",
        row.structure?.retest.price ?? "", row.structure?.neckline ?? "", row.structure?.localSwingHigh ?? "",
        scan?.benchmark ?? "", scan?.benchmarkSession ?? "", scan && !combined ? (scan.page ?? 0) + 1 : "", scan?.pages ?? "",
        !combined ? scan?.evaluated ?? "" : "", !combined ? scan?.universe ?? "" : "",
        !combined ? scan?.unavailable?.length ?? "" : "", !combined ? scan?.excluded ?? "" : "",
        ...(combined && scan ? [(scan.page ?? 0) + 1, scan.totalUniverse ?? "", scan.evaluated,
          scan.universe, scan.unavailable.length, scan.excluded ?? 0] : combined ? ["", "", "", "", "", ""] : []),
      ]
        .map(encodeCsvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}
