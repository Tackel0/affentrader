import { describe, it, expect } from "vitest";
import {
  footprints,
  tradeVolumeProfile,
  cumulativeDelta,
  tpoProfile,
} from "@/lib/orderflow/math";
import type { Tick } from "@/types/trading";
const trade = (
  id: string,
  time: number,
  price: number,
  quantity: number,
  side: "buy" | "sell",
): Tick => ({
  id,
  time,
  price,
  quantity,
  side,
  symbol: "BTCUSDT",
  simulated: false,
});
const trades = [
  trade("a", 1000, 100, 2, "buy"),
  trade("b", 2000, 100, 1, "sell"),
  trade("c", 3000, 101, 4, "buy"),
  trade("d", 61000, 100, 3, "sell"),
];
describe("honest order flow", () => {
  it("conserves buy/sell volume, delta and POC per candle", () => {
    const bars = footprints(trades, "1m", 1);
    expect(bars).toHaveLength(2);
    expect(bars[0].volume).toBe(7);
    expect(bars[0].delta).toBe(5);
    expect(bars[0].poc).toBe(101);
    expect(bars[1].delta).toBe(-3);
    expect(bars[0].levels[1].imbalance).toBe("buy");
  });
  it("returns no fake footprint history without classified trades", () => {
    expect(footprints([], "1m", 1)).toEqual([]);
    expect(cumulativeDelta([], "1m")).toEqual([]);
  });
  it("sums delta cumulatively across candles", () => {
    expect(cumulativeDelta(trades, "1m").map((x) => x.value)).toEqual([5, 2]);
  });
  it("filters profile to the explicitly requested window", () => {
    const rows = tradeVolumeProfile(trades, 1, 0, 60000);
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(7);
    expect(rows[0]).toEqual({ price: 100, buy: 2, sell: 1, total: 3 });
  });
  it("counts unique TPO periods instead of duplicate candles", () => {
    const rows = tpoProfile(
      [
        { time: 0, low: 100, high: 102 },
        { time: 60000, low: 100, high: 102 },
        { time: 1800000, low: 101, high: 102 },
      ],
      1,
    );
    expect(rows.find((r) => r.price === 100)?.periods).toEqual(["A"]);
    expect(rows.find((r) => r.price === 101)?.periods).toEqual(["A", "B"]);
  });
});
