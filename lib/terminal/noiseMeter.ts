export interface NoiseDayBar {
  session: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type NoiseStreakBasis = "candle" | "close";

export interface NoiseRecentDay {
  session: string;
  openToClosePct: number;
  closeToClosePct: number;
  greenCandle: boolean;
  greenDay: boolean;
}

export interface NoiseObservation {
  session: string;
  weekday: number; // 1=Mon .. 5=Fri (0/6 for 24/7 crypto)
  prevClose: number;
  open: number;
  high: number;
  low: number;
  close: number;
  gapPct: number;
  openToClosePct: number;
  closeToClosePct: number;
  gapFilled: boolean;
  fullFade: boolean;
  greenIntraday: boolean;
  greenDay: boolean;
  mfePct: number;
  maePct: number;
  priorStreak: number; // >0 green days (C>PrevC) before this bar, <0 red days before this bar
  priorCandleStreak: number; // >0 green candles (C>O) before this bar, <0 red candles before this bar
  atr14Pct: number;
  rsi14: number; // Wilder RSI(14) at day close (causal, no look-ahead)
  distEma20Pct: number; // (close - ema20) / ema20 * 100
  aboveSma200: boolean | null;
  volumeRatio20: number | null;
  moveAtrRatio: number; // closeToClosePct / atr14Pct
  nextDayCloseToClosePct: number | null; // T+1 return
  nextDayAbsMovePct: number | null; // |T+1 close-to-close return| (%)
  nextDayRangePct: number | null; // T+1 intraday (High - Low) / today close (%)
  nextDayTrueRangePct: number | null; // T+1 True Range (incl. overnight gap) / today close (%)
  nextDayGreen: boolean | null; // T+1 close > today close
  nextDayGreenCandle: boolean | null; // T+1 close > T+1 open
  prevDayCloseToClosePct: number | null; // T-1 return (causal)
  dayMinus2Pct: number | null; // T-2 return (causal)
  dayMinus3Pct: number | null; // T-3 return (causal)
  dayMinus4Pct: number | null; // T-4 return (causal)
  prior3dPct: number | null; // Cumulative 3-day Close-to-Close return BEFORE Tag 0 (causal)
  prior5dPct: number | null; // Cumulative 5-day Close-to-Close return BEFORE Tag 0 (causal)
  prior7dPct: number | null; // Cumulative 7-day Close-to-Close return BEFORE Tag 0 (causal)
  prior10dPct: number | null; // Cumulative 10-day Close-to-Close return BEFORE Tag 0 (causal)
  prior20dPct: number | null; // Cumulative 20-day Close-to-Close return BEFORE Tag 0 (causal)
  drawdownFrom52wHighPct: number; // <= 0, causal drawdown from rolling 252d closing peak
  inBearCycle: boolean; // Inside a >= 20% peak-to-trough bear market cycle
  bearOngoing: boolean; // True while inside an unconfirmed / ongoing >= 20% bear cycle
  fwd3dPct: number | null;
  fwd5dPct: number | null;
  fwd21dPct: number | null;
  fwd63dPct: number | null;
  fwd126dPct: number | null;
  fwd252dPct: number | null;
  fwdMaxDrop63dPct: number | null; // <= 0, deepest intraday low drop in next 63 trading days
  fwdMaxDrop252dPct: number | null; // <= 0, deepest intraday low drop in next 252 trading days
  dropToBottomPct: number | null; // <= 0, future drop to bear cycle bottom (or 252d low outside bear; null if ongoing/too recent)
  daysToBottom: number | null;
}

export interface NoiseDataset {
  observations: NoiseObservation[];
  firstSession: string;
  lastSession: string;
  totalDays: number;
  currentStreak: { direction: "red" | "green"; count: number };
  currentCandleStreak: { direction: "red" | "green"; count: number };
  recentDays: NoiseRecentDay[];
  currentAtr14Pct: number;
  baseGreenProb: number;
  lastClose: number;
  lastDayReturnPct: number | null;
  prevDayReturnPct: number | null;
  currentRsi14: number;
  lastAvgGain14: number;
  lastAvgLoss14: number;
  currentEma20: number;
  currentDistEma20Pct: number;
  currentSma200: number | null;
  currentAboveSma200: boolean | null;
  currentInBearCycle: boolean;
  currentDrawdown52wPct: number;
  gapMean: number;
  gapStd: number;
  absGapsSorted: number[];
}

export type ReturnRuleOp = "any" | "lte" | "gte";

export interface ReturnRule {
  op: ReturnRuleOp;
  thresholdPct: number;
}

export type PriorWindowDays = 3 | 5 | 7 | 10 | 20;

export interface PriorWindowRule {
  days: PriorWindowDays;
  op: ReturnRuleOp;
  thresholdPct: number;
}

export interface PatternStudyInput {
  ticker?: string;
  dayMinus4Rule?: ReturnRule;
  dayMinus3Rule?: ReturnRule;
  dayMinus2Rule?: ReturnRule;
  prevDayRule: ReturnRule;
  day0Rule: ReturnRule;
  priorWindowRule?: PriorWindowRule;
  regimeFilter?: "all" | "bear" | "bull";
  /** Minimum trading days between consecutive kept matches (0 = include all overlapping cluster days). */
  minGapDays?: number;
}

export interface LivePatternSnapshot {
  usingLiveToday: boolean;
  sessionLabel: string;
  day0Pct: number | null;
  prevDayPct: number | null;
  dayMinus2Pct: number | null;
  dayMinus3Pct: number | null;
  dayMinus4Pct: number | null;
  priorWindow: Record<PriorWindowDays, number | null>;
  inBearCycle: boolean;
  drawdown52wPct: number;
}

export interface PatternHorizonStat {
  id: "1d" | "5d" | "21d" | "63d" | "126d" | "252d";
  label: string;
  sampleSize: number;
  winRate: number;
  avgPct: number;
  medianPct: number;
  bestPct: number;
  worstPct: number;
}

export interface PatternMatch {
  session: string;
  dayMinus4Pct: number | null;
  dayMinus3Pct: number | null;
  dayMinus2Pct: number | null;
  prevDayPct: number | null;
  day0Pct: number;
  priorWindowPct: number | null;
  inBearCycle: boolean;
  bearOngoing: boolean;
  belowSma200: boolean | null;
  drawdown52wPct: number;
  nextDayPct: number | null;
  fwd5dPct: number | null;
  fwd21dPct: number | null;
  fwd63dPct: number | null;
  fwd126dPct: number | null;
  fwd252dPct: number | null;
  maxDrop63dPct: number | null;
  dropToBottomPct: number | null;
  daysToBottom: number | null;
}

export interface PatternStudyResult {
  ruleDescription: string;
  headline: string;
  bullets: string[];
  sampleSize: number;
  rawSampleSize: number;
  minGapDays: number;
  regimeCounts: {
    all: number;
    bear: number;
    bull: number;
  };
  firstYear: string;
  lastYear: string;
  totalDays: number;
  bearCycleCount: number;
  bearCycleRate: number;
  belowSma200Count: number;
  belowSma200Sample: number;
  belowSma200Rate: number | null;
  bottomEvaluatedCount: number;
  droppedFurtherCount: number;
  droppedFurtherRate: number;
  droppedAtLeast5PctRate: number;
  droppedAtLeast10PctRate: number;
  minFurtherDropPct: number | null; // least severe drop (e.g. -9.2% when 100% dropped >= 9.2%)
  medianFurtherDropPct: number | null;
  worstFurtherDropPct: number | null;
  medianDaysToBottom: number | null;
  maxDrop63dMedianPct: number | null;
  nextDayVol: {
    sampleSize: number;
    avgAbsMovePct: number;
    medianAbsMovePct: number;
    avgRangePct: number;
    medianRangePct: number;
  };
  horizons: PatternHorizonStat[];
  matches: PatternMatch[];
}

export interface NextDayForecastInput {
  priorStreakDays: number;
  priorStreakDirection: "red" | "green";
  streakBasis?: NoiseStreakBasis;
  todayMovePct: number;
  useExtraFactors?: boolean;
}

export interface NextDayVolatility {
  expectedAbsMovePct: number;
  expectedRangePct: number;
  expectedTrueRangePct: number;
  expectedRangeP80Pct: number;
  volRatioVsAtr: number;
  regime: "stark erhöht" | "erhöht" | "normal" | "beruhigt";
  regimeTone: "high" | "elevated" | "normal" | "calm";
  projectedPrice: number;
  expectedPriceLow: number;
  expectedPriceHigh: number;
  probMoveOver1Pct: number;
  probMoveOver2Pct: number;
  probMoveOver3Pct: number;
  historicalMedianAbsMovePct: number;
  historicalMedianRangePct: number;
}

export interface NextDayFactor {
  id: string;
  label: string;
  condition: string;
  greenProb: number;
  redProb: number;
  edgeVsBasePct: number;
  sampleSize: number;
  avgNextDayPct: number;
  stance: "bullish" | "bearish" | "neutral";
}

export interface NextDayTwin {
  session: string;
  priorStreak: number;
  dayMovePct: number;
  rsi14: number;
  nextDayPct: number;
  nextDayGreen: boolean;
  similarityPct: number;
}

export interface NextDayForecast {
  greenProb: number;
  redProb: number;
  greenCandleProb: number;
  baseGreenProb: number;
  edgeVsBasePct: number;
  avgNextDayPct: number;
  medianNextDayPct: number;
  fwd3dWinRate: number | null;
  fwd3dAvgPct: number | null;
  fwd5dWinRate: number | null;
  fwd5dAvgPct: number | null;
  effectiveSampleSize: number;
  confidence: "hoch" | "mittel" | "gering";
  scenarioLabel: string;
  summary: string;
  useExtraFactors: boolean;
  expectedVolatility: NextDayVolatility;
  projected: {
    todayMovePct: number;
    rsi14: number;
    moveAtrRatio: number;
    distEma20Pct: number;
    aboveSma200: boolean | null;
  };
  sequenceCohort: {
    label: string;
    sampleSize: number;
    greenProb: number;
    redProb: number;
    avgNextDayPct: number;
    effectiveStreakDays: number;
    usedFallback: boolean;
  };
  factors: NextDayFactor[];
  twins: NextDayTwin[];
}

export interface NoiseScenarioInput {
  gapPct: number;
  streakDays: number;
  streakDirection: "red" | "green";
  streakBasis?: NoiseStreakBasis;
  weekday?: number;
}

export interface GapCohortStats {
  bandLabel: string;
  direction: "up" | "down" | "flat";
  sampleSize: number;
  lowSample: boolean;
  gapFillProb: number;
  fullFadeProb: number;
  continuationProb: number;
  greenIntradayProb: number;
  greenDayProb: number;
  avgOpenToClosePct: number;
  medianOpenToClosePct: number;
  avgMfePct: number;
  avgMaePct: number;
  fwd3dAvgPct: number | null;
  fwd5dAvgPct: number | null;
  gapZScore: number;
  gapPercentile: number;
  gapToAtrRatio: number;
}

export interface StreakStats {
  direction: "red" | "green";
  days: number;
  mode: "exact" | "atLeast";
  label: string;
  sampleSize: number;
  lowSample: boolean;
  greenCloseProb: number;
  redCloseProb: number;
  greenIntradayProb: number;
  avgNextDayPct: number;
  medianNextDayPct: number;
  fwd3dAvgPct: number | null;
  fwd3dWinRate: number | null;
  fwd5dAvgPct: number | null;
  fwd5dWinRate: number | null;
}

export interface StreakGapBranch {
  sampleSize: number;
  gapFillProb: number;
  greenDayProb: number;
  greenIntradayProb: number;
  avgOpenToClosePct: number;
  avgCloseToClosePct: number;
}

export interface StreakGapCombo {
  effectiveStreakDays: number;
  streakDirection: "red" | "green";
  usedFallbackThreshold: boolean;
  upGap: StreakGapBranch;
  downGap: StreakGapBranch;
}

export interface GapBucketRow {
  id: string;
  label: string;
  min: number;
  max: number;
  sampleSize: number;
  gapFillProb: number;
  fullFadeProb: number;
  greenIntradayProb: number;
  greenDayProb: number;
  avgOpenToClosePct: number;
  active: boolean;
}

export interface WeekdayStat {
  weekday: number;
  label: string;
  sampleSize: number;
  greenDayProb: number;
  avgReturnPct: number;
  avgGapPct: number;
}

export interface HistoricalAnalogue {
  session: string;
  gapPct: number;
  openToClosePct: number;
  closeToClosePct: number;
  gapFilled: boolean;
  fullFade: boolean;
  priorStreak: number;
}

export type NoiseVerdictTone = "signal" | "mixed" | "noise";

export interface NoiseEvaluation {
  score: number; // 0 = strong signal / justified, 100 = high noise / fade risk
  tone: NoiseVerdictTone;
  verdictLabel: string;
  verdictSubtitle: string;
  streakBasis: NoiseStreakBasis;
  insights: string[];
  gapStats: GapCohortStats;
  streakExact: StreakStats;
  streakAtLeast: StreakStats;
  streakPrimary: StreakStats;
  combo: StreakGapCombo;
  gapBuckets: GapBucketRow[];
  redStreaks: StreakStats[];
  greenStreaks: StreakStats[];
  weekdays: WeekdayStat[];
  analogues: HistoricalAnalogue[];
}

export interface NoiseApiPayload {
  ticker: string;
  name: string;
  exchange: string;
  currency: string;
  timezone: string;
  asOf: string;
  years: number;
  rangeMode?: "years" | "max";
  totalDays: number;
  live: {
    prevClose: number;
    lastPrice: number;
    liveGapPct: number;
    liveTodayReturnPct?: number;
    priceSource: "premarket" | "afterhours" | "regular" | "last-close";
    currentStreak: { direction: "red" | "green"; count: number };
    currentCandleStreak?: { direction: "red" | "green"; count: number };
    currentAtr14Pct: number;
    currentRsi14?: number;
    currentDistEma20Pct?: number;
    currentAboveSma200?: boolean | null;
    nextWeekday: number;
  };
  bars: NoiseDayBar[];
}

const GAP_BUCKETS: ReadonlyArray<{ id: string; label: string; min: number; max: number }> = [
  { id: "lt-2", label: "< −2,0 %", min: -Infinity, max: -2.0 },
  { id: "-2-to-1", label: "−2,0 % bis −1,0 %", min: -2.0, max: -1.0 },
  { id: "-1-to-03", label: "−1,0 % bis −0,3 %", min: -1.0, max: -0.3 },
  { id: "flat", label: "−0,3 % bis +0,3 %", min: -0.3, max: 0.3 },
  { id: "03-to-1", label: "+0,3 % bis +1,0 %", min: 0.3, max: 1.0 },
  { id: "1-to-2", label: "+1,0 % bis +2,0 %", min: 1.0, max: 2.0 },
  { id: "gt-2", label: "> +2,0 %", min: 2.0, max: Infinity },
];

const WEEKDAY_LABELS: Record<number, string> = {
  1: "Mo",
  2: "Di",
  3: "Mi",
  4: "Do",
  5: "Fr",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function mean(values: readonly number[]): number {
  if (!values.length) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function pct(count: number, total: number): number {
  return total > 0 ? round1((count / total) * 100) : 0;
}

function sessionWeekday(session: string): number {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(session);
  if (!parts) return 1;
  const d = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  return d.getUTCDay(); // 0=Sun .. 6=Sat
}

function formatSignedDe(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1).replace(".", ",")} %`;
}

interface BearCycleLookup {
  inBearCycle: boolean[];
  bottomIdx: Array<number | null>;
  bottomPrice: Array<number | null>;
  ongoing: boolean[];
}

/**
 * Standard Wall Street 20% Peak-to-Trough Bear Market Cycle classifier:
 * marks every bar from cycle peak (exclusive) through intraday trough (inclusive) whenever price
 * declines >= 20% from peak before closing >= 20% above the trough. Consecutive bear legs
 * separated by short (< 252 trading day) dead-cat rallies that fail to reclaim the prior peak
 * and go on to make a lower low are merged into one continuous bear market (e.g. 2000-2002, 2007-2009, 2022).
 */
function computeBearCycles(bars: readonly NoiseDayBar[]): BearCycleLookup {
  const n = bars.length;
  const inBearCycle = new Array<boolean>(n).fill(false);
  const bottomIdx = new Array<number | null>(n).fill(null);
  const bottomPrice = new Array<number | null>(n).fill(null);
  const ongoing = new Array<boolean>(n).fill(false);
  if (n < 2) return { inBearCycle, bottomIdx, bottomPrice, ongoing };

  interface BearSeg {
    peakIdx: number;
    troughIdx: number;
    peakPrice: number;
    troughPrice: number;
    ongoing: boolean;
  }

  const raw: BearSeg[] = [];
  let regime: "bull" | "bear" = "bull";
  let peakIdx = 0;
  let troughIdx = 0;

  for (let i = 1; i < n; i++) {
    const hi = bars[i].high;
    const lo = bars[i].low;
    const cl = bars[i].close;
    if (regime === "bull") {
      if (hi >= bars[peakIdx].high) {
        peakIdx = i;
      } else if (lo <= bars[peakIdx].high * 0.8) {
        regime = "bear";
        troughIdx = i;
      }
    } else {
      if (lo <= bars[troughIdx].low) {
        troughIdx = i;
      } else if (cl >= bars[troughIdx].low * 1.2) {
        raw.push({
          peakIdx,
          troughIdx,
          peakPrice: bars[peakIdx].high,
          troughPrice: bars[troughIdx].low,
          ongoing: false,
        });
        regime = "bull";
        let bestPeak = i;
        for (let j = troughIdx + 1; j < i; j++) {
          if (bars[j].high > bars[bestPeak].high) bestPeak = j;
        }
        peakIdx = bestPeak;
      }
    }
  }
  if (regime === "bear") {
    raw.push({
      peakIdx,
      troughIdx,
      peakPrice: bars[peakIdx].high,
      troughPrice: bars[troughIdx].low,
      ongoing: true,
    });
  }

  const merged: BearSeg[] = [];
  for (const seg of raw) {
    const prev = merged.at(-1);
    if (
      prev &&
      seg.peakPrice < prev.peakPrice &&
      seg.troughPrice <= prev.troughPrice &&
      seg.peakIdx - prev.troughIdx < 252
    ) {
      prev.troughIdx = seg.troughIdx;
      prev.troughPrice = seg.troughPrice;
      prev.ongoing = seg.ongoing;
    } else {
      merged.push({ ...seg });
    }
  }

  for (const seg of merged) {
    for (let k = seg.peakIdx + 1; k <= seg.troughIdx; k++) {
      inBearCycle[k] = true;
      bottomIdx[k] = seg.troughIdx;
      bottomPrice[k] = seg.troughPrice;
      ongoing[k] = seg.ongoing;
    }
    if (seg.ongoing) {
      for (let k = seg.troughIdx + 1; k < n; k++) {
        inBearCycle[k] = true;
        ongoing[k] = true;
      }
    }
  }

  return { inBearCycle, bottomIdx, bottomPrice, ongoing };
}

/** O(N) sliding-window minimum intraday low over `[i + 1 .. min(N - 1, i + window)]`. */
function computeForwardMin(
  bars: readonly NoiseDayBar[],
  window: number,
): { minLow: Array<number | null>; minIdx: Array<number | null> } {
  const n = bars.length;
  const minLow = new Array<number | null>(n).fill(null);
  const minIdx = new Array<number | null>(n).fill(null);
  const dq: number[] = [];
  let head = 0;

  for (let i = n - 1; i >= 0; i--) {
    while (head < dq.length && dq[head] > i + window) head++;
    if (head < dq.length) {
      const idx = dq[head];
      minLow[i] = bars[idx].low;
      minIdx[i] = idx;
    }
    const l = bars[i].low;
    while (dq.length > head && bars[dq[dq.length - 1]].low >= l) dq.pop();
    dq.push(i);
  }
  return { minLow, minIdx };
}

/** O(N) causal rolling 252-trading-day peak close over `[max(0, i - 251) .. i]`. */
function computeRollingPeak252(bars: readonly NoiseDayBar[]): number[] {
  const n = bars.length;
  const peaks = new Array<number>(n);
  const dq: number[] = [];
  let head = 0;
  for (let i = 0; i < n; i++) {
    while (head < dq.length && dq[head] < i - 251) head++;
    const c = bars[i].close;
    while (dq.length > head && bars[dq[dq.length - 1]].close <= c) dq.pop();
    dq.push(i);
    peaks[i] = bars[dq[head]].close;
  }
  return peaks;
}

/**
 * Transforms chronological daily OHLCV bars into an empirical observation dataset
 * for gap-fill, fade/continuation, streak, volatility, pattern, and weekday statistics.
 */
export function buildNoiseDataset(rawBars: readonly NoiseDayBar[]): NoiseDataset {
  const bars = rawBars.filter(
    (b) =>
      b &&
      typeof b.session === "string" &&
      b.open > 0 &&
      b.high > 0 &&
      b.low > 0 &&
      b.close > 0 &&
      Number.isFinite(b.open) &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      Number.isFinite(b.close),
  );

  if (bars.length < 2) {
    const close0 = bars[0]?.close ?? 0;
    return {
      observations: [],
      firstSession: bars[0]?.session ?? "",
      lastSession: bars.at(-1)?.session ?? "",
      totalDays: bars.length,
      currentStreak: { direction: "green", count: 0 },
      currentCandleStreak: { direction: "green", count: 0 },
      recentDays: [],
      currentAtr14Pct: 0,
      baseGreenProb: 50,
      lastClose: close0,
      lastDayReturnPct: null,
      prevDayReturnPct: null,
      currentRsi14: 50,
      lastAvgGain14: 0,
      lastAvgLoss14: 0,
      currentEma20: close0,
      currentDistEma20Pct: 0,
      currentSma200: null,
      currentAboveSma200: null,
      currentInBearCycle: false,
      currentDrawdown52wPct: 0,
      gapMean: 0,
      gapStd: 0,
      absGapsSorted: [],
    };
  }

  const bearCycles = computeBearCycles(bars);
  const fwdMin63 = computeForwardMin(bars, 63);
  const fwdMin252 = computeForwardMin(bars, 252);
  const rollingPeak252 = computeRollingPeak252(bars);

  const trueRanges: number[] = [bars[0].high - bars[0].low];
  const observations: NoiseObservation[] = [];
  let runningStreak = 0;
  let runningCandleStreak =
    bars[0].close > bars[0].open ? 1 : bars[0].close < bars[0].open ? -1 : 0;

  // Wilder RSI(14), EMA(20), SMA(200), and 20-day rolling volume accumulators (strictly causal)
  let avgGain14 = 0;
  let avgLoss14 = 0;
  let seedGainSum = 0;
  let seedLossSum = 0;
  let ema20 = bars[0].close;
  const emaAlpha = 2 / (20 + 1);
  let sma200Sum = bars[0].close;
  let vol20Sum = bars[0].volume;
  let prevCloseToClosePct: number | null = null;

  const rsiFromAvgs = (g: number, l: number): number => {
    if (l === 0 && g === 0) return 50;
    if (l === 0) return 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  };

  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    trueRanges.push(tr);

    // 14-day ATR strictly using bars BEFORE today (no look-ahead!)
    const atrEnd = i;
    const atrStart = Math.max(0, atrEnd - 14);
    let trSum = 0;
    for (let k = atrStart; k < atrEnd; k++) trSum += trueRanges[k];
    const atr14 = trSum / Math.max(1, atrEnd - atrStart);
    const atr14Pct = prev.close > 0 ? (atr14 / prev.close) * 100 : 0;

    // Wilder RSI(14) as of day `i` close
    const delta = curr.close - prev.close;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    if (i <= 14) {
      seedGainSum += gain;
      seedLossSum += loss;
      avgGain14 = seedGainSum / i;
      avgLoss14 = seedLossSum / i;
    } else {
      avgGain14 = (avgGain14 * 13 + gain) / 14;
      avgLoss14 = (avgLoss14 * 13 + loss) / 14;
    }
    const rsi14 = round1(rsiFromAvgs(avgGain14, avgLoss14));

    // EMA(20) and SMA(200) as of day `i` close
    ema20 = curr.close * emaAlpha + ema20 * (1 - emaAlpha);
    const distEma20Pct = ema20 > 0 ? round2(((curr.close - ema20) / ema20) * 100) : 0;

    sma200Sum += curr.close;
    if (i >= 200) sma200Sum -= bars[i - 200].close;
    const sma200 = i >= 199 ? sma200Sum / 200 : null;
    const aboveSma200 = sma200 !== null ? curr.close >= sma200 : null;

    // 20-day average volume prior to today (causal)
    const volWindowLen = Math.min(i, 20);
    const priorAvgVol = volWindowLen > 0 ? vol20Sum / volWindowLen : 0;
    const volumeRatio20 =
      priorAvgVol > 0 && curr.volume > 0 ? round2(curr.volume / priorAvgVol) : null;
    vol20Sum += curr.volume;
    if (i >= 20) vol20Sum -= bars[i - 20].volume;

    const gapPct = ((curr.open - prev.close) / prev.close) * 100;
    const openToClosePct = ((curr.close - curr.open) / curr.open) * 100;
    const closeToClosePct = ((curr.close - prev.close) / prev.close) * 100;
    const moveAtrRatio = atr14Pct > 0.05 ? round2(closeToClosePct / atr14Pct) : 0;

    const peak252 = rollingPeak252[i];
    const drawdownFrom52wHighPct =
      peak252 > 0 ? round2(Math.min(0, ((curr.close - peak252) / peak252) * 100)) : 0;

    const isUpGap = gapPct > 0;
    const isDownGap = gapPct < 0;
    const gapFilled = isUpGap
      ? curr.low <= prev.close
      : isDownGap
        ? curr.high >= prev.close
        : true;
    const fullFade = isUpGap
      ? curr.close < prev.close
      : isDownGap
        ? curr.close > prev.close
        : false;

    const mfePct = isDownGap
      ? ((curr.open - curr.low) / curr.open) * 100
      : ((curr.high - curr.open) / curr.open) * 100;
    const maePct = isDownGap
      ? ((curr.high - curr.open) / curr.open) * 100
      : ((curr.open - curr.low) / curr.open) * 100;

    const nextBar = i + 1 < bars.length ? bars[i + 1] : null;
    const nextDayCloseToClosePct =
      nextBar && curr.close > 0 ? ((nextBar.close - curr.close) / curr.close) * 100 : null;
    const nextDayAbsMovePct =
      nextDayCloseToClosePct !== null ? Math.abs(nextDayCloseToClosePct) : null;
    const nextDayRangePct =
      nextBar && curr.close > 0
        ? Math.max(0, ((nextBar.high - nextBar.low) / curr.close) * 100)
        : null;
    const nextDayTrueRangePct =
      nextBar && curr.close > 0
        ? Math.max(
            0,
            (Math.max(
              nextBar.high - nextBar.low,
              Math.abs(nextBar.high - curr.close),
              Math.abs(nextBar.low - curr.close),
            ) /
              curr.close) *
              100,
          )
        : null;
    const nextDayGreen = nextBar ? nextBar.close > curr.close : null;
    const nextDayGreenCandle = nextBar ? nextBar.close > nextBar.open : null;

    const fwdAt = (offset: number): number | null =>
      i + offset < bars.length ? ((bars[i + offset].close - curr.close) / curr.close) * 100 : null;

    const fwd3dPct = fwdAt(3);
    const fwd5dPct = fwdAt(5);
    const fwd21dPct = fwdAt(21);
    const fwd63dPct = fwdAt(63);
    const fwd126dPct = fwdAt(126);
    const fwd252dPct = fwdAt(252);

    const remainingBars = bars.length - 1 - i;
    const fwdMaxDrop63dPct =
      remainingBars >= 5 && fwdMin63.minLow[i] !== null
        ? round2(Math.min(0, ((fwdMin63.minLow[i]! - curr.close) / curr.close) * 100))
        : null;
    const fwdMaxDrop252dPct =
      remainingBars >= 5 && fwdMin252.minLow[i] !== null
        ? round2(Math.min(0, ((fwdMin252.minLow[i]! - curr.close) / curr.close) * 100))
        : null;

    const inBear = bearCycles.inBearCycle[i];
    const bearOngoing = bearCycles.ongoing[i];
    const bIdx = bearCycles.bottomIdx[i];
    const bPrice = bearCycles.bottomPrice[i];

    let dropToBottomPct: number | null = null;
    let daysToBottom: number | null = null;
    if (inBear) {
      if (!bearOngoing && bIdx !== null && bPrice !== null) {
        if (i < bIdx && bPrice < curr.close) {
          dropToBottomPct = round2(((bPrice - curr.close) / curr.close) * 100);
          daysToBottom = bIdx - i;
        } else {
          // On the exact trough day (i === bIdx), the bear bottom was already printed
          // intraday before Tag 0's close — never count today's own lower wick as a future drop.
          dropToBottomPct = 0;
          daysToBottom = 0;
        }
      }
      // When bearOngoing is true, the bear cycle's final bottom is not yet confirmed
      // (+20% recovery not achieved), so dropToBottomPct and daysToBottom remain null ("laufend").
    } else if (remainingBars >= 5 && fwdMaxDrop252dPct !== null) {
      dropToBottomPct = fwdMaxDrop252dPct;
      daysToBottom =
        fwdMaxDrop252dPct < 0 && fwdMin252.minIdx[i] !== null ? fwdMin252.minIdx[i]! - i : 0;
    }

    const dayReturnAt = (barIdx: number): number | null => {
      if (barIdx < 1 || barIdx >= bars.length) return null;
      const pClose = bars[barIdx - 1].close;
      return pClose > 0 ? ((bars[barIdx].close - pClose) / pClose) * 100 : null;
    };
    const priorWindowAt = (windowDays: number): number | null => {
      const startIdx = i - 1 - windowDays;
      if (startIdx < 0) return null;
      const baseC = bars[startIdx].close;
      return baseC > 0 ? ((prev.close - baseC) / baseC) * 100 : null;
    };

    observations.push({
      session: curr.session,
      weekday: sessionWeekday(curr.session),
      prevClose: prev.close,
      open: curr.open,
      high: curr.high,
      low: curr.low,
      close: curr.close,
      gapPct,
      openToClosePct,
      closeToClosePct,
      gapFilled,
      fullFade,
      greenIntraday: curr.close > curr.open,
      greenDay: curr.close > prev.close,
      mfePct: Math.max(0, mfePct),
      maePct: Math.max(0, maePct),
      priorStreak: runningStreak,
      priorCandleStreak: runningCandleStreak,
      atr14Pct,
      rsi14,
      distEma20Pct,
      aboveSma200,
      volumeRatio20,
      moveAtrRatio,
      nextDayCloseToClosePct,
      nextDayAbsMovePct,
      nextDayRangePct,
      nextDayTrueRangePct,
      nextDayGreen,
      nextDayGreenCandle,
      prevDayCloseToClosePct: prevCloseToClosePct,
      dayMinus2Pct: dayReturnAt(i - 2),
      dayMinus3Pct: dayReturnAt(i - 3),
      dayMinus4Pct: dayReturnAt(i - 4),
      prior3dPct: priorWindowAt(3),
      prior5dPct: priorWindowAt(5),
      prior7dPct: priorWindowAt(7),
      prior10dPct: priorWindowAt(10),
      prior20dPct: priorWindowAt(20),
      drawdownFrom52wHighPct,
      inBearCycle: inBear,
      bearOngoing,
      fwd3dPct,
      fwd5dPct,
      fwd21dPct,
      fwd63dPct,
      fwd126dPct,
      fwd252dPct,
      fwdMaxDrop63dPct,
      fwdMaxDrop252dPct,
      dropToBottomPct,
      daysToBottom,
    });

    prevCloseToClosePct = closeToClosePct;

    // Update close-to-close streak AFTER recording priorStreak for day `i`
    if (curr.close > prev.close) {
      runningStreak = runningStreak >= 0 ? runningStreak + 1 : 1;
    } else if (curr.close < prev.close) {
      runningStreak = runningStreak <= 0 ? runningStreak - 1 : -1;
    } else {
      runningStreak = 0;
    }

    // Update candle-color streak (Close vs Open) AFTER recording priorCandleStreak for day `i`
    if (curr.close > curr.open) {
      runningCandleStreak = runningCandleStreak >= 0 ? runningCandleStreak + 1 : 1;
    } else if (curr.close < curr.open) {
      runningCandleStreak = runningCandleStreak <= 0 ? runningCandleStreak - 1 : -1;
    } else {
      runningCandleStreak = 0;
    }
  }

  // Latest ATR14% as of the last bar (used for live Premarket gap / ATR comparison)
  const latestClose = bars[bars.length - 1].close;
  const tailStart = Math.max(0, trueRanges.length - 14);
  let tailSum = 0;
  for (let k = tailStart; k < trueRanges.length; k++) tailSum += trueRanges[k];
  const currentAtr14Pct =
    latestClose > 0 ? (tailSum / Math.max(1, trueRanges.length - tailStart) / latestClose) * 100 : 0;

  const gaps = observations.map((o) => o.gapPct);
  const gapMean = mean(gaps);
  let varSum = 0;
  for (const g of gaps) varSum += (g - gapMean) ** 2;
  const gapStd = gaps.length > 1 ? Math.sqrt(varSum / (gaps.length - 1)) : 0;
  const absGapsSorted = observations.map((o) => Math.abs(o.gapPct)).sort((a, b) => a - b);

  const baseGreenProb = observations.length
    ? pct(observations.filter((o) => o.greenDay).length, observations.length)
    : 50;
  const currentRsi14 = round1(rsiFromAvgs(avgGain14, avgLoss14));
  const currentDistEma20Pct = ema20 > 0 ? round2(((latestClose - ema20) / ema20) * 100) : 0;
  const currentSma200 = bars.length >= 200 ? sma200Sum / 200 : null;
  const currentAboveSma200 = currentSma200 !== null ? latestClose >= currentSma200 : null;
  const lastObs = observations.at(-1);
  const prevObs = observations.length >= 2 ? observations[observations.length - 2] : undefined;

  const recentDays: NoiseRecentDay[] = observations.slice(-10).map((o) => ({
    session: o.session,
    openToClosePct: round2(o.openToClosePct),
    closeToClosePct: round2(o.closeToClosePct),
    greenCandle: o.greenIntraday,
    greenDay: o.greenDay,
  }));

  return {
    observations,
    firstSession: bars[0].session,
    lastSession: bars[bars.length - 1].session,
    totalDays: bars.length,
    currentStreak: {
      direction: runningStreak < 0 ? "red" : "green",
      count: Math.abs(runningStreak),
    },
    currentCandleStreak: {
      direction: runningCandleStreak < 0 ? "red" : "green",
      count: Math.abs(runningCandleStreak),
    },
    recentDays,
    currentAtr14Pct: round2(currentAtr14Pct),
    baseGreenProb,
    lastClose: latestClose,
    lastDayReturnPct: lastObs ? round2(lastObs.closeToClosePct) : null,
    prevDayReturnPct: prevObs ? round2(prevObs.closeToClosePct) : null,
    currentRsi14,
    lastAvgGain14: avgGain14,
    lastAvgLoss14: avgLoss14,
    currentEma20: ema20,
    currentDistEma20Pct,
    currentSma200,
    currentAboveSma200,
    currentInBearCycle: bearCycles.inBearCycle[bars.length - 1] ?? false,
    currentDrawdown52wPct: lastObs ? lastObs.drawdownFrom52wHighPct : 0,
    gapMean: round2(gapMean),
    gapStd: round2(gapStd),
    absGapsSorted,
  };
}

function streakValueOf(o: NoiseObservation, basis: NoiseStreakBasis): number {
  return basis === "candle" ? o.priorCandleStreak : o.priorStreak;
}

function summarizeStreak(
  observations: readonly NoiseObservation[],
  direction: "red" | "green",
  days: number,
  mode: "exact" | "atLeast",
  basis: NoiseStreakBasis = "close",
): StreakStats {
  const matched = observations.filter((o) => {
    const val = streakValueOf(o, basis);
    if (direction === "red") {
      return mode === "exact" ? val === -days : val <= -days;
    }
    return mode === "exact" ? val === days : val >= days;
  });

  const n = matched.length;
  const greenCount = matched.filter((o) => o.greenDay).length;
  const redCount = matched.filter((o) => o.close < o.prevClose).length;
  const greenIntra = matched.filter((o) => o.greenIntraday).length;
  const nextReturns = matched.map((o) => o.closeToClosePct);
  const fwd3 = matched.map((o) => o.fwd3dPct).filter((v): v is number => v !== null);
  const fwd5 = matched.map((o) => o.fwd5dPct).filter((v): v is number => v !== null);

  const dirWord =
    basis === "candle"
      ? direction === "red"
        ? days === 1
          ? "roter Kerze"
          : "roten Kerzen"
        : days === 1
          ? "grüner Kerze"
          : "grünen Kerzen"
      : direction === "red"
        ? days === 1
          ? "rotem Tag"
          : "roten Tagen"
        : days === 1
          ? "grünem Tag"
          : "grünen Tagen";
  const prefix = mode === "atLeast" ? "≥ " : "";

  return {
    direction,
    days,
    mode,
    label: `Nach ${prefix}${days} ${dirWord}`,
    sampleSize: n,
    lowSample: n < 12,
    greenCloseProb: pct(greenCount, n),
    redCloseProb: pct(redCount, n),
    greenIntradayProb: pct(greenIntra, n),
    avgNextDayPct: round2(mean(nextReturns)),
    medianNextDayPct: round2(median(nextReturns)),
    fwd3dAvgPct: fwd3.length ? round2(mean(fwd3)) : null,
    fwd3dWinRate: fwd3.length ? pct(fwd3.filter((v) => v > 0).length, fwd3.length) : null,
    fwd5dAvgPct: fwd5.length ? round2(mean(fwd5)) : null,
    fwd5dWinRate: fwd5.length ? pct(fwd5.filter((v) => v > 0).length, fwd5.length) : null,
  };
}

function summarizeBranch(items: readonly NoiseObservation[]): StreakGapBranch {
  const n = items.length;
  return {
    sampleSize: n,
    gapFillProb: pct(items.filter((o) => o.gapFilled).length, n),
    greenDayProb: pct(items.filter((o) => o.greenDay).length, n),
    greenIntradayProb: pct(items.filter((o) => o.greenIntraday).length, n),
    avgOpenToClosePct: round2(mean(items.map((o) => o.openToClosePct))),
    avgCloseToClosePct: round2(mean(items.map((o) => o.closeToClosePct))),
  };
}

function selectGapCohort(
  dataset: NoiseDataset,
  gapPct: number,
): { matched: NoiseObservation[]; bandLabel: string; direction: "up" | "down" | "flat" } {
  const obs = dataset.observations;
  const abs = Math.abs(gapPct);

  if (abs < 0.15) {
    return {
      matched: obs.filter((o) => Math.abs(o.gapPct) < 0.3),
      bandLabel: "−0,3 % bis +0,3 % (Flach)",
      direction: "flat",
    };
  }

  const direction: "up" | "down" = gapPct > 0 ? "up" : "down";
  const sign = direction === "up" ? 1 : -1;
  const halfWidth = Math.max(0.35, abs * 0.35);
  const lowAbs = Math.max(0.15, abs - halfWidth);
  const highAbs = abs + halfWidth;

  const tight = obs.filter((o) => {
    const signed = o.gapPct * sign;
    return signed >= lowAbs && signed <= highAbs;
  });

  if (tight.length >= 20) {
    const lo = sign > 0 ? lowAbs : -highAbs;
    const hi = sign > 0 ? highAbs : -lowAbs;
    return {
      matched: tight,
      bandLabel: `${formatSignedDe(lo)} bis ${formatSignedDe(hi)}`,
      direction,
    };
  }

  // Adaptive threshold cohort for larger / rarer gaps so sample stays meaningful
  const threshold = abs >= 2.0 ? 1.5 : abs >= 1.0 ? 0.8 : 0.3;
  const tail = obs.filter((o) => o.gapPct * sign >= threshold);
  if (tail.length >= 10) {
    return {
      matched: tail,
      bandLabel: direction === "up" ? `≥ ${formatSignedDe(threshold)}` : `≤ ${formatSignedDe(-threshold)}`,
      direction,
    };
  }

  const allSameDir = obs.filter((o) => o.gapPct * sign >= 0.15);
  return {
    matched: allSameDir,
    bandLabel: direction === "up" ? "Alle Up-Gaps (≥ +0,15 %)" : "Alle Down-Gaps (≤ −0,15 %)",
    direction,
  };
}

function percentileOf(sorted: readonly number[], value: number): number {
  if (!sorted.length) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return round1((lo / sorted.length) * 100);
}

/**
 * Evaluates a live or hypothetical Premarket Gap + Index Streak scenario
 * against the historical dataset, producing the NoiseMeter score (0–100) and full stats.
 */
export function evaluateNoiseScenario(
  dataset: NoiseDataset,
  input: NoiseScenarioInput,
): NoiseEvaluation {
  const gapPct = Number.isFinite(input.gapPct) ? clamp(input.gapPct, -30, 30) : 0;
  const streakDays = Math.max(1, Math.min(12, Math.round(input.streakDays || 1)));
  const streakDirection = input.streakDirection === "red" ? "red" : "green";
  const streakBasis: NoiseStreakBasis = input.streakBasis === "candle" ? "candle" : "close";

  const { matched, bandLabel, direction } = selectGapCohort(dataset, gapPct);
  const n = matched.length;
  const gapFillProb = pct(matched.filter((o) => o.gapFilled).length, n);
  const fullFadeProb = pct(matched.filter((o) => o.fullFade).length, n);
  const continuationCount = matched.filter((o) =>
    direction === "up" ? o.close > o.open : direction === "down" ? o.close < o.open : o.greenIntraday,
  ).length;
  const continuationProb = pct(continuationCount, n);
  const greenIntradayProb = pct(matched.filter((o) => o.greenIntraday).length, n);
  const greenDayProb = pct(matched.filter((o) => o.greenDay).length, n);
  const openToCloses = matched.map((o) => o.openToClosePct);
  const fwd3 = matched.map((o) => o.fwd3dPct).filter((v): v is number => v !== null);
  const fwd5 = matched.map((o) => o.fwd5dPct).filter((v): v is number => v !== null);

  const gapZScore = dataset.gapStd > 0 ? round2((gapPct - dataset.gapMean) / dataset.gapStd) : 0;
  const gapPercentile = percentileOf(dataset.absGapsSorted, Math.abs(gapPct));
  const gapToAtrRatio =
    dataset.currentAtr14Pct > 0 ? round2(Math.abs(gapPct) / dataset.currentAtr14Pct) : 0;

  const gapStats: GapCohortStats = {
    bandLabel,
    direction,
    sampleSize: n,
    lowSample: n < 15,
    gapFillProb,
    fullFadeProb,
    continuationProb,
    greenIntradayProb,
    greenDayProb,
    avgOpenToClosePct: round2(mean(openToCloses)),
    medianOpenToClosePct: round2(median(openToCloses)),
    avgMfePct: round2(mean(matched.map((o) => o.mfePct))),
    avgMaePct: round2(mean(matched.map((o) => o.maePct))),
    fwd3dAvgPct: fwd3.length ? round2(mean(fwd3)) : null,
    fwd5dAvgPct: fwd5.length ? round2(mean(fwd5)) : null,
    gapZScore,
    gapPercentile,
    gapToAtrRatio,
  };

  // Streak stats (exact and cumulative >= k)
  const streakExact = summarizeStreak(dataset.observations, streakDirection, streakDays, "exact", streakBasis);
  const streakAtLeast = summarizeStreak(dataset.observations, streakDirection, streakDays, "atLeast", streakBasis);
  const streakPrimary = streakExact.sampleSize >= 12 ? streakExact : streakAtLeast;

  // Streak + Gap combination effect (fall back down to smaller >= k if needed for >= 10 samples)
  let effectiveDays = streakDays;
  let usedFallbackThreshold = false;
  const filterByStreak = (d: number) =>
    dataset.observations.filter((o) => {
      const val = streakValueOf(o, streakBasis);
      return streakDirection === "red" ? val <= -d : val >= d;
    });
  let streakPool = filterByStreak(effectiveDays);
  while (effectiveDays > 2 && streakPool.length < 10) {
    effectiveDays -= 1;
    usedFallbackThreshold = true;
    streakPool = filterByStreak(effectiveDays);
  }
  const combo: StreakGapCombo = {
    effectiveStreakDays: effectiveDays,
    streakDirection,
    usedFallbackThreshold,
    upGap: summarizeBranch(streakPool.filter((o) => o.gapPct >= 0.2)),
    downGap: summarizeBranch(streakPool.filter((o) => o.gapPct <= -0.2)),
  };

  // NoiseMeter composite score (0 = Signal / Justified, 100 = High Noise / Fade Risk)
  let score = 50;
  if (direction !== "flat" && n > 0) {
    const fadeRate = 100 - continuationProb;
    const stretchScore = clamp((gapToAtrRatio / 1.8) * 100, 0, 100);
    // Does streak mean-reversion support or oppose this gap?
    let streakPressure = 50;
    if (streakPrimary.sampleSize >= 5) {
      const alignedWithGapProb =
        direction === "up" ? streakPrimary.greenCloseProb : streakPrimary.redCloseProb;
      streakPressure = clamp(100 - alignedWithGapProb, 0, 100);
    }
    score = Math.round(
      clamp(
        gapFillProb * 0.4 +
          fadeRate * 0.35 +
          stretchScore * 0.15 +
          streakPressure * 0.1,
        0,
        100,
      ),
    );
  }

  let tone: NoiseVerdictTone;
  let verdictLabel: string;
  let verdictSubtitle: string;
  if (direction === "flat") {
    tone = "mixed";
    verdictLabel = "Kein Premarket-Gap";
    verdictSubtitle =
      "Aktuelle Abweichung liegt unter 0,15 % — keine statistische Gap-Übertreibung. Nutze den Regler, um ein Premarket-Szenario zu testen.";
  } else if (score >= 65) {
    tone = "noise";
    verdictLabel = direction === "up" ? "Hohes Noise / Fade-Risiko" : "Überverkaufter Gap-Noise";
    verdictSubtitle =
      direction === "up"
        ? "Historisch wurde ein Premarket-Pump dieser Größe überwiegend abverkauft und das Gap intraday geschlossen."
        : "Historisch wurden Down-Gaps dieser Größe häufig intraday aufgekauft und Richtung Vortages-Close geschlossen.";
  } else if (score <= 38) {
    tone = "signal";
    verdictLabel = "Gerechtfertigt / Signal-Tendenz";
    verdictSubtitle =
      "Historisch zeigten Gaps dieser Größenordnung starken Follow-Through in Gap-Richtung bei moderater Gap-Fill-Quote.";
  } else {
    tone = "mixed";
    verdictLabel = "Gemischt / Bestätigung abwarten";
    verdictSubtitle =
      "Historisch ausgeglichene Verteilung zwischen Gap-Fill und Fortsetzung — Opening-Range und Volumen abwarten.";
  }

  const insights: string[] = [];
  if (direction !== "flat" && n > 0) {
    insights.push(
      `Gap-Close-Chance: In ${gapFillProb.toFixed(1).replace(".", ",")} % von ${n} historischen Tagen (${bandLabel}) wurde das Gap am selben Tag geschlossen (${fullFadeProb.toFixed(1).replace(".", ",")} % drehten komplett über/unter Vortages-Close).`,
    );
    insights.push(
      `Intraday-Follow-Through: ${continuationProb.toFixed(1).replace(".", ",")} % schlossen in Gap-Richtung (Ø Open→Close ${formatSignedDe(gapStats.avgOpenToClosePct)}, ${gapToAtrRatio.toFixed(2).replace(".", ",")}× ATR14).`,
    );
  } else {
    insights.push(
      `Historische Basis: ${dataset.observations.length} Handelstage (${dataset.firstSession} bis ${dataset.lastSession}), Ø ATR14 liegt bei ${dataset.currentAtr14Pct.toFixed(2).replace(".", ",")} %.`,
    );
  }
  if (streakPrimary.sampleSize > 0) {
    insights.push(
      `${streakPrimary.label}: Historisch ${streakPrimary.greenCloseProb.toFixed(1).replace(".", ",")} % grüner Close vs. ${streakPrimary.redCloseProb.toFixed(1).replace(".", ",")} % roter Close am Folgetag (n = ${streakPrimary.sampleSize}, Ø ${formatSignedDe(streakPrimary.avgNextDayPct)}).`,
    );
  } else {
    insights.push(
      `${streakPrimary.label}: Im gewählten Zeitraum trat diese Extrem-Serie 0-mal auf — erweitere den Zeitraum auf 15J oder reduziere die Serienlänge.`,
    );
  }

  // Gap bucket matrix
  const gapBuckets: GapBucketRow[] = GAP_BUCKETS.map((b) => {
    const rows = dataset.observations.filter((o) => o.gapPct >= b.min && o.gapPct < b.max);
    const count = rows.length;
    return {
      id: b.id,
      label: b.label,
      min: b.min,
      max: b.max,
      sampleSize: count,
      gapFillProb: pct(rows.filter((o) => o.gapFilled).length, count),
      fullFadeProb: pct(rows.filter((o) => o.fullFade).length, count),
      greenIntradayProb: pct(rows.filter((o) => o.greenIntraday).length, count),
      greenDayProb: pct(rows.filter((o) => o.greenDay).length, count),
      avgOpenToClosePct: round2(mean(rows.map((o) => o.openToClosePct))),
      active: gapPct >= b.min && gapPct < b.max,
    };
  });

  // Streak matrices: 1..6 exact + 7+ cumulative (for both red and green)
  const buildMatrix = (dir: "red" | "green"): StreakStats[] => [
    ...[1, 2, 3, 4, 5, 6].map((d) => summarizeStreak(dataset.observations, dir, d, "exact", streakBasis)),
    summarizeStreak(dataset.observations, dir, 7, "atLeast", streakBasis),
  ];

  // Weekday statistics (Mon–Fri)
  const weekdays: WeekdayStat[] = [1, 2, 3, 4, 5].map((wd) => {
    const rows = dataset.observations.filter((o) => o.weekday === wd);
    const count = rows.length;
    return {
      weekday: wd,
      label: WEEKDAY_LABELS[wd],
      sampleSize: count,
      greenDayProb: pct(rows.filter((o) => o.greenDay).length, count),
      avgReturnPct: round2(mean(rows.map((o) => o.closeToClosePct))),
      avgGapPct: round2(mean(rows.map((o) => o.gapPct))),
    };
  });

  // Recent historical analogues (most recent 10 days from matched gap cohort)
  const analogues: HistoricalAnalogue[] = matched
    .slice(-10)
    .reverse()
    .map((o) => ({
      session: o.session,
      gapPct: round2(o.gapPct),
      openToClosePct: round2(o.openToClosePct),
      closeToClosePct: round2(o.closeToClosePct),
      gapFilled: o.gapFilled,
      fullFade: o.fullFade,
      priorStreak: streakValueOf(o, streakBasis),
    }));

  return {
    score,
    tone,
    verdictLabel,
    verdictSubtitle,
    streakBasis,
    insights,
    gapStats,
    streakExact,
    streakAtLeast,
    streakPrimary,
    combo,
    gapBuckets,
    redStreaks: buildMatrix("red"),
    greenStreaks: buildMatrix("green"),
    weekdays,
    analogues,
  };
}

function weightedQuantile(
  pairs: ReadonlyArray<{ value: number; weight: number }>,
  q: number,
): number {
  if (!pairs.length) return 0;
  const targetQ = clamp(q, 0, 1);
  let totalW = 0;
  for (const p of pairs) totalW += p.weight;
  if (!(totalW > 0)) {
    const sortedVals = pairs.map((p) => p.value).sort((a, b) => a - b);
    const idx = Math.min(
      sortedVals.length - 1,
      Math.max(0, Math.floor(targetQ * (sortedVals.length - 1))),
    );
    return sortedVals[idx];
  }
  const sorted = [...pairs].sort((a, b) => a.value - b.value);
  const threshold = totalW * targetQ;
  let acc = 0;
  for (const p of sorted) {
    acc += p.weight;
    if (acc >= threshold) return p.value;
  }
  return sorted[sorted.length - 1].value;
}

function weightedMedian(pairs: ReadonlyArray<{ value: number; weight: number }>): number {
  return weightedQuantile(pairs, 0.5);
}

function classifyNextDayScenario(
  priorDir: "red" | "green",
  priorDays: number,
  todayMovePct: number,
  moveAtrRatio: number,
): string {
  if (priorDir === "red" && priorDays >= 3 && (todayMovePct >= 2.5 || moveAtrRatio >= 1.5)) {
    return "Massive Relief-Rally nach Abverkauf";
  }
  if (priorDir === "red" && priorDays >= 2 && todayMovePct >= 0.75) {
    return "Relief-Rally nach roter Serie";
  }
  if (priorDir === "red" && priorDays >= 3 && (todayMovePct <= -2.0 || moveAtrRatio <= -1.3)) {
    return "Kapitulation / Ausverkauf";
  }
  if (priorDir === "red" && todayMovePct <= -0.5) {
    return "Abverkauf-Fortsetzung";
  }
  if (priorDir === "green" && priorDays >= 3 && (todayMovePct <= -2.0 || moveAtrRatio <= -1.3)) {
    return "Scharfer Rücksetzer nach Rally";
  }
  if (priorDir === "green" && priorDays >= 2 && todayMovePct <= -0.75) {
    return "Rücksetzer nach grüner Serie";
  }
  if (priorDir === "green" && (todayMovePct >= 2.0 || moveAtrRatio >= 1.3)) {
    return "Blow-Off / Momentum-Spitze";
  }
  if (priorDir === "green" && todayMovePct >= 0.5) {
    return "Momentum-Fortsetzung";
  }
  return "Seitwärts / Konsolidierung";
}

function summarizeNextDayFactor(
  id: string,
  label: string,
  condition: string,
  rows: readonly NoiseObservation[],
  baseGreenProb: number,
): NextDayFactor {
  const n = rows.length;
  if (n === 0) {
    return {
      id,
      label,
      condition,
      greenProb: baseGreenProb,
      redProb: round1(100 - baseGreenProb),
      edgeVsBasePct: 0,
      sampleSize: 0,
      avgNextDayPct: 0,
      stance: "neutral",
    };
  }
  const greenCount = rows.filter((o) => o.nextDayGreen === true).length;
  const greenProb = pct(greenCount, n);
  const redProb = round1(100 - greenProb);
  const edgeVsBasePct = round1(greenProb - baseGreenProb);
  const avgNextDayPct = round2(
    mean(rows.map((o) => o.nextDayCloseToClosePct ?? 0)),
  );
  const stance: NextDayFactor["stance"] =
    n >= 8 && edgeVsBasePct >= 3
      ? "bullish"
      : n >= 8 && edgeVsBasePct <= -3
        ? "bearish"
        : "neutral";

  return {
    id,
    label,
    condition,
    greenProb,
    redProb,
    edgeVsBasePct,
    sampleSize: n,
    avgNextDayPct,
    stance,
  };
}

/**
 * Evaluates the empirical probability that TOMORROW (T+1) closes green vs. red
 * given the exact sequence `[prior N red/green days] + [today's move %]` and
 * optional causal technical context (Wilder RSI(14), ATR-normalized stretch,
 * 20-EMA distance, 200-SMA trend regime).
 */
export function evaluateNextDayForecast(
  dataset: NoiseDataset,
  input: NextDayForecastInput,
): NextDayForecast {
  const priorStreakDays = Math.max(1, Math.min(12, Math.round(input.priorStreakDays || 1)));
  const priorStreakDirection: "red" | "green" =
    input.priorStreakDirection === "red" ? "red" : "green";
  const streakBasis: NoiseStreakBasis = input.streakBasis === "candle" ? "candle" : "close";
  const todayMovePct = Number.isFinite(input.todayMovePct)
    ? clamp(round2(input.todayMovePct), -25, 25)
    : 0;
  const useExtraFactors = input.useExtraFactors !== false;

  // Dynamically project today's causal technical state given `todayMovePct`
  const baseClose = dataset.lastClose > 0 ? dataset.lastClose : 100;
  const projectedClose = baseClose * (1 + todayMovePct / 100);
  const delta = projectedClose - baseClose;
  const gain = delta > 0 ? delta : 0;
  const loss = delta < 0 ? -delta : 0;
  const nextAvgGain = (dataset.lastAvgGain14 * 13 + gain) / 14;
  const nextAvgLoss = (dataset.lastAvgLoss14 * 13 + loss) / 14;
  const projectedRsi14 =
    nextAvgGain === 0 && nextAvgLoss === 0
      ? dataset.currentRsi14
      : nextAvgLoss === 0
        ? 100
        : round1(100 - 100 / (1 + nextAvgGain / nextAvgLoss));

  const atrBase = Math.max(0.25, dataset.currentAtr14Pct || 1.0);
  const projectedMoveAtrRatio = round2(todayMovePct / atrBase);

  const emaAlpha = 2 / (20 + 1);
  const projectedEma20 =
    dataset.currentEma20 > 0
      ? projectedClose * emaAlpha + dataset.currentEma20 * (1 - emaAlpha)
      : projectedClose;
  const projectedDistEma20Pct =
    projectedEma20 > 0 ? round2(((projectedClose - projectedEma20) / projectedEma20) * 100) : 0;
  const projectedAboveSma200 =
    dataset.currentSma200 !== null ? projectedClose >= dataset.currentSma200 : null;

  const scenarioLabel = classifyNextDayScenario(
    priorStreakDirection,
    priorStreakDays,
    todayMovePct,
    projectedMoveAtrRatio,
  );

  const eligible = dataset.observations.filter(
    (o) => o.nextDayGreen !== null && o.nextDayCloseToClosePct !== null,
  );

  const baseGreenProb = eligible.length
    ? pct(eligible.filter((o) => o.nextDayGreen === true).length, eligible.length)
    : dataset.baseGreenProb;
  const baseRate = baseGreenProb / 100;
  const baseCandleRate = eligible.length
    ? eligible.filter((o) => o.nextDayGreenCandle === true).length / eligible.length
    : 0.5;

  if (eligible.length === 0) {
    const fallbackAbs = round2(atrBase * 0.65);
    const fallbackRange = round2(atrBase * 0.9);
    const fallbackTr = round2(atrBase);
    return {
      greenProb: baseGreenProb,
      redProb: round1(100 - baseGreenProb),
      greenCandleProb: round1(baseCandleRate * 100),
      baseGreenProb,
      edgeVsBasePct: 0,
      avgNextDayPct: 0,
      medianNextDayPct: 0,
      fwd3dWinRate: null,
      fwd3dAvgPct: null,
      fwd5dWinRate: null,
      fwd5dAvgPct: null,
      effectiveSampleSize: 0,
      confidence: "gering",
      scenarioLabel,
      summary: "Zu wenige historische Handelstage für eine T+1-Auswertung.",
      useExtraFactors,
      expectedVolatility: {
        expectedAbsMovePct: fallbackAbs,
        expectedRangePct: fallbackRange,
        expectedTrueRangePct: fallbackTr,
        expectedRangeP80Pct: round2(atrBase * 1.3),
        volRatioVsAtr: 1,
        regime: "normal",
        regimeTone: "normal",
        projectedPrice: round2(projectedClose),
        expectedPriceLow: round2(Math.max(0.01, projectedClose * (1 - fallbackAbs / 100))),
        expectedPriceHigh: round2(projectedClose * (1 + fallbackAbs / 100)),
        probMoveOver1Pct: 0,
        probMoveOver2Pct: 0,
        probMoveOver3Pct: 0,
        historicalMedianAbsMovePct: fallbackAbs,
        historicalMedianRangePct: fallbackRange,
      },
      projected: {
        todayMovePct,
        rsi14: projectedRsi14,
        moveAtrRatio: projectedMoveAtrRatio,
        distEma20Pct: projectedDistEma20Pct,
        aboveSma200: projectedAboveSma200,
      },
      sequenceCohort: {
        label: "Keine Stichprobe",
        sampleSize: 0,
        greenProb: baseGreenProb,
        redProb: round1(100 - baseGreenProb),
        avgNextDayPct: 0,
        effectiveStreakDays: priorStreakDays,
        usedFallback: true,
      },
      factors: [],
      twins: [],
    };
  }

  // 1. Hard-filtered sequence cohort: [prior >= k red/green] + [today's move direction/magnitude]
  const absMove = Math.abs(todayMovePct);
  const moveDir: "up" | "down" | "flat" =
    absMove < 0.35 ? "flat" : todayMovePct > 0 ? "up" : "down";
  const tightThreshold =
    absMove >= 3.0 ? 2.0 : absMove >= 1.5 ? 1.0 : 0.4;

  const matchesStreak = (o: NoiseObservation, minDays: number) => {
    const val = streakValueOf(o, streakBasis);
    return priorStreakDirection === "red" ? val <= -minDays : val >= minDays;
  };
  const matchesMove = (o: NoiseObservation, threshold: number) => {
    if (moveDir === "flat") return Math.abs(o.closeToClosePct) <= 0.75;
    return moveDir === "up"
      ? o.closeToClosePct >= threshold
      : o.closeToClosePct <= -threshold;
  };

  let effectiveStreakDays = priorStreakDays;
  let effectiveThreshold = tightThreshold;
  let usedFallback = false;
  let seqRows = eligible.filter(
    (o) => matchesStreak(o, effectiveStreakDays) && matchesMove(o, effectiveThreshold),
  );

  const minStreakFloor = priorStreakDays === 1 ? 1 : 2;
  while (effectiveStreakDays > minStreakFloor && seqRows.length < 8) {
    effectiveStreakDays -= 1;
    usedFallback = true;
    seqRows = eligible.filter(
      (o) => matchesStreak(o, effectiveStreakDays) && matchesMove(o, effectiveThreshold),
    );
  }
  if (moveDir !== "flat" && seqRows.length < 8 && effectiveThreshold > 0.4) {
    effectiveThreshold = 0.4;
    usedFallback = true;
    seqRows = eligible.filter(
      (o) => matchesStreak(o, effectiveStreakDays) && matchesMove(o, effectiveThreshold),
    );
  }
  if (seqRows.length < 5) {
    usedFallback = true;
    seqRows = eligible.filter((o) => matchesStreak(o, effectiveStreakDays));
  }

  const basisPlural = streakBasis === "candle" ? "Kerzen" : "Tage";
  const dirAdj = priorStreakDirection === "red" ? "rote" : "grüne";
  const moveDesc =
    moveDir === "flat"
      ? "flacher Tag (±0,75 %)"
      : moveDir === "up"
        ? `heute ≥ +${effectiveThreshold.toFixed(1).replace(".", ",")} %`
        : `heute ≤ −${effectiveThreshold.toFixed(1).replace(".", ",")} %`;
  const seqLabel = `≥ ${effectiveStreakDays} ${dirAdj} ${basisPlural} + ${moveDesc}`;
  const seqGreenProb = seqRows.length
    ? pct(seqRows.filter((o) => o.nextDayGreen === true).length, seqRows.length)
    : baseGreenProb;

  const sequenceCohort = {
    label: seqLabel,
    sampleSize: seqRows.length,
    greenProb: seqGreenProb,
    redProb: round1(100 - seqGreenProb),
    avgNextDayPct: round2(mean(seqRows.map((o) => o.nextDayCloseToClosePct ?? 0))),
    effectiveStreakDays,
    usedFallback,
  };

  // 2. Multi-factor Gaussian kernel similarity across all eligible historical days
  const targetSignedStreak =
    priorStreakDirection === "red" ? -priorStreakDays : priorStreakDays;
  const tgtStreakCapped = clamp(targetSignedStreak, -8, 8);
  const tgtMoveAtr = clamp(projectedMoveAtrRatio, -5, 5);
  const tgtEmaDist = clamp(projectedDistEma20Pct, -25, 25);

  let sumW = 0;
  let sumW2 = 0;
  let sumGreenW = 0;
  let sumCandleW = 0;
  let sumRetW = 0;
  let sum3dW = 0;
  let sum3dRetW = 0;
  let sum3dWinW = 0;
  let sum5dW = 0;
  let sum5dRetW = 0;
  let sum5dWinW = 0;

  // Regime-scaled next-day volatility accumulators (weighted + dataset empirical prior)
  let sumScaledAbsW = 0;
  let sumScaledRangeW = 0;
  let sumScaledTrW = 0;
  let sumP1W = 0;
  let sumP2W = 0;
  let sumP3W = 0;

  let baseSumScaledAbs = 0;
  let baseSumScaledRange = 0;
  let baseSumScaledTr = 0;
  let baseCountP1 = 0;
  let baseCountP2 = 0;
  let baseCountP3 = 0;

  const scored: Array<{ obs: NoiseObservation; weight: number }> = [];
  const retPairs: Array<{ value: number; weight: number }> = [];
  const scaledRangePairs: Array<{ value: number; weight: number }> = [];
  const baseScaledRangePairs: Array<{ value: number; weight: number }> = [];
  const rawAbsPairs: Array<{ value: number; weight: number }> = [];
  const rawRangePairs: Array<{ value: number; weight: number }> = [];

  for (const o of eligible) {
    const obsStreak = streakValueOf(o, streakBasis);
    const dStreak = (clamp(obsStreak, -8, 8) - tgtStreakCapped) / 1.8;
    const oppositeStreak = obsStreak * targetSignedStreak <= 0;
    const dDirStreak = oppositeStreak ? 1.15 : 0;

    const obsMoveAtr = clamp(o.moveAtrRatio, -5, 5);
    const dMove = (obsMoveAtr - tgtMoveAtr) / 0.85;
    const oppositeMove = absMove >= 0.4 && o.closeToClosePct * todayMovePct <= 0;
    const dDirMove = oppositeMove ? 1.25 : 0;

    let dist2 =
      dStreak * dStreak +
      dDirStreak * dDirStreak +
      dMove * dMove +
      dDirMove * dDirMove;

    if (useExtraFactors) {
      const dRsi = (o.rsi14 - projectedRsi14) / 12.0;
      const dEma = (clamp(o.distEma20Pct, -25, 25) - tgtEmaDist) / 4.5;
      dist2 += 0.75 * dRsi * dRsi + 0.5 * dEma * dEma;
      if (
        o.aboveSma200 !== null &&
        projectedAboveSma200 !== null &&
        o.aboveSma200 !== projectedAboveSma200
      ) {
        dist2 += 0.65;
      }
    }

    const weight = Math.exp(-0.5 * dist2);
    scored.push({ obs: o, weight });

    const nextRet = o.nextDayCloseToClosePct!;
    const obsAbs = o.nextDayAbsMovePct ?? Math.abs(nextRet);
    const obsRange = o.nextDayRangePct ?? obsAbs;
    const obsTr = o.nextDayTrueRangePct ?? Math.max(obsRange, obsAbs);
    const obsAtr = Math.max(0.25, o.atr14Pct || atrBase);

    // Express historical T+1 realized volatility as ATR multiples, then scale to today's live ATR regime
    const scaledAbs = clamp(obsAbs / obsAtr, 0, 6) * atrBase;
    const scaledRange = clamp(obsRange / obsAtr, 0, 8) * atrBase;
    const scaledTr = clamp(obsTr / obsAtr, 0, 8) * atrBase;

    sumW += weight;
    sumW2 += weight * weight;
    if (o.nextDayGreen) sumGreenW += weight;
    if (o.nextDayGreenCandle) sumCandleW += weight;
    sumRetW += weight * nextRet;
    retPairs.push({ value: nextRet, weight });

    sumScaledAbsW += weight * scaledAbs;
    sumScaledRangeW += weight * scaledRange;
    sumScaledTrW += weight * scaledTr;
    if (scaledAbs >= 1.0) sumP1W += weight;
    if (scaledAbs >= 2.0) sumP2W += weight;
    if (scaledAbs >= 3.0) sumP3W += weight;

    baseSumScaledAbs += scaledAbs;
    baseSumScaledRange += scaledRange;
    baseSumScaledTr += scaledTr;
    if (scaledAbs >= 1.0) baseCountP1 += 1;
    if (scaledAbs >= 2.0) baseCountP2 += 1;
    if (scaledAbs >= 3.0) baseCountP3 += 1;

    scaledRangePairs.push({ value: scaledRange, weight });
    baseScaledRangePairs.push({ value: scaledRange, weight: 1 });
    rawAbsPairs.push({ value: obsAbs, weight });
    rawRangePairs.push({ value: obsRange, weight });

    if (o.fwd3dPct !== null) {
      sum3dW += weight;
      sum3dRetW += weight * o.fwd3dPct;
      if (o.fwd3dPct > 0) sum3dWinW += weight;
    }
    if (o.fwd5dPct !== null) {
      sum5dW += weight;
      sum5dRetW += weight * o.fwd5dPct;
      if (o.fwd5dPct > 0) sum5dWinW += weight;
    }
  }

  // Kish effective sample size + Empirical Bayes shrinkage toward historical base rate
  const nEff = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;
  const priorWeight = 4;
  const rawGreenRate = sumW > 0 ? sumGreenW / sumW : baseRate;
  const rawCandleRate = sumW > 0 ? sumCandleW / sumW : baseCandleRate;

  const shrunkGreen = (nEff * rawGreenRate + priorWeight * baseRate) / (nEff + priorWeight);
  const shrunkCandle =
    (nEff * rawCandleRate + priorWeight * baseCandleRate) / (nEff + priorWeight);

  const greenProb = round1(clamp(shrunkGreen * 100, 0, 100));
  const redProb = round1(100 - greenProb);
  const greenCandleProb = round1(clamp(shrunkCandle * 100, 0, 100));
  const edgeVsBasePct = round1(greenProb - baseGreenProb);
  const avgNextDayPct = sumW > 0 ? round2(sumRetW / sumW) : 0;
  const medianNextDayPct = round2(weightedMedian(retPairs));

  // Empirical Bayes shrunk expected next-day volatility in today's ATR regime
  const nEligible = eligible.length;
  const baseAbsPct = baseSumScaledAbs / nEligible;
  const baseRangePct = baseSumScaledRange / nEligible;
  const baseTrPct = baseSumScaledTr / nEligible;
  const baseP1 = baseCountP1 / nEligible;
  const baseP2 = baseCountP2 / nEligible;
  const baseP3 = baseCountP3 / nEligible;

  const rawAbsPct = sumW > 0 ? sumScaledAbsW / sumW : baseAbsPct;
  const rawRangePct = sumW > 0 ? sumScaledRangeW / sumW : baseRangePct;
  const rawTrPct = sumW > 0 ? sumScaledTrW / sumW : baseTrPct;
  const rawP1 = sumW > 0 ? sumP1W / sumW : baseP1;
  const rawP2 = sumW > 0 ? sumP2W / sumW : baseP2;
  const rawP3 = sumW > 0 ? sumP3W / sumW : baseP3;

  const shrinkVal = (val: number, prior: number) =>
    (nEff * val + priorWeight * prior) / (nEff + priorWeight);

  const expectedAbsMovePct = round2(Math.max(0.05, shrinkVal(rawAbsPct, baseAbsPct)));
  const expectedRangePct = round2(Math.max(0.05, shrinkVal(rawRangePct, baseRangePct)));
  const expectedTrueRangePct = round2(
    Math.max(expectedAbsMovePct, expectedRangePct, shrinkVal(rawTrPct, baseTrPct)),
  );

  const rawRangeP80 = weightedQuantile(scaledRangePairs, 0.8);
  const baseRangeP80 = weightedQuantile(baseScaledRangePairs, 0.8);
  const expectedRangeP80Pct = round2(
    Math.max(expectedRangePct, shrinkVal(rawRangeP80, baseRangeP80)),
  );

  const probMoveOver1Pct = round1(clamp(shrinkVal(rawP1, baseP1) * 100, 0, 100));
  const probMoveOver2Pct = round1(clamp(shrinkVal(rawP2, baseP2) * 100, 0, probMoveOver1Pct));
  const probMoveOver3Pct = round1(clamp(shrinkVal(rawP3, baseP3) * 100, 0, probMoveOver2Pct));

  const volRatioVsAtr = round2(expectedTrueRangePct / atrBase);
  const regime: NextDayVolatility["regime"] =
    volRatioVsAtr >= 1.25
      ? "stark erhöht"
      : volRatioVsAtr >= 1.08
        ? "erhöht"
        : volRatioVsAtr <= 0.85
          ? "beruhigt"
          : "normal";
  const regimeTone: NextDayVolatility["regimeTone"] =
    volRatioVsAtr >= 1.25
      ? "high"
      : volRatioVsAtr >= 1.08
        ? "elevated"
        : volRatioVsAtr <= 0.85
          ? "calm"
          : "normal";

  const expectedVolatility: NextDayVolatility = {
    expectedAbsMovePct,
    expectedRangePct,
    expectedTrueRangePct,
    expectedRangeP80Pct,
    volRatioVsAtr,
    regime,
    regimeTone,
    projectedPrice: round2(projectedClose),
    expectedPriceLow: round2(Math.max(0.01, projectedClose * (1 - expectedAbsMovePct / 100))),
    expectedPriceHigh: round2(projectedClose * (1 + expectedAbsMovePct / 100)),
    probMoveOver1Pct,
    probMoveOver2Pct,
    probMoveOver3Pct,
    historicalMedianAbsMovePct: round2(weightedMedian(rawAbsPairs)),
    historicalMedianRangePct: round2(weightedMedian(rawRangePairs)),
  };

  const fwd3dWinRate = sum3dW > 0 ? round1((sum3dWinW / sum3dW) * 100) : null;
  const fwd3dAvgPct = sum3dW > 0 ? round2(sum3dRetW / sum3dW) : null;
  const fwd5dWinRate = sum5dW > 0 ? round1((sum5dWinW / sum5dW) * 100) : null;
  const fwd5dAvgPct = sum5dW > 0 ? round2(sum5dRetW / sum5dW) : null;

  const confidence: NextDayForecast["confidence"] =
    nEff >= 25 ? "hoch" : nEff >= 10 ? "mittel" : "gering";

  // 3. Four standalone empirical factors
  const factorSequence = summarizeNextDayFactor(
    "sequence",
    "Serie + Tages-Move",
    seqLabel,
    seqRows,
    baseGreenProb,
  );

  let rsiCond: string;
  let rsiRows: NoiseObservation[];
  if (projectedRsi14 < 30) {
    rsiCond = "Überverkauft (RSI < 30)";
    rsiRows = eligible.filter((o) => o.rsi14 < 30);
  } else if (projectedRsi14 < 40) {
    rsiCond = "Erholungszone (RSI 30–40)";
    rsiRows = eligible.filter((o) => o.rsi14 >= 30 && o.rsi14 < 40);
  } else if (projectedRsi14 < 55) {
    rsiCond = "Neutral-Unterkante (RSI 40–55)";
    rsiRows = eligible.filter((o) => o.rsi14 >= 40 && o.rsi14 < 55);
  } else if (projectedRsi14 <= 70) {
    rsiCond = "Konstruktiv (RSI 55–70)";
    rsiRows = eligible.filter((o) => o.rsi14 >= 55 && o.rsi14 <= 70);
  } else {
    rsiCond = "Überkauft (RSI > 70)";
    rsiRows = eligible.filter((o) => o.rsi14 > 70);
  }
  const factorRsi = summarizeNextDayFactor(
    "rsi",
    "RSI(14)-Regime",
    rsiCond,
    rsiRows,
    baseGreenProb,
  );

  let atrCond: string;
  let atrRows: NoiseObservation[];
  if (projectedMoveAtrRatio >= 1.5) {
    atrCond = "Starker Ausbruch (≥ +1,5× ATR)";
    atrRows = eligible.filter((o) => o.moveAtrRatio >= 1.5);
  } else if (projectedMoveAtrRatio >= 0.6) {
    atrCond = "Grüner Impuls (+0,6 bis +1,5× ATR)";
    atrRows = eligible.filter((o) => o.moveAtrRatio >= 0.6 && o.moveAtrRatio < 1.5);
  } else if (projectedMoveAtrRatio > -0.6) {
    atrCond = "Normale Range (±0,6× ATR)";
    atrRows = eligible.filter((o) => o.moveAtrRatio > -0.6 && o.moveAtrRatio < 0.6);
  } else if (projectedMoveAtrRatio > -1.5) {
    atrCond = "Abwärtsdruck (−0,6 bis −1,5× ATR)";
    atrRows = eligible.filter((o) => o.moveAtrRatio <= -0.6 && o.moveAtrRatio > -1.5);
  } else {
    atrCond = "Extremer Selloff (≤ −1,5× ATR)";
    atrRows = eligible.filter((o) => o.moveAtrRatio <= -1.5);
  }
  const factorAtr = summarizeNextDayFactor(
    "move-atr",
    "Tages-Move × ATR14",
    atrCond,
    atrRows,
    baseGreenProb,
  );

  let trendCond: string;
  let trendRows: NoiseObservation[];
  const emaBucket =
    projectedDistEma20Pct <= -3 ? "below" : projectedDistEma20Pct >= 3 ? "above" : "near";
  const emaBucketLabel =
    emaBucket === "below"
      ? "unter 20-EMA (≤ −3 %)"
      : emaBucket === "above"
        ? "über 20-EMA (≥ +3 %)"
        : "nahe 20-EMA";
  if (projectedAboveSma200 !== null) {
    const smaLabel = projectedAboveSma200 ? "Über 200-SMA" : "Unter 200-SMA";
    const combined = eligible.filter(
      (o) =>
        o.aboveSma200 === projectedAboveSma200 &&
        (emaBucket === "below"
          ? o.distEma20Pct <= -3
          : emaBucket === "above"
            ? o.distEma20Pct >= 3
            : o.distEma20Pct > -3 && o.distEma20Pct < 3),
    );
    if (combined.length >= 10) {
      trendCond = `${smaLabel} · ${emaBucketLabel}`;
      trendRows = combined;
    } else {
      trendCond = smaLabel;
      trendRows = eligible.filter((o) => o.aboveSma200 === projectedAboveSma200);
    }
  } else {
    trendCond = projectedDistEma20Pct >= 0 ? "Über 20-EMA" : "Unter 20-EMA";
    trendRows = eligible.filter((o) =>
      projectedDistEma20Pct >= 0 ? o.distEma20Pct >= 0 : o.distEma20Pct < 0,
    );
  }
  const factorTrend = summarizeNextDayFactor(
    "trend",
    "Trend & 20-EMA Stretch",
    trendCond,
    trendRows,
    baseGreenProb,
  );

  // 4. Top 6 closest historical twin days
  scored.sort((a, b) =>
    b.weight !== a.weight
      ? b.weight - a.weight
      : b.obs.session.localeCompare(a.obs.session),
  );
  const twins: NextDayTwin[] = scored.slice(0, 6).map(({ obs, weight }) => ({
    session: obs.session,
    priorStreak: streakValueOf(obs, streakBasis),
    dayMovePct: round2(obs.closeToClosePct),
    rsi14: obs.rsi14,
    nextDayPct: round2(obs.nextDayCloseToClosePct!),
    nextDayGreen: obs.nextDayGreen!,
    similarityPct: round1(clamp(weight * 100, 0, 100)),
  }));

  const edgeText =
    edgeVsBasePct > 0
      ? `+${edgeVsBasePct.toFixed(1).replace(".", ",")} Pp. über`
      : edgeVsBasePct < 0
        ? `${Math.abs(edgeVsBasePct).toFixed(1).replace(".", ",")} Pp. unter`
        : "auf Niveau der";
  const streakLabelShort = `${priorStreakDays} ${priorStreakDirection === "red" ? "roten" : "grünen"} ${streakBasis === "candle" ? "Kerzen" : "Tagen"}`;
  const summary = `Nach ${streakLabelShort} + ${formatSignedDe(todayMovePct)} heute schloss der nächste Handelstag (T+1) historisch zu ${greenProb.toFixed(1).replace(".", ",")} % grün und zu ${redProb.toFixed(1).replace(".", ",")} % rot (${edgeText} Basisrate ${baseGreenProb.toFixed(1).replace(".", ",")} % · Ø T+1 ${formatSignedDe(avgNextDayPct)}).`;

  return {
    greenProb,
    redProb,
    greenCandleProb,
    baseGreenProb,
    edgeVsBasePct,
    avgNextDayPct,
    medianNextDayPct,
    fwd3dWinRate,
    fwd3dAvgPct,
    fwd5dWinRate,
    fwd5dAvgPct,
    effectiveSampleSize: round1(nEff),
    confidence,
    scenarioLabel,
    summary,
    useExtraFactors,
    expectedVolatility,
    projected: {
      todayMovePct,
      rsi14: projectedRsi14,
      moveAtrRatio: projectedMoveAtrRatio,
      distEma20Pct: projectedDistEma20Pct,
      aboveSma200: projectedAboveSma200,
    },
    sequenceCohort,
    factors: [factorSequence, factorRsi, factorAtr, factorTrend],
    twins,
  };
}

function snapShockThreshold(pctVal: number): number | null {
  const abs = Math.abs(pctVal);
  if (abs < 1.0) return null;
  const sign = pctVal < 0 ? -1 : 1;
  if (abs >= 5.0) return sign * 5.0;
  if (abs >= 4.0) return sign * 4.0;
  if (abs >= 3.0) return sign * 3.0;
  if (abs >= 2.0) return sign * 2.0;
  if (abs >= 1.5) return sign * 1.5;
  return sign * 1.0;
}

/**
 * Derives a clean OddStats-style two-day shock pattern from the ticker's latest
 * two trading days (e.g. yesterday -5.67% + today +7.00% -> prev <= -5.0%, day0 >= +5.0%).
 */
export function suggestLivePattern(
  dataset: NoiseDataset,
  liveTodayReturnPct?: number | null,
): { prevDayRule: ReturnRule; day0Rule: ReturnRule; usedLiveToday: boolean } {
  const snappedLive =
    typeof liveTodayReturnPct === "number" && Number.isFinite(liveTodayReturnPct)
      ? snapShockThreshold(liveTodayReturnPct)
      : null;

  if (snappedLive !== null) {
    const snappedPrev = dataset.lastDayReturnPct !== null ? snapShockThreshold(dataset.lastDayReturnPct) : null;
    return {
      prevDayRule:
        snappedPrev !== null
          ? { op: snappedPrev < 0 ? "lte" : "gte", thresholdPct: snappedPrev }
          : { op: "any", thresholdPct: -3.0 },
      day0Rule: { op: snappedLive < 0 ? "lte" : "gte", thresholdPct: snappedLive },
      usedLiveToday: true,
    };
  }

  const snappedCompletedPrev =
    dataset.prevDayReturnPct !== null ? snapShockThreshold(dataset.prevDayReturnPct) : null;
  const snappedCompletedDay0 =
    dataset.lastDayReturnPct !== null ? snapShockThreshold(dataset.lastDayReturnPct) : null;

  if (snappedCompletedPrev !== null && snappedCompletedDay0 !== null) {
    return {
      prevDayRule: { op: snappedCompletedPrev < 0 ? "lte" : "gte", thresholdPct: snappedCompletedPrev },
      day0Rule: { op: snappedCompletedDay0 < 0 ? "lte" : "gte", thresholdPct: snappedCompletedDay0 },
      usedLiveToday: false,
    };
  }
  if (snappedCompletedDay0 !== null) {
    return {
      prevDayRule: { op: "any", thresholdPct: -3.0 },
      day0Rule: { op: snappedCompletedDay0 < 0 ? "lte" : "gte", thresholdPct: snappedCompletedDay0 },
      usedLiveToday: false,
    };
  }
  return {
    prevDayRule: { op: "lte", thresholdPct: -5.0 },
    day0Rule: { op: "gte", thresholdPct: 5.0 },
    usedLiveToday: false,
  };
}

function matchesReturnRule(value: number | null, rule: ReturnRule): boolean {
  if (rule.op === "any") return true;
  if (value === null || !Number.isFinite(value)) return false;
  if (rule.op === "lte") return value <= rule.thresholdPct;
  return value >= rule.thresholdPct;
}

function formatRulePct(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = Math.abs(value);
  const decimals = Math.abs(abs * 10 - Math.round(abs * 10)) > 1e-4 ? 2 : 1;
  return `${sign}${abs.toFixed(decimals).replace(".", ",")} %`;
}

function describeReturnRule(rule: ReturnRule): string {
  if (rule.op === "any") return "beliebig";
  const sym = rule.op === "lte" ? "≤" : "≥";
  return `${sym} ${formatRulePct(rule.thresholdPct)}`;
}

function summarizeHorizon(
  id: PatternHorizonStat["id"],
  label: string,
  values: readonly number[],
): PatternHorizonStat {
  const n = values.length;
  if (!n) {
    return { id, label, sampleSize: 0, winRate: 0, avgPct: 0, medianPct: 0, bestPct: 0, worstPct: 0 };
  }
  let best = values[0];
  let worst = values[0];
  let wins = 0;
  for (const v of values) {
    if (v > 0) wins++;
    if (v > best) best = v;
    if (v < worst) worst = v;
  }
  return {
    id,
    label,
    sampleSize: n,
    winRate: pct(wins, n),
    avgPct: round2(mean(values)),
    medianPct: round2(median(values)),
    bestPct: round2(best),
    worstPct: round2(worst),
  };
}

function priorWindowValueOf(o: NoiseObservation, days: PriorWindowDays): number | null {
  switch (days) {
    case 3:
      return o.prior3dPct;
    case 5:
      return o.prior5dPct;
    case 7:
      return o.prior7dPct;
    case 10:
      return o.prior10dPct;
    case 20:
      return o.prior20dPct;
  }
}

/**
 * OddStats-style Historical Pattern & Regime Scanner:
 * Finds every historical occurrence of a 1-day to 5-day shock sequence
 * (Tag -4 -> Tag -3 -> Tag -2 -> Tag -1 -> Tag 0) and/or cumulative prior-window move
 * (3T/5T/7T/10T/20T before Tag 0), quantifies bear-market incidence, further drop before
 * hitting bottom (min/median/worst & days to bottom), T+1 volatility, and forward returns.
 */
export function evaluatePatternStudy(
  dataset: NoiseDataset,
  input: PatternStudyInput,
): PatternStudyResult {
  const ticker = (input.ticker || "Dieser Ticker").trim();
  const normRule = (rule?: ReturnRule): ReturnRule => ({
    op: rule?.op ?? "any",
    thresholdPct: clamp(round2(rule?.thresholdPct || 0), -40, 40),
  });
  const dayMinus4Rule = normRule(input.dayMinus4Rule);
  const dayMinus3Rule = normRule(input.dayMinus3Rule);
  const dayMinus2Rule = normRule(input.dayMinus2Rule);
  const prevRule = normRule(input.prevDayRule);
  const day0Rule = normRule(input.day0Rule);
  const priorWinDays: PriorWindowDays = input.priorWindowRule?.days ?? 5;
  const priorWinRule: ReturnRule = {
    op: input.priorWindowRule?.op ?? "any",
    thresholdPct: clamp(round2(input.priorWindowRule?.thresholdPct || 0), -80, 100),
  };
  const regimeFilter = input.regimeFilter ?? "all";
  const minGapDays =
    typeof input.minGapDays === "number" && Number.isFinite(input.minGapDays) && input.minGapDays > 0
      ? Math.min(252, Math.round(input.minGapDays))
      : 0;

  const firstYear = dataset.firstSession ? dataset.firstSession.slice(0, 4) : "—";
  const lastYear = dataset.lastSession ? dataset.lastSession.slice(0, 4) : "—";

  const rawMatchedEntries: Array<{ idx: number; obs: NoiseObservation }> = [];
  for (let idx = 0; idx < dataset.observations.length; idx++) {
    const o = dataset.observations[idx];
    if (!matchesReturnRule(priorWindowValueOf(o, priorWinDays), priorWinRule)) continue;
    if (!matchesReturnRule(o.dayMinus4Pct, dayMinus4Rule)) continue;
    if (!matchesReturnRule(o.dayMinus3Pct, dayMinus3Rule)) continue;
    if (!matchesReturnRule(o.dayMinus2Pct, dayMinus2Rule)) continue;
    if (!matchesReturnRule(o.prevDayCloseToClosePct, prevRule)) continue;
    if (!matchesReturnRule(o.closeToClosePct, day0Rule)) continue;
    rawMatchedEntries.push({ idx, obs: o });
  }

  // Optional cluster deduplication: keep independent episodes separated by >= minGapDays trading days
  const dedupedObs: NoiseObservation[] = [];
  if (minGapDays > 0) {
    let lastKeptIdx = -Infinity;
    for (const entry of rawMatchedEntries) {
      if (entry.idx - lastKeptIdx >= minGapDays) {
        dedupedObs.push(entry.obs);
        lastKeptIdx = entry.idx;
      }
    }
  } else {
    for (const entry of rawMatchedEntries) dedupedObs.push(entry.obs);
  }

  // Exact partition across all / bear / bull on the deduplicated pattern pool
  const regimeAllCount = dedupedObs.length;
  const regimeBearCount = dedupedObs.filter((o) => o.inBearCycle).length;
  const regimeCounts = {
    all: regimeAllCount,
    bear: regimeBearCount,
    bull: regimeAllCount - regimeBearCount,
  };

  // Regime filter strictly matches the canonical >=20% bear-cycle classifier (inBearCycle)
  // so Bärenmarkt + Bullenmarkt partition all matches cleanly and align 1:1 with table badges & KPIs.
  const matchesRegime = (o: NoiseObservation) =>
    regimeFilter === "bear" ? o.inBearCycle : regimeFilter === "bull" ? !o.inBearCycle : true;

  const rawSampleSize = rawMatchedEntries.filter((e) => matchesRegime(e.obs)).length;
  const matchedObs = dedupedObs.filter(matchesRegime);

  const n = matchedObs.length;
  const activeRuleParts: string[] = [];
  if (priorWinRule.op !== "any") {
    activeRuleParts.push(`Vor-${priorWinDays}T ${describeReturnRule(priorWinRule)}`);
  }
  if (dayMinus4Rule.op !== "any") activeRuleParts.push(`Tag −4 ${describeReturnRule(dayMinus4Rule)}`);
  if (dayMinus3Rule.op !== "any") activeRuleParts.push(`Tag −3 ${describeReturnRule(dayMinus3Rule)}`);
  if (dayMinus2Rule.op !== "any") activeRuleParts.push(`Tag −2 ${describeReturnRule(dayMinus2Rule)}`);
  if (prevRule.op !== "any") activeRuleParts.push(`Tag −1 ${describeReturnRule(prevRule)}`);
  if (day0Rule.op !== "any") activeRuleParts.push(`Tag 0 ${describeReturnRule(day0Rule)}`);

  const ruleDescription = activeRuleParts.length ? activeRuleParts.join(" → ") : "Alle Handelstage";

  const bearCycleCount = matchedObs.filter((o) => o.inBearCycle).length;
  const bearCycleRate = pct(bearCycleCount, n);
  const withSma = matchedObs.filter((o) => o.aboveSma200 !== null);
  const belowSma200Count = withSma.filter((o) => o.aboveSma200 === false).length;
  const belowSma200Rate = withSma.length ? pct(belowSma200Count, withSma.length) : null;

  const withBottom = matchedObs.filter((o) => o.dropToBottomPct !== null);
  const drops = withBottom.map((o) => o.dropToBottomPct!);
  const droppedFurtherCount = drops.filter((d) => d < -0.5).length;
  const droppedFurtherRate = pct(droppedFurtherCount, withBottom.length);
  const droppedAtLeast5PctRate = pct(drops.filter((d) => d <= -5).length, withBottom.length);
  const droppedAtLeast10PctRate = pct(drops.filter((d) => d <= -10).length, withBottom.length);

  // Since drops are <= 0, Math.max is the shallowest ("at least -X%") and Math.min is the deepest ("worst-case").
  const minFurtherDropPct = drops.length ? round1(Math.max(...drops)) : null;
  const medianFurtherDropPct = drops.length ? round1(median(drops)) : null;
  const worstFurtherDropPct = drops.length ? round1(Math.min(...drops)) : null;

  const daysList = withBottom
    .map((o) => o.daysToBottom)
    .filter((d): d is number => d !== null);
  const medianDaysToBottom = daysList.length ? Math.round(median(daysList)) : null;

  const drops63 = matchedObs
    .map((o) => o.fwdMaxDrop63dPct)
    .filter((d): d is number => d !== null);
  const maxDrop63dMedianPct = drops63.length ? round1(median(drops63)) : null;

  const collect = (fn: (o: NoiseObservation) => number | null): number[] =>
    matchedObs.map(fn).filter((v): v is number => v !== null && Number.isFinite(v));

  const nextAbsVals = collect((o) => o.nextDayAbsMovePct);
  const nextRangeVals = collect((o) => o.nextDayRangePct);
  const nextDayVol = {
    sampleSize: nextAbsVals.length,
    avgAbsMovePct: nextAbsVals.length ? round2(mean(nextAbsVals)) : 0,
    medianAbsMovePct: nextAbsVals.length ? round2(median(nextAbsVals)) : 0,
    avgRangePct: nextRangeVals.length ? round2(mean(nextRangeVals)) : 0,
    medianRangePct: nextRangeVals.length ? round2(median(nextRangeVals)) : 0,
  };

  const horizons: PatternHorizonStat[] = [
    summarizeHorizon("1d", "Morgen (T+1)", collect((o) => o.nextDayCloseToClosePct)),
    summarizeHorizon("5d", "1 Woche (5T)", collect((o) => o.fwd5dPct)),
    summarizeHorizon("21d", "1 Monat (21T)", collect((o) => o.fwd21dPct)),
    summarizeHorizon("63d", "3 Monate (63T)", collect((o) => o.fwd63dPct)),
    summarizeHorizon("126d", "6 Monate (126T)", collect((o) => o.fwd126dPct)),
    summarizeHorizon("252d", "1 Jahr (252T)", collect((o) => o.fwd252dPct)),
  ];

  const hasExtendedRules =
    priorWinRule.op !== "any" ||
    dayMinus4Rule.op !== "any" ||
    dayMinus3Rule.op !== "any" ||
    dayMinus2Rule.op !== "any";

  const regimeClause =
    regimeFilter === "bear"
      ? " im Bärenmarkt"
      : regimeFilter === "bull"
        ? " im Bullenmarkt"
        : "";

  let headline: string;
  if (!hasExtendedRules && prevRule.op !== "any" && day0Rule.op !== "any") {
    headline = `${ticker} folgte auf einen ${describeReturnRule(prevRule)}-Tag genau ${n}-mal seit ${firstYear}${regimeClause} mit einem ${describeReturnRule(day0Rule)}-Tag.`;
  } else if (!hasExtendedRules && day0Rule.op !== "any" && prevRule.op === "any") {
    headline = `${ticker} verzeichnete einen ${describeReturnRule(day0Rule)}-Tag genau ${n}-mal seit ${firstYear}${regimeClause}.`;
  } else if (activeRuleParts.length > 0) {
    headline = `${ticker} erfüllte das Muster „${ruleDescription}“ genau ${n}-mal seit ${firstYear}${regimeClause}.`;
  } else {
    headline = `${n} historische Treffer für ${ticker} seit ${firstYear}${regimeClause} (${ruleDescription}).`;
  }

  const bullets: string[] = [];
  if (n === 0) {
    bullets.push(
      `Im geladenen Zeitraum (${firstYear}–${lastYear}, ${dataset.totalDays.toLocaleString("de-DE")} Handelstage) trat dieses exakte Muster${regimeClause} 0-mal auf — wähle „Max“ für die komplette Historie oder lockere die Prozent-Schwellen.`,
    );
  } else {
    const smaPart =
      belowSma200Rate !== null
        ? ` · Unter 200-SMA: ${belowSma200Rate.toFixed(1).replace(".", ",")} % (${belowSma200Count}/${withSma.length})`
        : "";
    bullets.push(
      `${bearCycleRate.toFixed(1).replace(".", ",")} % (${bearCycleCount}/${n}) traten im Bärenmarkt (≥ 20 %-Zyklus) auf${smaPart}.`,
    );

    if (withBottom.length > 0 && minFurtherDropPct !== null && medianFurtherDropPct !== null && worstFurtherDropPct !== null) {
      const daysPart =
        medianDaysToBottom !== null && medianDaysToBottom > 0
          ? `, Median ${medianDaysToBottom} Handelstage bis Tief`
          : "";
      const ongoingCount = n - withBottom.length;
      const ongoingNote = ongoingCount > 0 ? ` (${ongoingCount} laufend)` : "";
      if (droppedFurtherCount === withBottom.length && minFurtherDropPct <= -0.5) {
        bullets.push(
          `100,0 % (${withBottom.length}/${withBottom.length}) fielen danach noch mindestens ${formatSignedDe(minFurtherDropPct)}, bevor das Tief erreicht war (Median ${formatSignedDe(medianFurtherDropPct)}, Worst-Case ${formatSignedDe(worstFurtherDropPct)}${daysPart})${ongoingNote}.`,
        );
      } else if (droppedFurtherCount > 0) {
        bullets.push(
          `${droppedFurtherRate.toFixed(1).replace(".", ",")} % (${droppedFurtherCount}/${withBottom.length}) fielen danach noch tiefer (Median ${formatSignedDe(medianFurtherDropPct)}, Worst-Case ${formatSignedDe(worstFurtherDropPct)} · ≥ 5 % tiefer: ${droppedAtLeast5PctRate.toFixed(1).replace(".", ",")} %${daysPart})${ongoingNote}.`,
        );
      } else {
        bullets.push(
          `Keiner der ${withBottom.length} ausgewerteten Treffer fiel danach tiefer (0 % weiterer Rückgang)${ongoingNote}.`,
        );
      }
    } else {
      const ongoingBearCount = matchedObs.filter((o) => o.bearOngoing).length;
      bullets.push(
        ongoingBearCount > 0
          ? `Alle ${n} Treffer liegen in einem laufenden Bärenmarkt bzw. noch ohne bestätigtes Zyklustief — „Drop bis Tief“ ist aktuell noch offen (laufend).`
          : `Für die ${n} Treffer stehen noch zu wenige Folgetage für die Tief-Auswertung bereit (laufend).`,
      );
    }

    const h1 = horizons[0];
    const h21 = horizons[2];
    const h63 = horizons[3];
    const parts: string[] = [];
    if (h1.sampleSize > 0) {
      const volSuffix =
        nextDayVol.sampleSize > 0
          ? `, Ø Vola ±${nextDayVol.avgAbsMovePct.toFixed(1).replace(".", ",")} % / Range ${nextDayVol.avgRangePct.toFixed(1).replace(".", ",")} %`
          : "";
      parts.push(
        `Folgetag (T+1): ${h1.winRate.toFixed(1).replace(".", ",")} % Grün vs. ${round1(100 - h1.winRate).toFixed(1).replace(".", ",")} % Rot (Ø ${formatSignedDe(h1.avgPct)}${volSuffix})`,
      );
    }
    if (h21.sampleSize > 0) {
      parts.push(`1M: Ø ${formatSignedDe(h21.avgPct)} (${h21.winRate.toFixed(0)} % pos.)`);
    }
    if (h63.sampleSize > 0) {
      parts.push(`3M: Ø ${formatSignedDe(h63.avgPct)} (${h63.winRate.toFixed(0)} % pos.)`);
    }
    if (parts.length) bullets.push(`${parts.join(" · ")}.`);
  }

  const matches: PatternMatch[] = matchedObs
    .slice()
    .reverse()
    .map((o) => {
      const priorWinVal = priorWindowValueOf(o, priorWinDays);
      return {
        session: o.session,
        dayMinus4Pct: o.dayMinus4Pct !== null ? round2(o.dayMinus4Pct) : null,
        dayMinus3Pct: o.dayMinus3Pct !== null ? round2(o.dayMinus3Pct) : null,
        dayMinus2Pct: o.dayMinus2Pct !== null ? round2(o.dayMinus2Pct) : null,
        prevDayPct: o.prevDayCloseToClosePct !== null ? round2(o.prevDayCloseToClosePct) : null,
        day0Pct: round2(o.closeToClosePct),
        priorWindowPct: priorWinVal !== null ? round2(priorWinVal) : null,
        inBearCycle: o.inBearCycle,
        bearOngoing: o.bearOngoing,
        belowSma200: o.aboveSma200 !== null ? !o.aboveSma200 : null,
        drawdown52wPct: o.drawdownFrom52wHighPct,
        nextDayPct: o.nextDayCloseToClosePct !== null ? round2(o.nextDayCloseToClosePct) : null,
        fwd5dPct: o.fwd5dPct !== null ? round2(o.fwd5dPct) : null,
        fwd21dPct: o.fwd21dPct !== null ? round2(o.fwd21dPct) : null,
        fwd63dPct: o.fwd63dPct !== null ? round2(o.fwd63dPct) : null,
        fwd126dPct: o.fwd126dPct !== null ? round2(o.fwd126dPct) : null,
        fwd252dPct: o.fwd252dPct !== null ? round2(o.fwd252dPct) : null,
        maxDrop63dPct: o.fwdMaxDrop63dPct,
        dropToBottomPct: o.dropToBottomPct,
        daysToBottom: o.daysToBottom,
      };
    });

  return {
    ruleDescription,
    headline,
    bullets,
    sampleSize: n,
    rawSampleSize,
    minGapDays,
    regimeCounts,
    firstYear,
    lastYear,
    totalDays: dataset.totalDays,
    bearCycleCount,
    bearCycleRate,
    belowSma200Count,
    belowSma200Sample: withSma.length,
    belowSma200Rate,
    bottomEvaluatedCount: withBottom.length,
    droppedFurtherCount,
    droppedFurtherRate,
    droppedAtLeast5PctRate,
    droppedAtLeast10PctRate,
    minFurtherDropPct,
    medianFurtherDropPct,
    worstFurtherDropPct,
    medianDaysToBottom,
    maxDrop63dMedianPct,
    nextDayVol,
    horizons,
    matches,
  };
}

/**
 * Extracts the ticker's live/latest multi-day & cumulative Vorlauf snapshot so users
 * can see how the current tape compares against their configured Pattern Scanner rules.
 */
export function getLivePatternSnapshot(
  dataset: NoiseDataset,
  liveTodayReturnPct?: number | null,
): LivePatternSnapshot {
  const obs = dataset.observations;
  const len = obs.length;
  const lastObs = len > 0 ? obs[len - 1] : null;
  const usingLiveToday =
    typeof liveTodayReturnPct === "number" && Number.isFinite(liveTodayReturnPct);

  const emptyPrior: Record<PriorWindowDays, number | null> = {
    3: null,
    5: null,
    7: null,
    10: null,
    20: null,
  };

  if (!lastObs) {
    return {
      usingLiveToday,
      sessionLabel: dataset.lastSession || "—",
      day0Pct: usingLiveToday ? round2(liveTodayReturnPct!) : null,
      prevDayPct: null,
      dayMinus2Pct: null,
      dayMinus3Pct: null,
      dayMinus4Pct: null,
      priorWindow: emptyPrior,
      inBearCycle: dataset.currentInBearCycle,
      drawdown52wPct: dataset.currentDrawdown52wPct,
    };
  }

  if (usingLiveToday) {
    const cumBeforeLive = (w: PriorWindowDays): number | null => {
      if (len < w) return null;
      const baseClose = obs[len - w].prevClose;
      return baseClose > 0 ? round2(((lastObs.close - baseClose) / baseClose) * 100) : null;
    };
    const obsAt = (offsetFromEnd: number): number | null => {
      const idx = len - 1 - offsetFromEnd;
      return idx >= 0 ? round2(obs[idx].closeToClosePct) : null;
    };
    return {
      usingLiveToday: true,
      sessionLabel: "Heute Live",
      day0Pct: round2(liveTodayReturnPct!),
      prevDayPct: obsAt(0),
      dayMinus2Pct: obsAt(1),
      dayMinus3Pct: obsAt(2),
      dayMinus4Pct: obsAt(3),
      priorWindow: {
        3: cumBeforeLive(3),
        5: cumBeforeLive(5),
        7: cumBeforeLive(7),
        10: cumBeforeLive(10),
        20: cumBeforeLive(20),
      },
      inBearCycle: dataset.currentInBearCycle,
      drawdown52wPct: dataset.currentDrawdown52wPct,
    };
  }

  return {
    usingLiveToday: false,
    sessionLabel: lastObs.session,
    day0Pct: round2(lastObs.closeToClosePct),
    prevDayPct: lastObs.prevDayCloseToClosePct !== null ? round2(lastObs.prevDayCloseToClosePct) : null,
    dayMinus2Pct: lastObs.dayMinus2Pct !== null ? round2(lastObs.dayMinus2Pct) : null,
    dayMinus3Pct: lastObs.dayMinus3Pct !== null ? round2(lastObs.dayMinus3Pct) : null,
    dayMinus4Pct: lastObs.dayMinus4Pct !== null ? round2(lastObs.dayMinus4Pct) : null,
    priorWindow: {
      3: lastObs.prior3dPct !== null ? round2(lastObs.prior3dPct) : null,
      5: lastObs.prior5dPct !== null ? round2(lastObs.prior5dPct) : null,
      7: lastObs.prior7dPct !== null ? round2(lastObs.prior7dPct) : null,
      10: lastObs.prior10dPct !== null ? round2(lastObs.prior10dPct) : null,
      20: lastObs.prior20dPct !== null ? round2(lastObs.prior20dPct) : null,
    },
    inBearCycle: lastObs.inBearCycle,
    drawdown52wPct: lastObs.drawdownFrom52wHighPct,
  };
}

/**
 * Checks whether the ticker's current/latest tape (`LivePatternSnapshot`) currently
 * satisfies the active Pattern Scanner rules (requires at least one non-"any" return rule).
 */
export function matchesLivePatternSnapshot(
  snapshot: LivePatternSnapshot,
  input: PatternStudyInput,
): boolean {
  const norm = (rule?: ReturnRule): ReturnRule => ({
    op: rule?.op ?? "any",
    thresholdPct: clamp(round2(rule?.thresholdPct || 0), -40, 40),
  });
  const d4 = norm(input.dayMinus4Rule);
  const d3 = norm(input.dayMinus3Rule);
  const d2 = norm(input.dayMinus2Rule);
  const prev = norm(input.prevDayRule);
  const day0 = norm(input.day0Rule);
  const priorWinDays: PriorWindowDays = input.priorWindowRule?.days ?? 5;
  const priorWin: ReturnRule = {
    op: input.priorWindowRule?.op ?? "any",
    thresholdPct: clamp(round2(input.priorWindowRule?.thresholdPct || 0), -80, 100),
  };

  const hasAnyActiveRule =
    priorWin.op !== "any" ||
    d4.op !== "any" ||
    d3.op !== "any" ||
    d2.op !== "any" ||
    prev.op !== "any" ||
    day0.op !== "any";
  if (!hasAnyActiveRule) return false;

  if (!matchesReturnRule(snapshot.priorWindow[priorWinDays], priorWin)) return false;
  if (!matchesReturnRule(snapshot.dayMinus4Pct, d4)) return false;
  if (!matchesReturnRule(snapshot.dayMinus3Pct, d3)) return false;
  if (!matchesReturnRule(snapshot.dayMinus2Pct, d2)) return false;
  if (!matchesReturnRule(snapshot.prevDayPct, prev)) return false;
  if (!matchesReturnRule(snapshot.day0Pct, day0)) return false;

  const regimeFilter = input.regimeFilter ?? "all";
  if (regimeFilter === "bear" && !snapshot.inBearCycle) return false;
  if (regimeFilter === "bull" && snapshot.inBearCycle) return false;
  return true;
}

function snapLeadupThreshold(pctVal: number): number | null {
  const abs = Math.abs(pctVal);
  if (abs < 2.0) return null;
  const sign = pctVal < 0 ? -1 : 1;
  if (abs >= 20) return sign * 20;
  if (abs >= 15) return sign * 15;
  if (abs >= 12) return sign * 12;
  if (abs >= 10) return sign * 10;
  if (abs >= 8) return sign * 8;
  if (abs >= 6) return sign * 6;
  if (abs >= 5) return sign * 5;
  if (abs >= 4) return sign * 4;
  if (abs >= 3) return sign * 3;
  return sign * 2;
}

/**
 * Derives a clean cumulative `Vorlauf → Heute` rule from the ticker's actual recent
 * multi-day move (picking the clearest 5T/7T/10T/3T move) and latest Tag 0 return.
 */
export function suggestLiveLeadupPattern(
  dataset: NoiseDataset,
  liveTodayReturnPct?: number | null,
): { priorWindowRule: PriorWindowRule; day0Rule: ReturnRule; usedLiveToday: boolean } {
  const snap = getLivePatternSnapshot(dataset, liveTodayReturnPct);
  const candidateWindows: PriorWindowDays[] = [5, 7, 10, 3];
  let bestWindow: PriorWindowDays | null = null;
  let bestSnapped: number | null = null;
  let bestScore = -1;

  for (const w of candidateWindows) {
    const val = snap.priorWindow[w];
    if (val === null) continue;
    const snapped = snapLeadupThreshold(val);
    if (snapped === null) continue;
    // Slight preference for stronger cumulative moves normalized by sqrt(window)
    const score = Math.abs(val) / Math.sqrt(w);
    if (score > bestScore) {
      bestScore = score;
      bestWindow = w;
      bestSnapped = snapped;
    }
  }

  const snappedDay0 = snap.day0Pct !== null ? snapShockThreshold(snap.day0Pct) : null;

  if (bestWindow !== null && bestSnapped !== null) {
    return {
      priorWindowRule: {
        days: bestWindow,
        op: bestSnapped < 0 ? "lte" : "gte",
        thresholdPct: bestSnapped,
      },
      day0Rule:
        snappedDay0 !== null
          ? { op: snappedDay0 < 0 ? "lte" : "gte", thresholdPct: snappedDay0 }
          : { op: "any", thresholdPct: 3 },
      usedLiveToday: snap.usingLiveToday,
    };
  }

  if (snappedDay0 !== null) {
    return {
      priorWindowRule: { days: 5, op: "any", thresholdPct: -8 },
      day0Rule: { op: snappedDay0 < 0 ? "lte" : "gte", thresholdPct: snappedDay0 },
      usedLiveToday: snap.usingLiveToday,
    };
  }

  return {
    priorWindowRule: { days: 7, op: "lte", thresholdPct: -10 },
    day0Rule: { op: "gte", thresholdPct: 5 },
    usedLiveToday: snap.usingLiveToday,
  };
}

/** Formats an OddStats-style plain-text Pattern Scanner report for clipboard sharing / journaling. */
export function formatPatternSummaryText(ticker: string, study: PatternStudyResult): string {
  const lines: string[] = [
    `${ticker} Muster-Scanner (${study.ruleDescription})`,
    study.headline,
  ];
  for (const b of study.bullets) {
    lines.push(`• ${b}`);
  }
  const activeHorizons = study.horizons.filter((h) => h.sampleSize > 0);
  if (activeHorizons.length > 0) {
    lines.push("");
    lines.push("Folge-Performance:");
    for (const h of activeHorizons) {
      lines.push(
        `  ${h.label}: ${h.winRate.toFixed(1).replace(".", ",")} % pos. | Ø ${formatSignedDe(h.avgPct)} | Median ${formatSignedDe(h.medianPct)} (n=${h.sampleSize})`,
      );
    }
  }
  return lines.join("\n");
}

/** Builds a clean CSV export string for all matched Pattern Scanner occurrences. */
export function buildPatternMatchesCsv(
  study: PatternStudyResult,
  mode: "leadup" | "days",
  priorWindowDays: PriorWindowDays,
  lookbackDays: 2 | 3 | 4 | 5,
): string {
  const num = (v: number | null) => (v === null || !Number.isFinite(v) ? "" : String(v));
  const headers: string[] = ["Datum"];
  if (mode === "leadup") {
    headers.push(`Vor-${priorWindowDays}T_%`);
  } else {
    if (lookbackDays >= 5) headers.push("Tag-4_%");
    if (lookbackDays >= 4) headers.push("Tag-3_%");
    if (lookbackDays >= 3) headers.push("Tag-2_%");
    headers.push("Tag-1_%");
  }
  headers.push(
    "Tag0_%",
    "Regime",
    "T+1_%",
    "5T_%",
    "1M_%",
    "3M_%",
    "6M_%",
    "1J_%",
    "DropBisTief_%",
    "TageBisTief",
  );

  const rows = study.matches.map((m) => {
    const cols: string[] = [m.session];
    if (mode === "leadup") {
      cols.push(num(m.priorWindowPct));
    } else {
      if (lookbackDays >= 5) cols.push(num(m.dayMinus4Pct));
      if (lookbackDays >= 4) cols.push(num(m.dayMinus3Pct));
      if (lookbackDays >= 3) cols.push(num(m.dayMinus2Pct));
      cols.push(num(m.prevDayPct));
    }
    cols.push(
      num(m.day0Pct),
      m.inBearCycle ? "Bärenmarkt" : "Bullenmarkt",
      num(m.nextDayPct),
      num(m.fwd5dPct),
      num(m.fwd21dPct),
      num(m.fwd63dPct),
      num(m.fwd126dPct),
      num(m.fwd252dPct),
      m.dropToBottomPct !== null ? num(m.dropToBottomPct) : "laufend",
      m.daysToBottom !== null ? String(m.daysToBottom) : "",
    );
    return cols.join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}



