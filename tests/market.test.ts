import { describe, it, expect } from "vitest";
import { aggregateTick, aggregateBars } from "@/lib/market/aggregation";
import { generateHistory } from "@/lib/market/mock";
import { TIMEFRAMES, INTERVAL_MS } from "@/lib/symbols";
import type { Tick } from "@/types/trading";
const tick: Tick = {
  id: "1",
  symbol: "BTCUSDT",
  time: 1000,
  price: 100,
  quantity: 2,
  side: "buy",
  simulated: false,
};
describe("multi-resolution candles", () => {
  it.each(TIMEFRAMES)("buckets %s in epoch milliseconds", (tf) => {
    const t = { ...tick, time: Date.UTC(2026, 9, 23, 12, 37, 42) };
    const result = aggregateTick([], t, tf);
    expect(result.bars[0].time % INTERVAL_MS[tf]).toBe(0);
    expect(result.bars[0].volume).toBe(2);
  });
  it("preserves open, updates extrema and accumulates volume", () => {
    const a = aggregateTick([], tick, "1m").bars;
    const b = aggregateTick(a, { ...tick, time: 2000, price: 110 }, "1m").bars;
    const c = aggregateTick(
      b,
      { ...tick, time: 3000, price: 95, quantity: 3 },
      "1m",
    ).bars;
    expect(c).toEqual([
      { time: 0, open: 100, high: 110, low: 95, close: 95, volume: 7 },
    ]);
  });
  it("emits only completed candles and ignores out-of-order intervals", () => {
    const bars = aggregateTick([], tick, "1m").bars;
    const next = aggregateTick(
      bars,
      { ...tick, time: 60000, price: 101 },
      "1m",
    );
    expect(next.closed).toEqual(bars[0]);
    expect(next.bars).toHaveLength(2);
    expect(aggregateTick(next.bars, tick, "1m").bars).toBe(next.bars);
  });
  it("aggregates OHLCV without losing volume", () => {
    const source = generateHistory("BTCUSDT", "1m", 10, Date.UTC(2026, 9, 23));
    const bars = aggregateBars(source, "5m");
    expect(bars.reduce((s, b) => s + b.volume, 0)).toBeCloseTo(
      source.reduce((s, b) => s + b.volume, 0),
      8,
    );
    expect(bars[0].open).toBe(source[0].open);
    expect(bars.at(-1)?.close).toBe(source.at(-1)?.close);
  });
  it("generates deterministic valid simulation history", () => {
    const bars = generateHistory("BTCUSDT", "15m", 600, 1000000000);
    expect(bars).toEqual(generateHistory("BTCUSDT", "15m", 600, 1000000000));
    for (const b of bars) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
      expect(b.volume).toBeGreaterThan(0);
      expect(b.low).toBeGreaterThan(0);
    }
  });
});
