import { describe, expect, it } from "vitest";
import { barChange, formatBarChange, type BarChange } from "@/lib/chart/barChange";
import { DEFAULT_STATUS_LINE, statusLinePreferences, validStatusLine } from "@/lib/chart/statusLine";
import type { OHLCV } from "@/types/trading";

const candle = (time: number, close: number, open = close): OHLCV => ({ time, open, close, high: Math.max(open, close), low: Math.min(open, close), volume: 1 });
const formatted = (difference: number, percent: number | null, close = 80000): BarChange => ({ difference, percent, close, previousClose: close - difference, previousTime: 0 });

describe("selected chart bar change", () => {
  it("uses the previous close rather than the current open, including gaps and opposing candle direction", () => {
    const bars = [candle(1000, 100), candle(2000, 110, 120), candle(3000, 90, 80), candle(4000, 90)];
    expect(barChange(bars, bars[1])).toMatchObject({ difference: 10, percent: 10, previousClose: 100, previousTime: 1000 });
    expect(barChange(bars, bars[2])!.difference).toBe(-20);
    expect(barChange(bars, bars[3])).toMatchObject({ difference: 0, percent: 0 });
  });

  it("keeps historical and Replay calculations independent of future closes", () => {
    const bars = [candle(1000, 100), candle(2000, 110), candle(3000, 50000)];
    expect(barChange(bars, bars[1], 2000)).toEqual(barChange(bars.slice(0, 2), bars[1], 2000));
    expect(barChange(bars, bars[2], 2000)).toBeNull();
    expect(barChange(bars, bars[1], NaN)).toBeNull();
  });

  it("does not substitute an open, first bucket, missing time or unavailable bar", () => {
    const bars = [candle(1000, 100), candle(3000, 110)];
    expect(barChange(bars, bars[0])).toBeNull();
    expect(barChange(bars, candle(2000, 105))).toBeNull();
    expect(barChange([], bars[1])).toBeNull();
    expect(barChange(bars, undefined)).toBeNull();
    expect(barChange(bars, null)).toBeNull();
    expect(barChange(bars, bars[1])).toMatchObject({ previousTime: 1000, difference: 10 });
  });

  it("handles zero and negative baselines without fabricating a percentage", () => {
    const zero = [candle(1000, 0), candle(2000, 1)];
    expect(barChange(zero, zero[1])).toMatchObject({ difference: 1, percent: null });
    const negative = [candle(1000, -100), candle(2000, -90)];
    expect(barChange(negative, negative[1])).toMatchObject({ difference: 10, percent: -10 });
  });

  it("rejects invalid and overflowing values", () => {
    expect(barChange([candle(1000, NaN), candle(2000, 5)], candle(2000, 5))).toBeNull();
    expect(barChange([candle(1000, 1), candle(2000, Infinity)], candle(2000, Infinity))).toBeNull();
    expect(barChange([candle(1000, -Number.MAX_VALUE), candle(2000, Number.MAX_VALUE)], candle(2000, Number.MAX_VALUE))).toBeNull();
    const tiny = [candle(1000, Number.MIN_VALUE), candle(2000, 1)];
    expect(barChange(tiny, tiny[1])).toMatchObject({ difference: 1, percent: null });
  });

  it("uses corrected previous candles and a selected live update without mutating history", () => {
    const bars = [candle(1000, 100), candle(2000, 110)], before = structuredClone(bars);
    expect(barChange(bars, { ...bars[1], close: 112 })!.difference).toBe(12);
    expect(bars).toEqual(before);
    const corrected = [{ ...bars[0], close: 105 }, bars[1]];
    expect(barChange(corrected, bars[1])!.difference).toBe(5);
  });

  it("formats changes with selected-price precision, independent signs and no negative rounded zero", () => {
    expect(formatBarChange(formatted(-12.3456, -0.015432))).toBe("−12.35 (−0.02%)");
    expect(formatBarChange(formatted(1.123456, 0.01, 80))).toBe("+1.1235 (+0.01%)");
    expect(formatBarChange(formatted(0.00001234, 1, 0.0004))).toBe("+0.00001234 (+1.00%)");
    expect(formatBarChange(formatted(-0.0001, -0.001))).toBe("0.00 (0.00%)");
    expect(formatBarChange(formatted(1, null))).toBe("+1.00 (—)");
  });

  it("migrates the preceding five-field display schema without discarding disabled preferences", () => {
    const { barChange: _new, ...legacy } = DEFAULT_STATUS_LINE;
    const old = { ...legacy, ohlc: false, indicatorValues: false };
    expect(validStatusLine(old)).toBe(true);
    expect(statusLinePreferences(old)).toMatchObject({ barChange: true, ohlc: false, indicatorValues: false });
    expect(statusLinePreferences({ ...old, barChange: false }).barChange).toBe(false);
    expect(validStatusLine({ ...old, barChange: "yes" })).toBe(false);
  });
});
