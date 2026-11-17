import { describe, expect, it } from "vitest";
import { candleRecoveryPlan, mergeRecoveredCandles, RecoveryUnavailableError } from "@/lib/market/candleRecovery";
const start = Date.UTC(2026, 9, 27, 8);
const bar = (time: number, close = 100) => ({ time, open: 100, high: Math.max(100, close), low: Math.min(100, close), close, volume: 1 });

describe("candle recovery windows", () => {
  it("includes the interrupted bucket and every following minute", () => {
    expect(candleRecoveryPlan("1m", start + 30000, start + 180000)).toEqual({ anchor: start, target: start + 180000, count: 5, capped: false });
  });
  it("counts monthly boundaries across February rather than dividing by thirty days", () => {
    const from = Date.UTC(2024, 0, 1), now = Date.UTC(2024, 2, 1);
    expect(candleRecoveryPlan("1M", from, now)).toMatchObject({ anchor: from, target: now, count: 4, capped: false });
  });
  it("detects provider retention limits without inventing missing buckets", () => {
    expect(candleRecoveryPlan("1m", start, start + 5000 * 60000)).toMatchObject({ count: 5000, capped: true });
  });
  it.each([["100T", start, start], ["bad", start, start], ["1m", 0, start], ["1m", NaN, start], ["1m", start + 1, start]])(
    "rejects an invalid recovery request %s/%s/%s", (timeframe, from, now) => {
      expect(() => candleRecoveryPlan(String(timeframe), Number(from), Number(now))).toThrow("Invalid");
    });
  it("repairs the provider window while retaining earlier history and later live data", () => {
    const current = [bar(start - 60000), bar(start, 99), bar(start + 180000, 105)];
    const history = [bar(start, 101), bar(start + 60000, 102), bar(start + 120000, 103)];
    const result = mergeRecoveredCandles(current, history, start, 10);
    expect(result.map(value => value.close)).toEqual([100, 101, 102, 103, 105]);
    expect(current[1].close).toBe(99);
  });
  it("does not pad a venue's absent buckets", () => {
    expect(mergeRecoveredCandles([], [bar(start), bar(start + 180000)], start, 10)).toHaveLength(2);
  });
  it("rejects an uncovered interruption anchor", () => {
    expect(() => mergeRecoveredCandles([], [bar(start + 60000)], start, 10)).toThrow(RecoveryUnavailableError);
  });
  it("bounds the merged history", () => {
    expect(mergeRecoveredCandles([bar(start - 60000)], [bar(start), bar(start + 60000)], start, 2).map(value => value.time))
      .toEqual([start, start + 60000]);
  });
});
