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
  fwd3dPct: number | null;
  fwd5dPct: number | null;
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
  gapMean: number;
  gapStd: number;
  absGapsSorted: number[];
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
  totalDays: number;
  live: {
    prevClose: number;
    lastPrice: number;
    liveGapPct: number;
    priceSource: "premarket" | "afterhours" | "regular" | "last-close";
    currentStreak: { direction: "red" | "green"; count: number };
    currentCandleStreak?: { direction: "red" | "green"; count: number };
    currentAtr14Pct: number;
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

/**
 * Transforms chronological daily OHLCV bars into an empirical observation dataset
 * for gap-fill, fade/continuation, streak, volatility, and weekday statistics.
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
    return {
      observations: [],
      firstSession: bars[0]?.session ?? "",
      lastSession: bars.at(-1)?.session ?? "",
      totalDays: bars.length,
      currentStreak: { direction: "green", count: 0 },
      currentCandleStreak: { direction: "green", count: 0 },
      recentDays: [],
      currentAtr14Pct: 0,
      gapMean: 0,
      gapStd: 0,
      absGapsSorted: [],
    };
  }

  const trueRanges: number[] = [bars[0].high - bars[0].low];
  const observations: NoiseObservation[] = [];
  let runningStreak = 0;
  let runningCandleStreak =
    bars[0].close > bars[0].open ? 1 : bars[0].close < bars[0].open ? -1 : 0;

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

    const gapPct = ((curr.open - prev.close) / prev.close) * 100;
    const openToClosePct = ((curr.close - curr.open) / curr.open) * 100;
    const closeToClosePct = ((curr.close - prev.close) / prev.close) * 100;

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

    const fwd3dPct =
      i + 3 < bars.length ? ((bars[i + 3].close - curr.close) / curr.close) * 100 : null;
    const fwd5dPct =
      i + 5 < bars.length ? ((bars[i + 5].close - curr.close) / curr.close) * 100 : null;

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
      fwd3dPct,
      fwd5dPct,
    });

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

  const recentDays: NoiseRecentDay[] = observations.slice(-8).map((o) => ({
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
