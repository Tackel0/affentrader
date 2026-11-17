import type { OHLCV } from "@/types/trading";

/**
 * Pure technical-analysis library. Every function takes and returns arrays
 * aligned one-to-one with the input bars; warm-up values are NaN. It powers
 * derived indicators, technical/composite alerts, screeners and patterns, none
 * of which can lean on Vela's chart-bound indicator engine.
 */
export type Series = number[];
export type PriceSource =
  | "close"
  | "open"
  | "high"
  | "low"
  | "hl2"
  | "hlc3"
  | "ohlc4"
  | "volume";

export const nanSeries = (length: number): Series =>
  new Array<number>(length).fill(Number.NaN);

export function source(bars: readonly OHLCV[], kind: PriceSource): Series {
  return bars.map((b) => {
    switch (kind) {
      case "open":
        return b.open;
      case "high":
        return b.high;
      case "low":
        return b.low;
      case "hl2":
        return (b.high + b.low) / 2;
      case "hlc3":
        return (b.high + b.low + b.close) / 3;
      case "ohlc4":
        return (b.open + b.high + b.low + b.close) / 4;
      case "volume":
        return b.volume;
      default:
        return b.close;
    }
  });
}

export function sma(values: Series, length: number): Series {
  const out = nanSeries(values.length);
  if (length < 1) return out;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      sum += v;
      count++;
    }
    const old = i - length;
    if (old >= 0 && Number.isFinite(values[old])) {
      sum -= values[old];
      count--;
    }
    if (count === length) out[i] = sum / length;
  }
  return out;
}

export function ema(values: Series, length: number): Series {
  const out = nanSeries(values.length);
  if (length < 1) return out;
  const alpha = 2 / (length + 1);
  let previous = Number.NaN;
  let seed = 0;
  let seeded = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      out[i] = previous;
      continue;
    }
    if (Number.isNaN(previous)) {
      seed += v;
      seeded++;
      if (seeded === length) {
        previous = seed / length;
        out[i] = previous;
      }
    } else {
      previous = alpha * v + (1 - alpha) * previous;
      out[i] = previous;
    }
  }
  return out;
}

/** Wilder's smoothing (RMA), used by RSI, ATR and ADX. */
export function rma(values: Series, length: number): Series {
  const out = nanSeries(values.length);
  if (length < 1) return out;
  let previous = Number.NaN;
  let seed = 0;
  let seeded = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      out[i] = previous;
      continue;
    }
    if (Number.isNaN(previous)) {
      seed += v;
      seeded++;
      if (seeded === length) {
        previous = seed / length;
        out[i] = previous;
      }
    } else {
      previous = (previous * (length - 1) + v) / length;
      out[i] = previous;
    }
  }
  return out;
}

export function wma(values: Series, length: number): Series {
  const out = nanSeries(values.length);
  if (length < 1) return out;
  const denominator = (length * (length + 1)) / 2;
  for (let i = length - 1; i < values.length; i++) {
    let sum = 0;
    let valid = true;
    for (let j = 0; j < length; j++) {
      const v = values[i - length + 1 + j];
      if (!Number.isFinite(v)) {
        valid = false;
        break;
      }
      sum += v * (j + 1);
    }
    if (valid) out[i] = sum / denominator;
  }
  return out;
}

export function hma(values: Series, length: number): Series {
  const half = Math.max(1, Math.floor(length / 2));
  const root = Math.max(1, Math.round(Math.sqrt(length)));
  const a = wma(values, half);
  const b = wma(values, length);
  return wma(
    a.map((v, i) => 2 * v - b[i]),
    root,
  );
}

export function vwma(values: Series, volume: Series, length: number): Series {
  const weighted = sma(
    values.map((v, i) => v * volume[i]),
    length,
  );
  const base = sma(volume, length);
  return weighted.map((v, i) => (base[i] ? v / base[i] : Number.NaN));
}

export function highest(values: Series, length: number): Series {
  const out = nanSeries(values.length);
  for (let i = length - 1; i < values.length; i++) {
    let max = -Infinity;
    for (let j = i - length + 1; j <= i; j++) max = Math.max(max, values[j]);
    out[i] = Number.isFinite(max) ? max : Number.NaN;
  }
  return out;
}

export function lowest(values: Series, length: number): Series {
  const out = nanSeries(values.length);
  for (let i = length - 1; i < values.length; i++) {
    let min = Infinity;
    for (let j = i - length + 1; j <= i; j++) min = Math.min(min, values[j]);
    out[i] = Number.isFinite(min) ? min : Number.NaN;
  }
  return out;
}

export function stdev(values: Series, length: number): Series {
  const mean = sma(values, length);
  const out = nanSeries(values.length);
  for (let i = length - 1; i < values.length; i++) {
    if (!Number.isFinite(mean[i])) continue;
    let sum = 0;
    for (let j = i - length + 1; j <= i; j++) sum += (values[j] - mean[i]) ** 2;
    out[i] = Math.sqrt(sum / length);
  }
  return out;
}

export function change(values: Series, length = 1): Series {
  return values.map((v, i) => (i >= length ? v - values[i - length] : Number.NaN));
}

export function roc(values: Series, length: number): Series {
  return values.map((v, i) =>
    i >= length && values[i - length]
      ? ((v - values[i - length]) / values[i - length]) * 100
      : Number.NaN,
  );
}

export function rsi(values: Series, length: number): Series {
  const gains = values.map((v, i) =>
    i > 0 ? Math.max(0, v - values[i - 1]) : Number.NaN,
  );
  const losses = values.map((v, i) =>
    i > 0 ? Math.max(0, values[i - 1] - v) : Number.NaN,
  );
  const up = rma(gains, length);
  const down = rma(losses, length);
  return up.map((u, i) => {
    const d = down[i];
    if (!Number.isFinite(u) || !Number.isFinite(d)) return Number.NaN;
    if (d === 0) return u === 0 ? 50 : 100;
    return 100 - 100 / (1 + u / d);
  });
}

export function trueRange(bars: readonly OHLCV[]): Series {
  return bars.map((b, i) =>
    i === 0
      ? b.high - b.low
      : Math.max(
          b.high - b.low,
          Math.abs(b.high - bars[i - 1].close),
          Math.abs(b.low - bars[i - 1].close),
        ),
  );
}

export function atr(bars: readonly OHLCV[], length: number): Series {
  return rma(trueRange(bars), length);
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(
  values: Series,
  fast = 12,
  slow = 26,
  signalLength = 9,
): MacdResult {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line = fastEma.map((v, i) => v - slowEma[i]);
  const signal = ema(line, signalLength);
  return {
    macd: line,
    signal,
    histogram: line.map((v, i) => v - signal[i]),
  };
}

export interface BandResult {
  basis: Series;
  upper: Series;
  lower: Series;
}

export function bollinger(values: Series, length = 20, mult = 2): BandResult {
  const basis = sma(values, length);
  const deviation = stdev(values, length);
  return {
    basis,
    upper: basis.map((v, i) => v + mult * deviation[i]),
    lower: basis.map((v, i) => v - mult * deviation[i]),
  };
}

export function keltner(
  bars: readonly OHLCV[],
  length = 20,
  mult = 2,
  atrLength = 10,
): BandResult {
  const basis = ema(source(bars, "close"), length);
  const range = atr(bars, atrLength);
  return {
    basis,
    upper: basis.map((v, i) => v + mult * range[i]),
    lower: basis.map((v, i) => v - mult * range[i]),
  };
}

export function donchian(
  bars: readonly OHLCV[],
  length = 20,
): BandResult {
  const upper = highest(source(bars, "high"), length);
  const lower = lowest(source(bars, "low"), length);
  return {
    upper,
    lower,
    basis: upper.map((v, i) => (v + lower[i]) / 2),
  };
}

export interface StochasticResult {
  k: Series;
  d: Series;
}

export function stochastic(
  bars: readonly OHLCV[],
  kLength = 14,
  kSmoothing = 3,
  dLength = 3,
): StochasticResult {
  const high = highest(source(bars, "high"), kLength);
  const low = lowest(source(bars, "low"), kLength);
  const raw = bars.map((b, i) =>
    high[i] === low[i] ? Number.NaN : ((b.close - low[i]) / (high[i] - low[i])) * 100,
  );
  const k = sma(raw, kSmoothing);
  return { k, d: sma(k, dLength) };
}

export function cci(bars: readonly OHLCV[], length = 20): Series {
  const typical = source(bars, "hlc3");
  const mean = sma(typical, length);
  const out = nanSeries(bars.length);
  for (let i = length - 1; i < bars.length; i++) {
    if (!Number.isFinite(mean[i])) continue;
    let deviation = 0;
    for (let j = i - length + 1; j <= i; j++)
      deviation += Math.abs(typical[j] - mean[i]);
    deviation /= length;
    out[i] = deviation ? (typical[i] - mean[i]) / (0.015 * deviation) : 0;
  }
  return out;
}

export function williamsR(bars: readonly OHLCV[], length = 14): Series {
  const high = highest(source(bars, "high"), length);
  const low = lowest(source(bars, "low"), length);
  return bars.map((b, i) =>
    high[i] === low[i] ? Number.NaN : ((high[i] - b.close) / (high[i] - low[i])) * -100,
  );
}

export function obv(bars: readonly OHLCV[]): Series {
  const out = nanSeries(bars.length);
  let total = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i > 0) {
      if (bars[i].close > bars[i - 1].close) total += bars[i].volume;
      else if (bars[i].close < bars[i - 1].close) total -= bars[i].volume;
    }
    out[i] = total;
  }
  return out;
}

export function mfi(bars: readonly OHLCV[], length = 14): Series {
  const typical = source(bars, "hlc3");
  const positive = nanSeries(bars.length);
  const negative = nanSeries(bars.length);
  for (let i = 1; i < bars.length; i++) {
    const flow = typical[i] * bars[i].volume;
    positive[i] = typical[i] > typical[i - 1] ? flow : 0;
    negative[i] = typical[i] < typical[i - 1] ? flow : 0;
  }
  const up = sma(positive, length);
  const down = sma(negative, length);
  return up.map((u, i) => {
    if (!Number.isFinite(u) || !Number.isFinite(down[i])) return Number.NaN;
    if (down[i] === 0) return 100;
    return 100 - 100 / (1 + u / down[i]);
  });
}

export function cmf(bars: readonly OHLCV[], length = 20): Series {
  const multiplier = bars.map((b) =>
    b.high === b.low
      ? 0
      : ((b.close - b.low - (b.high - b.close)) / (b.high - b.low)) * b.volume,
  );
  const flow = sma(multiplier, length);
  const volume = sma(source(bars, "volume"), length);
  return flow.map((v, i) => (volume[i] ? v / volume[i] : Number.NaN));
}

export interface AdxResult {
  adx: Series;
  plusDi: Series;
  minusDi: Series;
}

export function adx(bars: readonly OHLCV[], length = 14): AdxResult {
  const plusDm = nanSeries(bars.length);
  const minusDm = nanSeries(bars.length);
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const down = bars[i - 1].low - bars[i].low;
    plusDm[i] = up > down && up > 0 ? up : 0;
    minusDm[i] = down > up && down > 0 ? down : 0;
  }
  const range = rma(trueRange(bars), length);
  const plusSmooth = rma(plusDm, length);
  const minusSmooth = rma(minusDm, length);
  const plusDi = plusSmooth.map((v, i) => (range[i] ? (100 * v) / range[i] : Number.NaN));
  const minusDi = minusSmooth.map((v, i) => (range[i] ? (100 * v) / range[i] : Number.NaN));
  const dx = plusDi.map((p, i) => {
    const total = p + minusDi[i];
    return total ? (100 * Math.abs(p - minusDi[i])) / total : Number.NaN;
  });
  return { adx: rma(dx, length), plusDi, minusDi };
}

/** Volume-weighted average price, reset at every UTC day boundary. */
export function vwap(bars: readonly OHLCV[]): Series {
  const out = nanSeries(bars.length);
  let day = -1;
  let priceVolume = 0;
  let volume = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const currentDay = Math.floor(bar.time / 86_400_000);
    if (currentDay !== day) {
      day = currentDay;
      priceVolume = 0;
      volume = 0;
    }
    const price = (bar.high + bar.low + bar.close) / 3;
    priceVolume += price * bar.volume;
    volume += bar.volume;
    out[i] = volume ? priceVolume / volume : price;
  }
  return out;
}

export interface SupertrendResult {
  line: Series;
  /** 1 while price is above the line, -1 below. */
  direction: Series;
}

export function supertrend(
  bars: readonly OHLCV[],
  length = 10,
  mult = 3,
): SupertrendResult {
  const range = atr(bars, length);
  const line = nanSeries(bars.length);
  const direction = nanSeries(bars.length);
  let upper = Number.NaN;
  let lower = Number.NaN;
  let trend = 1;
  for (let i = 0; i < bars.length; i++) {
    if (!Number.isFinite(range[i])) continue;
    const middle = (bars[i].high + bars[i].low) / 2;
    const basicUpper = middle + mult * range[i];
    const basicLower = middle - mult * range[i];
    const previousClose = i > 0 ? bars[i - 1].close : bars[i].close;
    upper =
      Number.isNaN(upper) || basicUpper < upper || previousClose > upper
        ? basicUpper
        : upper;
    lower =
      Number.isNaN(lower) || basicLower > lower || previousClose < lower
        ? basicLower
        : lower;
    if (trend === 1 && bars[i].close < lower) trend = -1;
    else if (trend === -1 && bars[i].close > upper) trend = 1;
    line[i] = trend === 1 ? lower : upper;
    direction[i] = trend;
  }
  return { line, direction };
}

export function parabolicSar(
  bars: readonly OHLCV[],
  start = 0.02,
  increment = 0.02,
  maximum = 0.2,
): Series {
  const out = nanSeries(bars.length);
  if (bars.length < 2) return out;
  let rising = bars[1].close >= bars[0].close;
  let sar = rising ? bars[0].low : bars[0].high;
  let extreme = rising ? bars[1].high : bars[1].low;
  let factor = start;
  out[1] = sar;
  for (let i = 2; i < bars.length; i++) {
    sar = sar + factor * (extreme - sar);
    if (rising) {
      sar = Math.min(sar, bars[i - 1].low, bars[i - 2].low);
      if (bars[i].low < sar) {
        rising = false;
        sar = extreme;
        extreme = bars[i].low;
        factor = start;
      } else if (bars[i].high > extreme) {
        extreme = bars[i].high;
        factor = Math.min(maximum, factor + increment);
      }
    } else {
      sar = Math.max(sar, bars[i - 1].high, bars[i - 2].high);
      if (bars[i].high > sar) {
        rising = true;
        sar = extreme;
        extreme = bars[i].high;
        factor = start;
      } else if (bars[i].low < extreme) {
        extreme = bars[i].low;
        factor = Math.min(maximum, factor + increment);
      }
    }
    out[i] = sar;
  }
  return out;
}

export interface IchimokuResult {
  conversion: Series;
  base: Series;
  spanA: Series;
  spanB: Series;
}

export function ichimoku(
  bars: readonly OHLCV[],
  conversionLength = 9,
  baseLength = 26,
  spanBLength = 52,
): IchimokuResult {
  const high = source(bars, "high");
  const low = source(bars, "low");
  const mid = (length: number) => {
    const h = highest(high, length);
    const l = lowest(low, length);
    return h.map((v, i) => (v + l[i]) / 2);
  };
  const conversion = mid(conversionLength);
  const base = mid(baseLength);
  return {
    conversion,
    base,
    spanA: conversion.map((v, i) => (v + base[i]) / 2),
    spanB: mid(spanBLength),
  };
}

function crossPoints(a: Series, b: Series | number, index: number) {
  if (index < 1 || index >= a.length) return null;
  const current = typeof b === "number" ? b : b[index];
  const previous = typeof b === "number" ? b : b[index - 1];
  const values = [a[index - 1], a[index], previous, current];
  return values.every(Number.isFinite)
    ? { a0: a[index - 1], a1: a[index], b0: previous, b1: current }
    : null;
}

export function crossover(a: Series, b: Series | number, index: number): boolean {
  const p = crossPoints(a, b, index);
  return p !== null && p.a0 <= p.b0 && p.a1 > p.b1;
}

export function crossunder(a: Series, b: Series | number, index: number): boolean {
  const p = crossPoints(a, b, index);
  return p !== null && p.a0 >= p.b0 && p.a1 < p.b1;
}

export interface Pivot {
  index: number;
  price: number;
  kind: "high" | "low";
}

/** Confirmed swing points (needs `right` bars after the pivot to confirm). */
export function pivots(
  bars: readonly OHLCV[],
  left = 5,
  right = 5,
): Pivot[] {
  const found: Pivot[] = [];
  for (let i = left; i < bars.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    // Ties on the left are tolerated, so a flat top picks its last bar and a
    // plateau never hides a swing point.
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      const tie = j < i;
      if (tie ? bars[j].high > bars[i].high : bars[j].high >= bars[i].high)
        isHigh = false;
      if (tie ? bars[j].low < bars[i].low : bars[j].low <= bars[i].low)
        isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) found.push({ index: i, price: bars[i].high, kind: "high" });
    if (isLow) found.push({ index: i, price: bars[i].low, kind: "low" });
  }
  return found.sort((a, b) => a.index - b.index);
}

export interface Plot {
  id: string;
  title: string;
  values: Series;
  style?: "line" | "histogram" | "step";
}

export interface TaOutput {
  overlay: boolean;
  plots: Plot[];
}

export interface TaParameterDefinition {
  key: string;
  label: string;
  defval: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface TaIndicator {
  id: string;
  name: string;
  shortName: string;
  category: "Trend" | "Momentum" | "Volatility" | "Volume";
  parameters: TaParameterDefinition[];
  /** True when the study can consume another series (it only needs one input). */
  sourceable: boolean;
  compute: (
    bars: readonly OHLCV[],
    params: Record<string, number>,
    input?: Series,
  ) => TaOutput;
}

const length = (defval: number, label = "Length", min = 1, max = 500): TaParameterDefinition => ({
  key: "length",
  label,
  defval,
  min,
  max,
  step: 1,
});

const single = (
  id: string,
  name: string,
  shortName: string,
  category: TaIndicator["category"],
  overlay: boolean,
  defval: number,
  fn: (values: Series, len: number) => Series,
  style: Plot["style"] = "line",
): TaIndicator => ({
  id,
  name,
  shortName,
  category,
  parameters: [length(defval)],
  sourceable: true,
  compute: (bars, params, input) => ({
    overlay,
    plots: [
      {
        id,
        title: shortName,
        values: fn(input ?? source(bars, "close"), params.length ?? defval),
        style,
      },
    ],
  }),
});

export const TA_INDICATORS: TaIndicator[] = [
  single("sma", "Simple Moving Average", "SMA", "Trend", true, 20, sma),
  single("ema", "Exponential Moving Average", "EMA", "Trend", true, 20, ema),
  single("wma", "Weighted Moving Average", "WMA", "Trend", true, 20, wma),
  single("hma", "Hull Moving Average", "HMA", "Trend", true, 20, hma),
  single("rma", "Smoothed Moving Average", "RMA", "Trend", true, 14, rma),
  single("rsi", "Relative Strength Index", "RSI", "Momentum", false, 14, rsi),
  single("roc", "Rate of Change", "ROC", "Momentum", false, 9, roc),
  single("stdev", "Standard Deviation", "StDev", "Volatility", false, 20, stdev),
  single("highest", "Highest Value", "Highest", "Trend", true, 20, highest),
  single("lowest", "Lowest Value", "Lowest", "Trend", true, 20, lowest),
  {
    id: "macd",
    name: "MACD",
    shortName: "MACD",
    category: "Momentum",
    parameters: [
      { key: "fast", label: "Fast length", defval: 12, min: 1, max: 200, step: 1 },
      { key: "slow", label: "Slow length", defval: 26, min: 1, max: 400, step: 1 },
      { key: "signal", label: "Signal length", defval: 9, min: 1, max: 200, step: 1 },
    ],
    sourceable: true,
    compute: (bars, params, input) => {
      const result = macd(
        input ?? source(bars, "close"),
        params.fast ?? 12,
        params.slow ?? 26,
        params.signal ?? 9,
      );
      return {
        overlay: false,
        plots: [
          { id: "macd", title: "MACD", values: result.macd },
          { id: "signal", title: "Signal", values: result.signal },
          {
            id: "histogram",
            title: "Histogram",
            values: result.histogram,
            style: "histogram",
          },
        ],
      };
    },
  },
  {
    id: "bollinger",
    name: "Bollinger Bands",
    shortName: "BB",
    category: "Volatility",
    parameters: [
      length(20),
      { key: "mult", label: "Multiplier", defval: 2, min: 0.1, max: 10, step: 0.1 },
    ],
    sourceable: true,
    compute: (bars, params, input) => {
      const result = bollinger(
        input ?? source(bars, "close"),
        params.length ?? 20,
        params.mult ?? 2,
      );
      return {
        overlay: !input,
        plots: [
          { id: "basis", title: "Basis", values: result.basis },
          { id: "upper", title: "Upper", values: result.upper },
          { id: "lower", title: "Lower", values: result.lower },
        ],
      };
    },
  },
  {
    id: "keltner",
    name: "Keltner Channels",
    shortName: "KC",
    category: "Volatility",
    parameters: [
      length(20),
      { key: "mult", label: "Multiplier", defval: 2, min: 0.1, max: 10, step: 0.1 },
      { key: "atrLength", label: "ATR length", defval: 10, min: 1, max: 200, step: 1 },
    ],
    sourceable: false,
    compute: (bars, params) => {
      const result = keltner(bars, params.length ?? 20, params.mult ?? 2, params.atrLength ?? 10);
      return {
        overlay: true,
        plots: [
          { id: "basis", title: "Basis", values: result.basis },
          { id: "upper", title: "Upper", values: result.upper },
          { id: "lower", title: "Lower", values: result.lower },
        ],
      };
    },
  },
  {
    id: "donchian",
    name: "Donchian Channels",
    shortName: "DC",
    category: "Volatility",
    parameters: [length(20)],
    sourceable: false,
    compute: (bars, params) => {
      const result = donchian(bars, params.length ?? 20);
      return {
        overlay: true,
        plots: [
          { id: "upper", title: "Upper", values: result.upper },
          { id: "basis", title: "Basis", values: result.basis },
          { id: "lower", title: "Lower", values: result.lower },
        ],
      };
    },
  },
  {
    id: "atr",
    name: "Average True Range",
    shortName: "ATR",
    category: "Volatility",
    parameters: [length(14)],
    sourceable: false,
    compute: (bars, params) => ({
      overlay: false,
      plots: [{ id: "atr", title: "ATR", values: atr(bars, params.length ?? 14) }],
    }),
  },
  {
    id: "stochastic",
    name: "Stochastic Oscillator",
    shortName: "Stoch",
    category: "Momentum",
    parameters: [
      { key: "kLength", label: "%K length", defval: 14, min: 1, max: 200, step: 1 },
      { key: "kSmoothing", label: "%K smoothing", defval: 3, min: 1, max: 50, step: 1 },
      { key: "dLength", label: "%D length", defval: 3, min: 1, max: 50, step: 1 },
    ],
    sourceable: false,
    compute: (bars, params) => {
      const result = stochastic(
        bars,
        params.kLength ?? 14,
        params.kSmoothing ?? 3,
        params.dLength ?? 3,
      );
      return {
        overlay: false,
        plots: [
          { id: "k", title: "%K", values: result.k },
          { id: "d", title: "%D", values: result.d },
        ],
      };
    },
  },
  {
    id: "cci",
    name: "Commodity Channel Index",
    shortName: "CCI",
    category: "Momentum",
    parameters: [length(20)],
    sourceable: false,
    compute: (bars, params) => ({
      overlay: false,
      plots: [{ id: "cci", title: "CCI", values: cci(bars, params.length ?? 20) }],
    }),
  },
  {
    id: "williams-r",
    name: "Williams %R",
    shortName: "%R",
    category: "Momentum",
    parameters: [length(14)],
    sourceable: false,
    compute: (bars, params) => ({
      overlay: false,
      plots: [{ id: "wr", title: "%R", values: williamsR(bars, params.length ?? 14) }],
    }),
  },
  {
    id: "mfi",
    name: "Money Flow Index",
    shortName: "MFI",
    category: "Volume",
    parameters: [length(14)],
    sourceable: false,
    compute: (bars, params) => ({
      overlay: false,
      plots: [{ id: "mfi", title: "MFI", values: mfi(bars, params.length ?? 14) }],
    }),
  },
  {
    id: "cmf",
    name: "Chaikin Money Flow",
    shortName: "CMF",
    category: "Volume",
    parameters: [length(20)],
    sourceable: false,
    compute: (bars, params) => ({
      overlay: false,
      plots: [{ id: "cmf", title: "CMF", values: cmf(bars, params.length ?? 20) }],
    }),
  },
  {
    id: "obv",
    name: "On Balance Volume",
    shortName: "OBV",
    category: "Volume",
    parameters: [],
    sourceable: false,
    compute: (bars) => ({
      overlay: false,
      plots: [{ id: "obv", title: "OBV", values: obv(bars) }],
    }),
  },
  {
    id: "vwap",
    name: "Session VWAP",
    shortName: "VWAP",
    category: "Volume",
    parameters: [],
    sourceable: false,
    compute: (bars) => ({
      overlay: true,
      plots: [{ id: "vwap", title: "VWAP", values: vwap(bars) }],
    }),
  },
  {
    id: "adx",
    name: "Average Directional Index",
    shortName: "ADX",
    category: "Trend",
    parameters: [length(14)],
    sourceable: false,
    compute: (bars, params) => {
      const result = adx(bars, params.length ?? 14);
      return {
        overlay: false,
        plots: [
          { id: "adx", title: "ADX", values: result.adx },
          { id: "plus", title: "+DI", values: result.plusDi },
          { id: "minus", title: "-DI", values: result.minusDi },
        ],
      };
    },
  },
  {
    id: "supertrend",
    name: "Supertrend",
    shortName: "Supertrend",
    category: "Trend",
    parameters: [
      length(10, "ATR length"),
      { key: "mult", label: "Multiplier", defval: 3, min: 0.1, max: 20, step: 0.1 },
    ],
    sourceable: false,
    compute: (bars, params) => ({
      overlay: true,
      plots: [
        {
          id: "supertrend",
          title: "Supertrend",
          values: supertrend(bars, params.length ?? 10, params.mult ?? 3).line,
        },
      ],
    }),
  },
  {
    id: "parabolic-sar",
    name: "Parabolic SAR",
    shortName: "SAR",
    category: "Trend",
    parameters: [
      { key: "start", label: "Start", defval: 0.02, min: 0.001, max: 1, step: 0.001 },
      { key: "increment", label: "Increment", defval: 0.02, min: 0.001, max: 1, step: 0.001 },
      { key: "maximum", label: "Maximum", defval: 0.2, min: 0.01, max: 1, step: 0.01 },
    ],
    sourceable: false,
    compute: (bars, params) => ({
      overlay: true,
      plots: [
        {
          id: "sar",
          title: "SAR",
          values: parabolicSar(
            bars,
            params.start ?? 0.02,
            params.increment ?? 0.02,
            params.maximum ?? 0.2,
          ),
        },
      ],
    }),
  },
  {
    id: "ichimoku",
    name: "Ichimoku Cloud",
    shortName: "Ichimoku",
    category: "Trend",
    parameters: [
      { key: "conversion", label: "Conversion length", defval: 9, min: 1, max: 200, step: 1 },
      { key: "base", label: "Base length", defval: 26, min: 1, max: 200, step: 1 },
      { key: "spanB", label: "Span B length", defval: 52, min: 1, max: 400, step: 1 },
    ],
    sourceable: false,
    compute: (bars, params) => {
      const result = ichimoku(
        bars,
        params.conversion ?? 9,
        params.base ?? 26,
        params.spanB ?? 52,
      );
      return {
        overlay: true,
        plots: [
          { id: "conversion", title: "Conversion", values: result.conversion },
          { id: "base", title: "Base", values: result.base },
          { id: "spanA", title: "Span A", values: result.spanA },
          { id: "spanB", title: "Span B", values: result.spanB },
        ],
      };
    },
  },
  {
    id: "volume-ma",
    name: "Volume Moving Average",
    shortName: "Vol MA",
    category: "Volume",
    parameters: [length(20)],
    sourceable: false,
    compute: (bars, params) => ({
      overlay: false,
      plots: [
        {
          id: "volume-ma",
          title: "Vol MA",
          values: sma(source(bars, "volume"), params.length ?? 20),
        },
      ],
    }),
  },
];

export function findTaIndicator(id: string): TaIndicator | undefined {
  return TA_INDICATORS.find((i) => i.id === id);
}

export function defaultParameters(indicator: TaIndicator): Record<string, number> {
  return Object.fromEntries(indicator.parameters.map((p) => [p.key, p.defval]));
}

/** Last finite value of a series, or NaN. */
export function lastValue(values: Series): number {
  for (let i = values.length - 1; i >= 0; i--)
    if (Number.isFinite(values[i])) return values[i];
  return Number.NaN;
}
