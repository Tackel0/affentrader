import { describe, expect, it } from "vitest";
import { footprints, priceStep, tradeVolumeProfile } from "@/lib/orderflow/math";
import { footprintStacks } from "@/lib/orderflow/footprintAnalysis";
import { executionPriceGrid } from "@/lib/orderflow/priceGrid";
import { clearDerivedIssue, derivedRenderIssue, runDerivedPaint } from "@/lib/chart/derivedRenderState";
import type { Tick } from "@/types/trading";

const tick = (price: number, quantity = 1, side: "buy" | "sell" = "buy", time = 1000): Tick =>
  ({ id: `${price}-${side}-${time}`, symbol: "BTCUSDT", price, quantity, side, time, simulated: false });

describe("execution price-grid integrity", () => {
  it("uses canonical decimal powers for automatic resolution, including very low-priced markets", () => {
    expect(priceStep(.3)).toBe(1e-7); expect(priceStep(3e-12)).toBe(1e-18);
    expect(priceStep(100000)).toBe(.1); expect(priceStep(Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
    for (const price of [NaN, Infinity, 0, -1]) expect(priceStep(price)).toBe(1e-8);
  });
  it("supports decimal quarter ticks and floors negative prices mathematically", () => {
    const grid = executionPriceGrid(.25);
    expect([1.25, 1.2499999999999998, -.1, -.25, -.25000000000000006].map(price => grid.index(price))).toEqual([5, 4, -1, -1, -2]);
    expect(grid.row(-1)).toEqual({ index: -1, lower: -.25, upper: 0, center: -.125 });
    expect(executionPriceGrid(Number.MIN_VALUE).row(1)).toMatchObject({ index: 1, lower: Number.MIN_VALUE, upper: 1e-323 });
  });
  it("rejects invalid indices, collapsed boundaries and overflow without allocating a huge dense grid", () => {
    for (const step of [0, -1, Infinity, NaN]) expect(() => executionPriceGrid(step)).toThrow(/price precision/i);
    const grid = executionPriceGrid(.1);
    for (const index of [1.5, Infinity, Number.MAX_SAFE_INTEGER, NaN]) expect(() => grid.row(index)).toThrow(/price precision/i);
    expect(() => executionPriceGrid(Number.MAX_VALUE).index(Number.MAX_VALUE)).toThrow(/price precision/i);
    expect(() => executionPriceGrid(1e-20).index(1e5)).toThrow(/price precision/i);
  });
  it("assigns canonical decimal boundaries to their own rows rather than the preceding float quotient", () => {
    const result = footprints([.3, .6, .7].map(price => tick(price)), "1m", .1)[0];
    expect(result.levels.map(row => row.price)).toEqual([.3, .6, .7]);
    expect(result.volume).toBe(3);
  });
  it("keeps a representable price strictly below a boundary in the preceding row without epsilon snapping", () => {
    const result = footprints([tick(.29999999999999993, 2), tick(.3, 3), tick(.30000000000000004, 5)], "1m", .1)[0];
    expect(result.levels.map(row => [row.price, row.buyVolume])).toEqual([[.2, 2], [.3, 8]]);
  });
  it("preserves distinct rows below ten decimal places and their total-volume POC", () => {
    const result = footprints([tick(3e-12, 2), tick(4e-12, 5), tick(5e-12, 3, "sell")], "1m", 1e-12)[0];
    expect(result.levels.map(row => row.price)).toEqual([3e-12, 4e-12, 5e-12]);
    expect(result).toMatchObject({ volume: 10, delta: 4, poc: 4e-12 });
  });
  it("compares actual adjacent row indices for both diagonal imbalances", () => {
    const result = footprints([tick(.2, 2, "sell"), tick(.3, 6), tick(.3, 9, "sell"), tick(.4, 3)], "1m", .1, 3, { ignoreZeroOpposite: true })[0];
    expect(result.levels.find(row => row.price === .3)).toMatchObject({ buyVolume: 6, sellVolume: 9, buyImbalance: true, sellImbalance: true });
  });
  it("builds stacked zones on the same canonical grid edges as classified rows", () => {
    const result = footprints([tick(.2), tick(.3), tick(.4)], "1m", .1)[0];
    expect(footprintStacks(result, .1, 2)).toEqual([{ side: "buy", from: .3, to: .5, rows: 2 }]);
  });
  it("carries exact grid identity and canonical upper boundaries into downstream painting and stacking", () => {
    const step = .10000000000000002;
    const result = footprints([tick(.30000000000000004), tick(.3000000000000001)], "1m", step)[0];
    expect(result.levels.map(row => [row.rowIndex, row.price, row.upperPrice])).toEqual([
      [2, .20000000000000004, .30000000000000004], [3, .30000000000000004, .4000000000000001],
    ]);
    expect(footprintStacks(result, step, 2)).toEqual([]);
    const withDiagonal = footprints([tick(.10000000000000002), tick(.30000000000000004), tick(.3000000000000001)], "1m", step)[0];
    expect(footprintStacks(withDiagonal, step, 2)).toEqual([{ side: "buy", from: .20000000000000004, to: .4000000000000001, rows: 2 }]);
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it("uses identical decimal row assignment for explicitly windowed trade profiles", () => {
    const rows = tradeVolumeProfile([tick(.3, 2), tick(.4, 3, "sell"), tick(.3, 100, "buy", 61000)], .1, 0, 60000);
    expect(rows).toEqual([{ price: .3, buy: 2, sell: 0, total: 2 }, { price: .4, buy: 0, sell: 3, total: 3 }]);
  });
  it("rejects unsupported finite grids explicitly without returning partial classified volume", () => {
    expect(() => footprints([tick(1e-12), tick(100000)], "1m", 1e-20)).toThrow(/price precision/i);
    expect(() => tradeVolumeProfile([tick(1e-12), tick(100000)], 1e-20)).toThrow(/price precision/i);
  });
  it("reports a scoped recoverable footprint precision failure and clears it after a valid grid", () => {
    const token = Symbol(), context = { owner: "cell-grid", symbol: "BTCUSDT", timeframe: "1m", type: "footprint" };
    runDerivedPaint("grid-test", token, context, () => { footprints([tick(100000)], "1m", 1e-20); });
    expect(derivedRenderIssue("grid-test")).toMatchObject({ ...context, reason: "precision", message: expect.stringMatching(/price precision/i) });
    runDerivedPaint("grid-test", token, context, () => { expect(footprints([tick(.3)], "1m", .1)[0].poc).toBe(.3); });
    expect(derivedRenderIssue("grid-test")).toBeNull(); clearDerivedIssue("grid-test", token);
  });
  it("excludes invalid/unclassified profile executions before grid construction and preserves sparse prices", () => {
    const invalid = [tick(NaN), tick(1, -1), tick(1, 1, "buy", Infinity), { ...tick(1), side: "unknown" } as unknown as Tick];
    expect(tradeVolumeProfile([...invalid, tick(.3), tick(1000000)], .1).map(row => row.price)).toEqual([.3, 1000000]);
    for (const step of [0, -1, Infinity]) expect(tradeVolumeProfile([tick(.3)], step)).toEqual([]);
    expect(tradeVolumeProfile([tick(.3)], .1, 2000, 1000)).toEqual([]);
  });
});
