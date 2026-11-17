import { describe, expect, it } from "vitest";
import {
  adx,
  atr,
  bollinger,
  crossover,
  crossunder,
  defaultParameters,
  ema,
  findTaIndicator,
  highest,
  lastValue,
  lowest,
  macd,
  obv,
  pivots,
  rma,
  rsi,
  sma,
  source,
  stochastic,
  supertrend,
  TA_INDICATORS,
  vwap,
  wma,
} from "@/lib/ta";
import type { OHLCV } from "@/types/trading";

const bar = (i: number, close: number, spread = 1): OHLCV => ({
  time: 1_700_000_000_000 + i * 60_000,
  open: close - 0.5,
  high: close + spread,
  low: close - spread,
  close,
  volume: 100 + i,
});
const trending = Array.from({ length: 80 }, (_, i) => bar(i, 100 + i * 0.8 + Math.sin(i / 4) * 2));

describe("moving averages", () => {
  it("computes SMA with NaN warm-up", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(out.slice(2)).toEqual([2, 3, 4]);
  });
  it("seeds EMA with the SMA and then smooths", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBe(2);
    expect(out[3]).toBeCloseTo(3, 10);
    expect(out[4]).toBeCloseTo(4, 10);
  });
  it("computes WMA weights recent values higher", () => {
    expect(wma([1, 2, 3], 3)[2]).toBeCloseTo((1 + 4 + 9) / 6, 10);
  });
  it("computes Wilder smoothing", () => {
    const out = rma([2, 4, 6, 8], 2);
    expect(out[1]).toBe(3);
    expect(out[2]).toBe(4.5);
    expect(out[3]).toBe(6.25);
  });
  it("tracks rolling extremes", () => {
    expect(highest([1, 5, 2, 4], 2).slice(1)).toEqual([5, 5, 4]);
    expect(lowest([1, 5, 2, 4], 2).slice(1)).toEqual([1, 2, 2]);
  });
});

describe("oscillators", () => {
  it("returns 100 for a monotonically rising series and 0 for a falling one", () => {
    const up = Array.from({ length: 30 }, (_, i) => 10 + i);
    const down = Array.from({ length: 30 }, (_, i) => 50 - i);
    expect(lastValue(rsi(up, 14))).toBe(100);
    expect(lastValue(rsi(down, 14))).toBe(0);
  });
  it("keeps RSI inside 0..100 on noisy data", () => {
    const values = rsi(source(trending, "close"), 14).filter(Number.isFinite);
    expect(values.length).toBeGreaterThan(40);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(100);
  });
  it("has a zero histogram when MACD equals its signal", () => {
    const flat = macd(Array.from({ length: 80 }, () => 5));
    expect(lastValue(flat.histogram)).toBeCloseTo(0, 10);
  });
  it("bounds stochastic %K between 0 and 100", () => {
    const { k } = stochastic(trending, 14, 3, 3);
    const finite = k.filter(Number.isFinite);
    expect(Math.min(...finite)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...finite)).toBeLessThanOrEqual(100);
  });
});

describe("volatility and trend", () => {
  it("brackets price with Bollinger bands", () => {
    const closes = source(trending, "close");
    const bands = bollinger(closes, 20, 2);
    const i = closes.length - 1;
    expect(bands.upper[i]).toBeGreaterThan(bands.basis[i]);
    expect(bands.lower[i]).toBeLessThan(bands.basis[i]);
  });
  it("computes ATR of constant-range bars", () => {
    const flat = Array.from({ length: 30 }, (_, i) => bar(i, 100, 1));
    expect(lastValue(atr(flat, 14))).toBeCloseTo(2, 10);
  });
  it("reports a strong ADX for a persistent trend", () => {
    const up = Array.from({ length: 120 }, (_, i) => bar(i, 100 + i * 2));
    const result = adx(up, 14);
    expect(lastValue(result.adx)).toBeGreaterThan(40);
    expect(lastValue(result.plusDi)).toBeGreaterThan(lastValue(result.minusDi));
  });
  it("keeps Supertrend below price in an uptrend", () => {
    const up = Array.from({ length: 80 }, (_, i) => bar(i, 100 + i * 2));
    const result = supertrend(up, 10, 3);
    expect(lastValue(result.direction)).toBe(1);
    expect(lastValue(result.line)).toBeLessThan(up.at(-1)!.close);
  });
});

describe("volume studies", () => {
  it("accumulates OBV by close direction", () => {
    const bars = [bar(0, 10), bar(1, 11), bar(2, 10.5)];
    expect(obv(bars)).toEqual([0, 101, 101 - 102]);
  });
  it("resets VWAP each UTC day", () => {
    const day = 86_400_000;
    const bars: OHLCV[] = [
      { time: day, open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { time: day + 1000, open: 20, high: 20, low: 20, close: 20, volume: 1 },
      { time: 2 * day, open: 30, high: 30, low: 30, close: 30, volume: 1 },
    ];
    expect(vwap(bars)).toEqual([10, 15, 30]);
  });
});

describe("crossings and pivots", () => {
  it("detects crossovers and crossunders against series and constants", () => {
    const a = [1, 2, 3, 2, 1];
    const b = [2, 2, 2, 2, 2];
    expect(crossover(a, b, 2)).toBe(true);
    expect(crossunder(a, b, 4)).toBe(true);
    expect(crossover(a, 2.5, 2)).toBe(true);
    expect(crossover(a, b, 1)).toBe(false);
    expect(crossover([Number.NaN, 3], b, 1)).toBe(false);
  });
  it("finds confirmed swing highs and lows", () => {
    const closes = [1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5];
    const bars = closes.map((c, i) => bar(i, c, 0.1));
    const found = pivots(bars, 3, 3);
    expect(found.map((p) => [p.index, p.kind])).toEqual([
      [4, "high"],
      [8, "low"],
    ]);
  });
});

describe("indicator registry", () => {
  it("computes every registered indicator with default parameters", () => {
    for (const indicator of TA_INDICATORS) {
      const output = indicator.compute(trending, defaultParameters(indicator));
      expect(output.plots.length, indicator.id).toBeGreaterThan(0);
      for (const plot of output.plots) {
        expect(plot.values, `${indicator.id}/${plot.id}`).toHaveLength(trending.length);
        expect(Number.isFinite(lastValue(plot.values)), `${indicator.id}/${plot.id}`).toBe(true);
      }
    }
  });
  it("applies a sourceable indicator to another series", () => {
    const rsiSeries = rsi(source(trending, "close"), 14);
    const smoothed = findTaIndicator("sma")!.compute(trending, { length: 5 }, rsiSeries);
    expect(lastValue(smoothed.plots[0].values)).toBeCloseTo(
      sma(rsiSeries, 5).at(-1)!,
      10,
    );
  });
});
