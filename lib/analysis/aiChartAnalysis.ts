import type {
  OverlayBox,
  OverlayHLine,
  OverlayMarker,
  OverlayPrimitive,
  OverlaySegment,
} from "@/lib/chart/overlays";
import type { OptionsAnalytics } from "@/lib/market/optionsAnalytics";
import { detectPatterns, type PatternHit } from "@/lib/patterns";
import type { OHLCV } from "@/types/trading";

export type AnalysisBias = "bullish" | "bearish" | "neutral";

export interface AiAnalysisLayerConfig {
  structure: boolean;
  zones: boolean;
  levels: boolean;
  fib: boolean;
  tradePlan: boolean;
}

export const DEFAULT_AI_ANALYSIS_LAYERS: AiAnalysisLayerConfig = {
  structure: true,
  zones: true,
  levels: true,
  fib: true,
  tradePlan: true,
};

export interface SwingPivot {
  index: number;
  time: number;
  price: number;
  kind: "high" | "low";
  tag?: "HH" | "LH" | "HL" | "LL";
}

export interface StructureBreak {
  kind: "BOS" | "CHoCH";
  direction: "bullish" | "bearish";
  price: number;
  fromTime: number;
  toTime: number;
}

export interface PriceZone {
  id: string;
  kind: "demand" | "supply" | "fvg-bull" | "fvg-bear" | "golden-pocket";
  low: number;
  high: number;
  startTime: number;
  label: string;
  strength: number; // 1-3
}

export interface TrendLineModel {
  id: string;
  kind: "support" | "resistance";
  fromTime: number;
  fromPrice: number;
  toTime: number;
  toPrice: number;
  label: string;
}

export interface KeyLevelModel {
  id: string;
  kind: "resistance" | "support" | "poc" | "bsl" | "ssl";
  price: number;
  touches: number;
  label: string;
  startTime?: number;
}

export interface AiTradePlan {
  direction: "long" | "short";
  entryLow: number;
  entryHigh: number;
  entryMid: number;
  stopLoss: number;
  target1: number;
  target2: number;
  riskReward1: number;
  riskReward2: number;
  rationale: string;
}

export interface AiChartAnalysisReport {
  symbol: string;
  timeframe: string;
  analyzedAt: number;
  barCount: number;
  lastPrice: number;
  bias: AnalysisBias;
  confidence: number; // 0..100
  regimeLabel: string;
  // Quantitative indicators
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  rsiDivergence: "bullish" | "bearish" | null;
  atr14: number;
  atrPct: number;
  volatilityRegime: "compression" | "normal" | "expansion";
  volumePoc: number | null;
  // Structural findings
  swings: SwingPivot[];
  structureBreak: StructureBreak | null;
  trendlines: TrendLineModel[];
  zones: PriceZone[];
  levels: KeyLevelModel[];
  patterns: PatternHit[];
  // Narrative & actionable plan
  headline: string;
  bullets: string[];
  optionsConfluence: string | null;
  tradePlan: AiTradePlan | null;
}

function fmtPrice(p: number): string {
  const abs = Math.abs(p);
  if (abs >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (abs >= 10) return p.toFixed(2);
  if (abs >= 1) return p.toFixed(3);
  return p.toFixed(5);
}

function emaSeries(values: readonly number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = new Array<number>(values.length);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsiSeries(closes: readonly number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(50);
  if (closes.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function atrSeries(bars: readonly OHLCV[], period = 14): number[] {
  const out = new Array<number>(bars.length).fill(0);
  if (!bars.length) return out;
  const tr = new Array<number>(bars.length);
  tr[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  let sum = 0;
  const initLen = Math.min(period, bars.length);
  for (let i = 0; i < initLen; i++) sum += tr[i];
  let prev = sum / initLen;
  for (let i = 0; i < initLen; i++) out[i] = prev;
  for (let i = initLen; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

function detectSwings(bars: readonly OHLCV[], lookback = 4): SwingPivot[] {
  const pivots: SwingPivot[] = [];
  if (bars.length < lookback * 2 + 1) return pivots;
  for (let i = lookback; i < bars.length - lookback; i++) {
    const bar = bars[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (j < i ? bars[j].high > bar.high : bars[j].high >= bar.high) isHigh = false;
      if (j < i ? bars[j].low < bar.low : bars[j].low <= bar.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) {
      pivots.push({ index: i, time: bar.time, price: bar.high, kind: "high" });
    } else if (isLow) {
      pivots.push({ index: i, time: bar.time, price: bar.low, kind: "low" });
    }
  }

  // Deduplicate adjacent same-kind pivots (keep the more extreme one)
  const alternating: SwingPivot[] = [];
  for (const p of pivots) {
    const last = alternating[alternating.length - 1];
    if (!last || last.kind !== p.kind) {
      alternating.push(p);
    } else if (
      (p.kind === "high" && p.price > last.price) ||
      (p.kind === "low" && p.price < last.price)
    ) {
      alternating[alternating.length - 1] = p;
    }
  }

  // Tag HH / LH / HL / LL
  let prevHigh: number | null = null;
  let prevLow: number | null = null;
  for (const p of alternating) {
    if (p.kind === "high") {
      if (prevHigh !== null) p.tag = p.price > prevHigh ? "HH" : "LH";
      prevHigh = p.price;
    } else {
      if (prevLow !== null) p.tag = p.price > prevLow ? "HL" : "LL";
      prevLow = p.price;
    }
  }
  return alternating;
}

function computeVolumePoc(bars: readonly OHLCV[], bins = 36): number | null {
  if (bars.length < 10) return null;
  let minP = Infinity;
  let maxP = -Infinity;
  let totalVol = 0;
  for (const b of bars) {
    if (b.low < minP) minP = b.low;
    if (b.high > maxP) maxP = b.high;
    totalVol += Math.max(0, b.volume || 0);
  }
  if (!(maxP > minP) || totalVol <= 0) return null;
  const hist = new Float64Array(bins);
  const step = (maxP - minP) / bins;
  for (const b of bars) {
    const vol = Math.max(0, b.volume || 0);
    if (vol <= 0) continue;
    const typical = (b.high + b.low + b.close) / 3;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((typical - minP) / step)));
    hist[idx] += vol;
  }
  let bestIdx = 0;
  for (let i = 1; i < bins; i++) {
    if (hist[i] > hist[bestIdx]) bestIdx = i;
  }
  return minP + (bestIdx + 0.5) * step;
}

function detectUnmitigatedOrderBlocks(
  bars: readonly OHLCV[],
  atrs: readonly number[],
): PriceZone[] {
  const zones: PriceZone[] = [];
  const lastClose = bars[bars.length - 1].close;
  const start = Math.max(2, bars.length - 140);

  let bestDemand: PriceZone | null = null;
  let bestSupply: PriceZone | null = null;

  for (let i = start; i < bars.length - 3; i++) {
    const atr = Math.max(atrs[i], lastClose * 0.002);
    const b = bars[i];
    const next1 = bars[i + 1];
    const next2 = bars[i + 2];

    // Bullish Order Block (Demand): bearish candle followed by strong bullish displacement >= 1.7 * ATR
    const bullImpulse = Math.max(next1.close - b.high, next2.close - b.high);
    if (b.close < b.open && bullImpulse >= atr * 1.6) {
      const zoneLow = b.low;
      const zoneHigh = Math.max(b.open, (b.open + b.high) / 2);
      // Must remain unmitigated (no subsequent close below zoneLow)
      let invalidated = false;
      for (let k = i + 2; k < bars.length; k++) {
        if (bars[k].close < zoneLow) {
          invalidated = true;
          break;
        }
      }
      if (!invalidated && zoneHigh <= lastClose * 1.01) {
        bestDemand = {
          id: `ai-demand-${b.time}`,
          kind: "demand",
          low: zoneLow,
          high: zoneHigh,
          startTime: b.time,
          label: `DEMAND / OB $${fmtPrice(zoneLow)}–$${fmtPrice(zoneHigh)}`,
          strength: bullImpulse >= atr * 2.5 ? 3 : 2,
        };
      }
    }

    // Bearish Order Block (Supply): bullish candle followed by strong bearish displacement >= 1.7 * ATR
    const bearImpulse = Math.max(b.low - next1.close, b.low - next2.close);
    if (b.close > b.open && bearImpulse >= atr * 1.6) {
      const zoneLow = Math.min(b.open, (b.open + b.low) / 2);
      const zoneHigh = b.high;
      let invalidated = false;
      for (let k = i + 2; k < bars.length; k++) {
        if (bars[k].close > zoneHigh) {
          invalidated = true;
          break;
        }
      }
      if (!invalidated && zoneLow >= lastClose * 0.99) {
        bestSupply = {
          id: `ai-supply-${b.time}`,
          kind: "supply",
          low: zoneLow,
          high: zoneHigh,
          startTime: b.time,
          label: `SUPPLY / OB $${fmtPrice(zoneLow)}–$${fmtPrice(zoneHigh)}`,
          strength: bearImpulse >= atr * 2.5 ? 3 : 2,
        };
      }
    }
  }

  if (bestDemand) zones.push(bestDemand);
  if (bestSupply) zones.push(bestSupply);
  return zones;
}

function detectUnfilledFvgs(bars: readonly OHLCV[], atrs: readonly number[]): PriceZone[] {
  const candidates: PriceZone[] = [];
  const lastClose = bars[bars.length - 1].close;
  const start = Math.max(2, bars.length - 90);

  for (let i = start; i < bars.length - 2; i++) {
    const prev = bars[i - 1];
    const next = bars[i + 1];
    const minGap = Math.max(atrs[i] * 0.35, lastClose * 0.0012);

    // Bullish FVG: gap between prev.high and next.low
    if (next.low > prev.high + minGap) {
      const low = prev.high;
      const high = next.low;
      let filled = false;
      for (let k = i + 2; k < bars.length; k++) {
        if (bars[k].low <= low + (high - low) * 0.25) {
          filled = true;
          break;
        }
      }
      if (!filled && low < lastClose) {
        candidates.push({
          id: `ai-fvg-bull-${bars[i].time}`,
          kind: "fvg-bull",
          low,
          high,
          startTime: bars[i].time,
          label: `FVG ↑ $${fmtPrice(low)}–$${fmtPrice(high)}`,
          strength: 2,
        });
      }
    }

    // Bearish FVG: gap between next.high and prev.low
    if (prev.low > next.high + minGap) {
      const low = next.high;
      const high = prev.low;
      let filled = false;
      for (let k = i + 2; k < bars.length; k++) {
        if (bars[k].high >= high - (high - low) * 0.25) {
          filled = true;
          break;
        }
      }
      if (!filled && high > lastClose) {
        candidates.push({
          id: `ai-fvg-bear-${bars[i].time}`,
          kind: "fvg-bear",
          low,
          high,
          startTime: bars[i].time,
          label: `FVG ↓ $${fmtPrice(low)}–$${fmtPrice(high)}`,
          strength: 2,
        });
      }
    }
  }

  // Keep nearest unfilled bullish FVG and nearest unfilled bearish FVG so the chart stays crisp
  const bull = candidates
    .filter((z) => z.kind === "fvg-bull")
    .sort((a, b) => Math.abs(lastClose - a.high) - Math.abs(lastClose - b.high))[0];
  const bear = candidates
    .filter((z) => z.kind === "fvg-bear")
    .sort((a, b) => Math.abs(a.low - lastClose) - Math.abs(b.low - lastClose))[0];

  return [bull, bear].filter((z): z is PriceZone => Boolean(z));
}

function detectKeyLevelsAndLiquidity(
  swings: readonly SwingPivot[],
  lastPrice: number,
  atr: number,
  poc: number | null,
): KeyLevelModel[] {
  const levels: KeyLevelModel[] = [];
  const clusterTol = Math.max(atr * 0.55, lastPrice * 0.004);
  const liqTol = Math.max(atr * 0.25, lastPrice * 0.002);

  // Cluster swing highs & lows into multi-touch Resistance / Support
  interface Cluster {
    sum: number;
    count: number;
    lastTime: number;
    firstTime: number;
    kind: "high" | "low";
  }
  const clusters: Cluster[] = [];
  for (const s of swings) {
    const hit = clusters.find(
      (c) => Math.abs(c.sum / c.count - s.price) <= clusterTol,
    );
    if (hit) {
      hit.sum += s.price;
      hit.count += 1;
      hit.lastTime = Math.max(hit.lastTime, s.time);
      hit.firstTime = Math.min(hit.firstTime, s.time);
    } else {
      clusters.push({
        sum: s.price,
        count: 1,
        lastTime: s.time,
        firstTime: s.time,
        kind: s.kind,
      });
    }
  }

  const above = clusters
    .map((c) => ({ price: c.sum / c.count, count: c.count, lastTime: c.lastTime }))
    .filter((c) => c.price > lastPrice * 1.003)
    .sort((a, b) => b.count - a.count || a.price - b.price);

  const below = clusters
    .map((c) => ({ price: c.sum / c.count, count: c.count, lastTime: c.lastTime }))
    .filter((c) => c.price < lastPrice * 0.997)
    .sort((a, b) => b.count - a.count || b.price - a.price);

  if (above[0]) {
    levels.push({
      id: "ai-key-res",
      kind: "resistance",
      price: above[0].price,
      touches: above[0].count,
      label: `KEY RESISTANCE $${fmtPrice(above[0].price)} (${above[0].count}×)`,
    });
  }
  if (below[0]) {
    levels.push({
      id: "ai-key-sup",
      kind: "support",
      price: below[0].price,
      touches: below[0].count,
      label: `KEY SUPPORT $${fmtPrice(below[0].price)} (${below[0].count}×)`,
    });
  }

  // Detect Equal Highs (BSL) & Equal Lows (SSL) liquidity pools among recent swings
  const recentHighs = swings.filter((s) => s.kind === "high").slice(-6);
  for (let i = recentHighs.length - 1; i >= 1; i--) {
    const a = recentHighs[i];
    const b = recentHighs[i - 1];
    if (Math.abs(a.price - b.price) <= liqTol && a.price > lastPrice * 1.001) {
      const avg = (a.price + b.price) / 2;
      levels.push({
        id: "ai-liq-bsl",
        kind: "bsl",
        price: avg,
        touches: 2,
        startTime: b.time,
        label: `$$$ BSL (Equal Highs) $${fmtPrice(avg)}`,
      });
      break;
    }
  }

  const recentLows = swings.filter((s) => s.kind === "low").slice(-6);
  for (let i = recentLows.length - 1; i >= 1; i--) {
    const a = recentLows[i];
    const b = recentLows[i - 1];
    if (Math.abs(a.price - b.price) <= liqTol && a.price < lastPrice * 0.999) {
      const avg = (a.price + b.price) / 2;
      levels.push({
        id: "ai-liq-ssl",
        kind: "ssl",
        price: avg,
        touches: 2,
        startTime: b.time,
        label: `$$$ SSL (Equal Lows) $${fmtPrice(avg)}`,
      });
      break;
    }
  }

  if (poc !== null) {
    levels.push({
      id: "ai-vol-poc",
      kind: "poc",
      price: poc,
      touches: 1,
      label: `VOLUME POC $${fmtPrice(poc)}`,
    });
  }

  return levels;
}

function fitTrendlines(bars: readonly OHLCV[], swings: readonly SwingPivot[]): TrendLineModel[] {
  const lines: TrendLineModel[] = [];
  if (bars.length < 20 || swings.length < 4) return lines;
  const lastIdx = bars.length - 1;
  const lastBar = bars[lastIdx];

  // Rising Support Trendline from last two ascending swing lows
  const lows = swings.filter((s) => s.kind === "low").slice(-5);
  for (let i = lows.length - 1; i >= 1; i--) {
    const p2 = lows[i];
    const p1 = lows[i - 1];
    if (p2.price > p1.price && p2.index - p1.index >= 4) {
      const slope = (p2.price - p1.price) / (p2.index - p1.index);
      const projected = p2.price + slope * (lastIdx - p2.index);
      // Valid only if current close hasn't crashed deeply below it
      if (projected > 0 && lastBar.close >= projected * 0.965) {
        lines.push({
          id: "ai-trend-support",
          kind: "support",
          fromTime: p1.time,
          fromPrice: p1.price,
          toTime: lastBar.time,
          toPrice: projected,
          label: "Aufwärtstrendlinie",
        });
        break;
      }
    }
  }

  // Falling Resistance Trendline from last two descending swing highs
  const highs = swings.filter((s) => s.kind === "high").slice(-5);
  for (let i = highs.length - 1; i >= 1; i--) {
    const p2 = highs[i];
    const p1 = highs[i - 1];
    if (p2.price < p1.price && p2.index - p1.index >= 4) {
      const slope = (p2.price - p1.price) / (p2.index - p1.index);
      const projected = p2.price + slope * (lastIdx - p2.index);
      if (projected > 0 && lastBar.close <= projected * 1.035) {
        lines.push({
          id: "ai-trend-resistance",
          kind: "resistance",
          fromTime: p1.time,
          fromPrice: p1.price,
          toTime: lastBar.time,
          toPrice: projected,
          label: "Abwärtstrendlinie",
        });
        break;
      }
    }
  }

  return lines;
}

function detectRsiDivergence(
  swings: readonly SwingPivot[],
  rsi: readonly number[],
): "bullish" | "bearish" | null {
  const lows = swings.filter((s) => s.kind === "low").slice(-3);
  if (lows.length >= 2) {
    const prev = lows[lows.length - 2];
    const curr = lows[lows.length - 1];
    if (curr.price < prev.price && rsi[curr.index] > rsi[prev.index] + 3 && rsi[prev.index] < 42) {
      return "bullish";
    }
  }
  const highs = swings.filter((s) => s.kind === "high").slice(-3);
  if (highs.length >= 2) {
    const prev = highs[highs.length - 2];
    const curr = highs[highs.length - 1];
    if (curr.price > prev.price && rsi[curr.index] < rsi[prev.index] - 3 && rsi[prev.index] > 58) {
      return "bearish";
    }
  }
  return null;
}

/**
 * Performs a comprehensive, zero-API-key institutional technical chart analysis on loaded candles,
 * optionally fusing live Options Walls (Call Wall, Put Wall, Gamma Flip, Max Pain).
 */
export function analyzeChart(params: {
  symbol: string;
  timeframe: string;
  bars: readonly OHLCV[];
  options?: OptionsAnalytics | null;
  optionsScale?: number;
  now?: number;
}): AiChartAnalysisReport {
  const now = params.now ?? Date.now();
  const windowBars = params.bars.length > 260 ? params.bars.slice(-260) : params.bars;
  const last = windowBars[windowBars.length - 1];
  const lastPrice = last?.close ?? 0;

  if (windowBars.length < 20 || !(lastPrice > 0)) {
    return {
      symbol: params.symbol,
      timeframe: params.timeframe,
      analyzedAt: now,
      barCount: windowBars.length,
      lastPrice,
      bias: "neutral",
      confidence: 0,
      regimeLabel: "Zu wenig Kerzen geladen",
      ema20: null,
      ema50: null,
      ema200: null,
      rsi14: null,
      rsiDivergence: null,
      atr14: 0,
      atrPct: 0,
      volatilityRegime: "normal",
      volumePoc: null,
      swings: [],
      structureBreak: null,
      trendlines: [],
      zones: [],
      levels: [],
      patterns: [],
      headline: "Mindestens 20 Kerzen für die AI Chartanalyse erforderlich.",
      bullets: ["Wechsle den Timeframe oder warte, bis die Kurshistorie geladen ist."],
      optionsConfluence: null,
      tradePlan: null,
    };
  }

  const closes = windowBars.map((b) => b.close);
  const ema20Arr = emaSeries(closes, 20);
  const ema50Arr = emaSeries(closes, 50);
  const ema200Arr = windowBars.length >= 120 ? emaSeries(closes, 200) : [];
  const rsiArr = rsiSeries(closes, 14);
  const atrArr = atrSeries(windowBars, 14);

  const ema20 = ema20Arr[ema20Arr.length - 1];
  const ema50 = ema50Arr[ema50Arr.length - 1];
  const ema200 = ema200Arr.length ? ema200Arr[ema200Arr.length - 1] : null;
  const rsi14 = rsiArr[rsiArr.length - 1];
  const atr14 = Math.max(atrArr[atrArr.length - 1], lastPrice * 0.001);
  const atrPct = (atr14 / lastPrice) * 100;

  // Volatility regime vs 50-bar baseline ATR
  const baseAtrWindow = atrArr.slice(-60);
  const meanAtr = baseAtrWindow.reduce((a, b) => a + b, 0) / Math.max(1, baseAtrWindow.length);
  const volatilityRegime =
    atr14 < meanAtr * 0.8 ? "compression" : atr14 > meanAtr * 1.25 ? "expansion" : "normal";

  // Swings & Market Structure (adaptively tighten lookback on fast parabolic moves)
  const lookback = windowBars.length >= 120 ? 4 : 3;
  let swings = detectSwings(windowBars, lookback);
  if (swings.length < 4) swings = detectSwings(windowBars, 2);
  const rsiDivergence = detectRsiDivergence(swings, rsiArr);

  // Recent structure tags score
  const recentTagged = swings.slice(-6).filter((s) => s.tag);
  let bullStruct = 0;
  let bearStruct = 0;
  for (const s of recentTagged) {
    if (s.tag === "HH" || s.tag === "HL") bullStruct++;
    if (s.tag === "LH" || s.tag === "LL") bearStruct++;
  }

  // Detect most recent BOS / CHoCH
  let structureBreak: StructureBreak | null = null;
  const recentHigh = [...swings].reverse().find((s) => s.kind === "high" && s.index < windowBars.length - 2);
  const recentLow = [...swings].reverse().find((s) => s.kind === "low" && s.index < windowBars.length - 2);

  if (recentHigh) {
    for (let i = recentHigh.index + 1; i < windowBars.length; i++) {
      if (windowBars[i].close > recentHigh.price) {
        structureBreak = {
          kind: bearStruct > bullStruct ? "CHoCH" : "BOS",
          direction: "bullish",
          price: recentHigh.price,
          fromTime: recentHigh.time,
          toTime: windowBars[i].time,
        };
        break;
      }
    }
  }
  if (recentLow) {
    for (let i = recentLow.index + 1; i < windowBars.length; i++) {
      if (windowBars[i].close < recentLow.price) {
        if (!structureBreak || windowBars[i].time > structureBreak.toTime) {
          structureBreak = {
            kind: bullStruct > bearStruct ? "CHoCH" : "BOS",
            direction: "bearish",
            price: recentLow.price,
            fromTime: recentLow.time,
            toTime: windowBars[i].time,
          };
        }
        break;
      }
    }
  }

  // Volume POC, Order Blocks, FVGs, Key S/R & Liquidity, Trendlines, Patterns
  const pocWindow = windowBars.slice(-140);
  const volumePoc = computeVolumePoc(pocWindow);
  const obZones = detectUnmitigatedOrderBlocks(windowBars, atrArr);
  const fvgZones = detectUnfilledFvgs(windowBars, atrArr);
  const levels = detectKeyLevelsAndLiquidity(swings, lastPrice, atr14, volumePoc);
  const trendlines = fitTrendlines(windowBars, swings);

  // Golden Pocket (0.618 - 0.65) on dominant recent impulse leg
  const zones: PriceZone[] = [...obZones, ...fvgZones];
  const recentWindow = windowBars.slice(-90);
  let legLowBar = recentWindow[0];
  let legHighBar = recentWindow[0];
  for (const b of recentWindow) {
    if (b.low < legLowBar.low) legLowBar = b;
    if (b.high > legHighBar.high) legHighBar = b;
  }
  const legRange = legHighBar.high - legLowBar.low;
  if (legRange >= atr14 * 3.2) {
    if (legHighBar.time > legLowBar.time) {
      // Bullish impulse -> pullback Golden Pocket 0.618 - 0.65
      const gpHigh = legHighBar.high - legRange * 0.618;
      const gpLow = legHighBar.high - legRange * 0.65;
      zones.push({
        id: "ai-fib-gp",
        kind: "golden-pocket",
        low: gpLow,
        high: gpHigh,
        startTime: legHighBar.time,
        label: `FIB GOLDEN POCKET $${fmtPrice(gpLow)}–$${fmtPrice(gpHigh)}`,
        strength: 2,
      });
    } else {
      // Bearish impulse -> bounce Golden Pocket 0.618 - 0.65
      const gpLow = legLowBar.low + legRange * 0.618;
      const gpHigh = legLowBar.low + legRange * 0.65;
      zones.push({
        id: "ai-fib-gp",
        kind: "golden-pocket",
        low: gpLow,
        high: gpHigh,
        startTime: legLowBar.time,
        label: `FIB GOLDEN POCKET $${fmtPrice(gpLow)}–$${fmtPrice(gpHigh)}`,
        strength: 2,
      });
    }
  }

  // Confirmed chart & candlestick patterns
  const patterns = detectPatterns(windowBars, {
    candlestick: true,
    chart: true,
    minConfidence: 0.55,
    lookback: Math.min(200, windowBars.length),
    disabled: [],
  }).slice(-4);

  // Quantitative Confluence Scoring (-100..+100)
  let score = 0;
  if (lastPrice > ema20) score += 12;
  else score -= 12;
  if (ema20 > ema50) score += 16;
  else score -= 16;
  if (ema200 !== null) {
    if (lastPrice > ema200) score += 14;
    else score -= 14;
  }
  score += (bullStruct - bearStruct) * 7;
  if (structureBreak) {
    score += structureBreak.direction === "bullish" ? 16 : -16;
  }
  if (rsi14 > 54 && rsi14 < 74) score += 8;
  else if (rsi14 < 46 && rsi14 > 26) score -= 8;
  if (rsiDivergence === "bullish") score += 14;
  if (rsiDivergence === "bearish") score -= 14;
  if (volumePoc !== null) {
    if (lastPrice > volumePoc) score += 6;
    else score -= 6;
  }
  for (const p of patterns) {
    if (p.bias === "bullish") score += 6;
    if (p.bias === "bearish") score -= 6;
  }

  // Optional live Options Walls Confluence
  let optionsConfluence: string | null = null;
  const optScale = params.optionsScale && params.optionsScale > 0 ? params.optionsScale : 1;
  const opt = params.options;
  if (opt && (opt.callWall || opt.putWall)) {
    const cw = opt.callWall ? opt.callWall.strike * optScale : null;
    const pw = opt.putWall ? opt.putWall.strike * optScale : null;
    const gf = opt.gammaFlip !== null ? opt.gammaFlip * optScale : null;
    const mp = opt.maxPain !== null ? opt.maxPain * optScale : null;
    if (gf !== null) {
      if (lastPrice > gf) score += 8;
      else score -= 8;
    }
    const parts: string[] = [];
    if (pw !== null) parts.push(`Put Wall $${fmtPrice(pw)}`);
    if (cw !== null) parts.push(`Call Wall $${fmtPrice(cw)}`);
    if (gf !== null) parts.push(`Gamma Flip $${fmtPrice(gf)}`);
    if (mp !== null) parts.push(`Max Pain $${fmtPrice(mp)}`);
    const regimeTxt =
      opt.gammaRegime === "positive"
        ? "Positives Gamma (Pinning/Mean-Reversion)"
        : opt.gammaRegime === "negative"
          ? "Negatives Gamma (Trend-/Vol-Expansion)"
          : "Neutrales Gamma";
    optionsConfluence = `${opt.display} Optionen: ${parts.join(" · ")} · ${regimeTxt}.`;
  }

  const clampedScore = Math.max(-100, Math.min(100, score));
  const bias: AnalysisBias =
    clampedScore >= 18 ? "bullish" : clampedScore <= -18 ? "bearish" : "neutral";
  const confidence = Math.min(95, Math.max(38, Math.round(45 + Math.abs(clampedScore) * 0.52)));

  const regimeLabel =
    bias === "bullish"
      ? structureBreak?.kind === "CHoCH"
        ? "Bullischer Strukturwechsel (CHoCH)"
        : "Bullischer Aufwärtstrend (HH/HL)"
      : bias === "bearish"
        ? structureBreak?.kind === "CHoCH"
          ? "Bärischer Strukturwechsel (CHoCH)"
          : "Bärischer Abwärtstrend (LH/LL)"
        : volatilityRegime === "compression"
          ? "Seitwärts-Range · Volatilitäts-Kompression"
          : "Ausgeglichene Range / Konsolidierung";

  // Build actionable institutional Trade Plan (Entry, SL, TP1, TP2, R:R)
  let tradePlan: AiTradePlan | null = null;
  const demandZone = zones.find((z) => z.kind === "demand") ?? zones.find((z) => z.kind === "fvg-bull");
  const supplyZone = zones.find((z) => z.kind === "supply") ?? zones.find((z) => z.kind === "fvg-bear");
  const keyRes = levels.find((l) => l.kind === "resistance");
  const keySup = levels.find((l) => l.kind === "support");
  const optCall = opt?.callWall ? opt.callWall.strike * optScale : null;
  const optPut = opt?.putWall ? opt.putWall.strike * optScale : null;

  if (bias === "bullish" || (bias === "neutral" && clampedScore >= 0)) {
    const entryHigh = demandZone
      ? Math.min(lastPrice, demandZone.high)
      : keySup && lastPrice - keySup.price <= atr14 * 2.5
        ? keySup.price + atr14 * 0.25
        : lastPrice;
    const entryLow = demandZone
      ? demandZone.low
      : Math.max(0.0001, entryHigh - atr14 * 0.45);
    const entryMid = (entryLow + entryHigh) / 2;
    const stopLoss = Math.max(0.0001, Math.min(entryLow, optPut && optPut < entryLow && entryLow - optPut < atr14 * 2.2 ? optPut : entryLow) - atr14 * 0.85);
    const risk = Math.max(entryMid - stopLoss, atr14 * 0.5);
    const naturalT1 =
      optCall && optCall > entryMid + risk * 1.1
        ? optCall
        : keyRes && keyRes.price > entryMid + risk * 1.1
          ? keyRes.price
          : entryMid + risk * 1.8;
    const target1 = Math.max(entryMid + risk * 1.3, naturalT1);
    const target2 = Math.max(target1 + risk * 0.9, entryMid + risk * 2.8);
    tradePlan = {
      direction: "long",
      entryLow,
      entryHigh,
      entryMid,
      stopLoss,
      target1,
      target2,
      riskReward1: (target1 - entryMid) / risk,
      riskReward2: (target2 - entryMid) / risk,
      rationale: demandZone
        ? `Pullback-Long an aktiver Demand/FVG-Zone ($${fmtPrice(entryLow)}–$${fmtPrice(entryHigh)}) mit Struktur-Invalidierung unter $${fmtPrice(stopLoss)}.`
        : `Trendfolge-Long oberhalb Support/EMA-Cluster mit Absicherung unter $${fmtPrice(stopLoss)}.`,
    };
  } else {
    const entryLow = supplyZone
      ? Math.max(lastPrice, supplyZone.low)
      : keyRes && keyRes.price - lastPrice <= atr14 * 2.5
        ? keyRes.price - atr14 * 0.25
        : lastPrice;
    const entryHigh = supplyZone ? supplyZone.high : entryLow + atr14 * 0.45;
    const entryMid = (entryLow + entryHigh) / 2;
    const stopLoss =
      Math.max(entryHigh, optCall && optCall > entryHigh && optCall - entryHigh < atr14 * 2.2 ? optCall : entryHigh) +
      atr14 * 0.85;
    const risk = Math.max(stopLoss - entryMid, atr14 * 0.5);
    const naturalT1 =
      optPut && optPut < entryMid - risk * 1.1
        ? optPut
        : keySup && keySup.price < entryMid - risk * 1.1
          ? keySup.price
          : entryMid - risk * 1.8;
    const target1 = Math.max(0.0001, Math.min(entryMid - risk * 1.3, naturalT1));
    const target2 = Math.max(0.0001, Math.min(target1 - risk * 0.9, entryMid - risk * 2.8));
    tradePlan = {
      direction: "short",
      entryLow,
      entryHigh,
      entryMid,
      stopLoss,
      target1,
      target2,
      riskReward1: (entryMid - target1) / risk,
      riskReward2: (entryMid - target2) / risk,
      rationale: supplyZone
        ? `Retest-Short an aktiver Supply/FVG-Zone ($${fmtPrice(entryLow)}–$${fmtPrice(entryHigh)}) mit Invalidierung über $${fmtPrice(stopLoss)}.`
        : `Trendfolge-Short unterhalb Widerstand/EMA-Cluster mit Absicherung über $${fmtPrice(stopLoss)}.`,
    };
  }

  // Build crisp, concrete German institutional bullets
  const bullets: string[] = [];
  const emaStack =
    ema200 !== null
      ? ema20 > ema50 && ema50 > ema200
        ? "bullisch gestaffelt (EMA20 > EMA50 > EMA200)"
        : ema20 < ema50 && ema50 < ema200
          ? "bärisch gestaffelt (EMA20 < EMA50 < EMA200)"
          : "gemischt (Übergangsphase)"
      : ema20 > ema50
        ? "kurzfristig bullisch (EMA20 > EMA50)"
        : "kurzfristig bärisch (EMA20 < EMA50)";

  bullets.push(
    `Marktstruktur: ${regimeLabel}${structureBreak ? ` · Letztes Signal: ${structureBreak.kind} ${structureBreak.direction === "bullish" ? "nach oben" : "nach unten"} bei $${fmtPrice(structureBreak.price)}` : ""}.`,
  );
  bullets.push(
    `Trend & Momentum: EMAs ${emaStack} · RSI(14) bei ${rsi14.toFixed(1)}${rsiDivergence ? ` (${rsiDivergence === "bullish" ? "Bullische" : "Bärische"} Divergenz!)` : ""} · ATR(14) ${atrPct.toFixed(2)}% (${volatilityRegime === "compression" ? "Vol-Kompression / Ausbruchs-Setup" : volatilityRegime === "expansion" ? "Erhöhte Volatilität" : "Normale Volatilität"}).`,
  );

  const keySummaryParts: string[] = [];
  if (keySup) keySummaryParts.push(`Support $${fmtPrice(keySup.price)} (${keySup.touches}×)`);
  if (keyRes) keySummaryParts.push(`Resistance $${fmtPrice(keyRes.price)} (${keyRes.touches}×)`);
  if (volumePoc !== null) keySummaryParts.push(`Volume POC $${fmtPrice(volumePoc)}`);
  if (obZones.length) keySummaryParts.push(`${obZones.length} aktive OB-Zone${obZones.length > 1 ? "n" : ""}`);
  if (fvgZones.length) keySummaryParts.push(`${fvgZones.length} offene FVG`);
  if (keySummaryParts.length) {
    bullets.push(`Schlüsselzonen: ${keySummaryParts.join(" · ")}.`);
  }

  if (patterns.length) {
    const pNames = [...new Set(patterns.map((p) => p.name))].slice(0, 3).join(", ");
    bullets.push(`Erkannte Muster: ${pNames}.`);
  }
  if (optionsConfluence) {
    bullets.push(optionsConfluence);
  }

  const headline =
    bias === "bullish"
      ? `Bullisches Setup (${confidence}% Konfluenz) — Fokus auf Demand/Support-Pullbacks Richtung $${fmtPrice(tradePlan.target1)}`
      : bias === "bearish"
        ? `Bärisches Setup (${confidence}% Konfluenz) — Fokus auf Supply/Resistance-Retests Richtung $${fmtPrice(tradePlan.target1)}`
        : `Neutrale Range (${confidence}% Konfluenz) — Ausbruch über ${keyRes ? `$${fmtPrice(keyRes.price)}` : "Widerstand"} oder unter ${keySup ? `$${fmtPrice(keySup.price)}` : "Support"} abwarten`;

  return {
    symbol: params.symbol,
    timeframe: params.timeframe,
    analyzedAt: now,
    barCount: windowBars.length,
    lastPrice,
    bias,
    confidence,
    regimeLabel,
    ema20,
    ema50,
    ema200,
    rsi14,
    rsiDivergence,
    atr14,
    atrPct,
    volatilityRegime,
    volumePoc,
    swings,
    structureBreak,
    trendlines,
    zones,
    levels,
    patterns,
    headline,
    bullets,
    optionsConfluence,
    tradePlan,
  };
}

/**
 * Converts an AI Chart Analysis report into clean, non-cluttered Vela canvas overlay primitives
 * (Supply/Demand & FVG boxes, Trendlines, BOS/CHoCH breaks, Swing Markers, Key S/R & POC, Fib Golden Pocket, and Trade Setup lines).
 */
export function buildAiAnalysisOverlays(
  report: AiChartAnalysisReport,
  layers: AiAnalysisLayerConfig = DEFAULT_AI_ANALYSIS_LAYERS,
): OverlayPrimitive[] {
  const primitives: OverlayPrimitive[] = [];

  // 1. Institutional Zones (Order Blocks, Unfilled FVGs, Fib Golden Pocket)
  for (const z of report.zones) {
    if (z.kind === "golden-pocket" && !layers.fib) continue;
    if (z.kind !== "golden-pocket" && !layers.zones) continue;

    const palette =
      z.kind === "demand"
        ? { fill: "rgba(34, 197, 94, 0.14)", stroke: "#22c55e" }
        : z.kind === "supply"
          ? { fill: "rgba(239, 68, 68, 0.14)", stroke: "#ef4444" }
          : z.kind === "fvg-bull"
            ? { fill: "rgba(56, 189, 248, 0.13)", stroke: "#38bdf8" }
            : z.kind === "fvg-bear"
              ? { fill: "rgba(251, 146, 60, 0.13)", stroke: "#fb923c" }
              : { fill: "rgba(255, 184, 77, 0.11)", stroke: "#f59e0b" };

    const box: OverlayBox = {
      kind: "box",
      time1: z.startTime,
      time2: Number.POSITIVE_INFINITY, // Extends cleanly to right chart edge
      price1: z.high,
      price2: z.low,
      fill: palette.fill,
      stroke: palette.stroke,
      label: z.label,
    };
    primitives.push(box);
  }

  // 2. Market Structure (BOS / CHoCH + Trendlines + Key Swing Markers)
  if (layers.structure) {
    if (report.structureBreak) {
      const sb = report.structureBreak;
      const seg: OverlaySegment = {
        kind: "segment",
        from: { time: sb.fromTime, price: sb.price },
        to: { time: sb.toTime, price: sb.price },
        color: sb.direction === "bullish" ? "#22c55e" : "#ef4444",
        width: 2,
        dash: [5, 4],
        label: `${sb.kind} ${sb.direction === "bullish" ? "↑" : "↓"}`,
      };
      primitives.push(seg);
    }

    for (const tl of report.trendlines) {
      const seg: OverlaySegment = {
        kind: "segment",
        from: { time: tl.fromTime, price: tl.fromPrice },
        to: { time: tl.toTime, price: tl.toPrice },
        color: tl.kind === "support" ? "#34d399" : "#f87171",
        width: 1.75,
        dash: [],
        label: tl.label,
      };
      primitives.push(seg);
    }

    // Last 5 labeled swings (HH/HL/LH/LL)
    for (const s of report.swings.slice(-5)) {
      if (!s.tag) continue;
      const marker: OverlayMarker = {
        kind: "marker",
        time: s.time,
        price: s.price,
        shape: s.kind === "high" ? "triangleDown" : "triangleUp",
        color: s.tag === "HH" || s.tag === "HL" ? "#22c55e" : "#ef4444",
        label: s.tag,
        position: s.kind === "high" ? "above" : "below",
      };
      primitives.push(marker);
    }
  }

  // 3. Key S/R Levels, Liquidity Pools (BSL / SSL), and Volume POC
  if (layers.levels) {
    for (const lvl of report.levels) {
      if ((lvl.kind === "bsl" || lvl.kind === "ssl") && lvl.startTime !== undefined) {
        const seg: OverlaySegment = {
          kind: "segment",
          from: { time: lvl.startTime, price: lvl.price },
          to: { time: Number.POSITIVE_INFINITY, price: lvl.price },
          color: "#eab308",
          width: 1.25,
          dash: [3, 3],
          label: lvl.label,
        };
        primitives.push(seg);
        continue;
      }

      const color =
        lvl.kind === "resistance" ? "#f87171" : lvl.kind === "support" ? "#4ade80" : "#94a3b8";
      const hline: OverlayHLine = {
        kind: "hline",
        id: lvl.id,
        price: lvl.price,
        color,
        width: lvl.kind === "poc" ? 1 : 1.5,
        dash: lvl.kind === "poc" ? [2, 4] : [6, 4],
        label: lvl.label,
      };
      primitives.push(hline);
    }
  }

  // 4. Trade Setup Lines (Entry, Stop-Loss, TP1, TP2)
  if (layers.tradePlan && report.tradePlan) {
    const plan = report.tradePlan;
    primitives.push(
      {
        kind: "hline",
        id: "ai-plan-entry",
        price: plan.entryMid,
        color: "#ff9e00",
        width: 1.75,
        dash: [],
        label: `AI ENTRY (${plan.direction === "long" ? "LONG" : "SHORT"}) $${fmtPrice(plan.entryMid)}`,
      },
      {
        kind: "hline",
        id: "ai-plan-sl",
        price: plan.stopLoss,
        color: "#ef4444",
        width: 1.5,
        dash: [4, 3],
        label: `AI STOP $${fmtPrice(plan.stopLoss)}`,
      },
      {
        kind: "hline",
        id: "ai-plan-tp1",
        price: plan.target1,
        color: "#22c55e",
        width: 1.5,
        dash: [4, 3],
        label: `AI TP1 $${fmtPrice(plan.target1)} (${plan.riskReward1.toFixed(1)}R)`,
      },
      {
        kind: "hline",
        id: "ai-plan-tp2",
        price: plan.target2,
        color: "#10b981",
        width: 1.25,
        dash: [2, 4],
        label: `AI TP2 $${fmtPrice(plan.target2)} (${plan.riskReward2.toFixed(1)}R)`,
      },
    );
  }

  return primitives;
}
