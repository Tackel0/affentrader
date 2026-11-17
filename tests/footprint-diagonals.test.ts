import { expect, it } from "vitest";
import type { FootprintBar, Tick } from "@/types/trading";
import { footprintRows, footprints } from "@/lib/orderflow/math";
import { footprintDisplayBar } from "@/lib/orderflow/footprintCells";
import { footprintStacks } from "@/lib/orderflow/footprintAnalysis";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";

const tick = (price: number, side: "buy" | "sell", quantity = 1, tradeCount = 1, time = 0): Tick =>
  ({ id: `${price}:${side}:${time}:${quantity}:${tradeCount}`, symbol: "BTCUSDT", time, price, quantity, side, tradeCount, simulated: false });
const flags = (bar: FootprintBar) => bar.levels.map(row => [row.price, row.buyImbalance, row.sellImbalance]);

it("does not invent a diagonal at a lone row, outer extremes or an unobserved interior hole", () => {
  expect(flags(footprints([tick(100, "buy", 9), tick(100, "sell", 9)], "1m", 1)[0])).toEqual([[100, false, false]]);
  const source = [tick(100, "buy", 9), tick(101, "sell", 9), tick(103, "buy", 9), tick(104, "sell", 9)];
  expect(flags(footprints(source, "1m", 1)[0])).toEqual([[100, false, false], [101, false, false], [103, false, false], [104, false, false]]);
});
it("distinguishes an observed zero side from a missing price row", () => {
  const source = [tick(100, "buy", 1), tick(101, "buy", 9)];
  expect(flags(footprints(source, "1m", 1)[0])).toEqual([[100, false, false], [101, true, false]]);
  expect(flags(footprints(source, "1m", 1, 3, { ignoreZeroOpposite: true })[0])).toEqual([[100, false, false], [101, false, false]]);
});
it("applies inclusive ratio and minimum thresholds against present diagonal counterparts", () => {
  const source = [tick(99, "sell", 2), tick(100, "buy", 6), tick(100, "sell", 6), tick(101, "buy", 2)];
  expect(flags(footprints(source, "1m", 1, 3, { minimumVolume: 6 })[0])).toEqual([[99, false, false], [100, true, true], [101, false, false]]);
  expect(flags(footprints(source, "1m", 1, 3.00001, { minimumVolume: 6 })[0])).toEqual([[99, false, false], [100, false, false], [101, false, false]]);
  expect(footprints(source, "1m", 1, 3, { minimumVolume: 6.001 })[0].levels[1]).toMatchObject({ buyImbalance: false, sellImbalance: false });
});
it("uses threshold multiplication at decimal boundaries just as the reference comparator", () => {
  const source = [tick(100, "sell", .2), tick(101, "buy", .6)];
  expect(footprints(source, "1m", 1, 3)[0].levels[1].buyImbalance).toBe(.6 >= 3 * .2);
  expect(footprints([source[0], tick(101, "buy", .6000000000000001)], "1m", 1, 3)[0].levels[1].buyImbalance).toBe(true);
});
it("does not use a hidden row as a zero-volume diagonal in either direction", () => {
  const map = new Map([
    [100, { price: 100, rowIndex: 100, buyVolume: 10, sellVolume: 10, imbalance: null }],
    [101, { price: 101, rowIndex: 101, buyVolume: 1, sellVolume: 1, imbalance: null, filtered: true }],
    [102, { price: 102, rowIndex: 102, buyVolume: 10, sellVolume: 10, imbalance: null }],
  ]);
  expect(flags(footprintRows(0, map, 3))).toEqual([[100, false, false], [101, false, false], [102, false, false]]);
});
it("recomputes display diagonals after filtering while retaining raw quantities and slots", () => {
  const source = footprints([tick(100, "sell", 1), tick(101, "buy", 9), tick(101, "sell", 9), tick(102, "buy", 1)], "1m", 1)[0];
  const before = structuredClone(source);
  expect(source.levels[1]).toMatchObject({ buyImbalance: true, sellImbalance: true });
  const masked = footprintDisplayBar(source, 1, { imbalanceRatio: 3, minVolume: 2 });
  expect(masked.levels.map(row => row.filtered)).toEqual([true, false, true]);
  expect(masked.levels[1]).toMatchObject({ buyImbalance: false, sellImbalance: false });
  expect(masked.levels.map(({ buyVolume, sellVolume }) => [buyVolume, sellVolume])).toEqual(source.levels.map(({ buyVolume, sellVolume }) => [buyVolume, sellVolume]));
  expect(source).toEqual(before);
});
it("uses per-side means for diagonal decisions, with raw labels and actual neighbor membership", () => {
  const bar = footprints([tick(100, "sell", 8, 8), tick(101, "buy", 12, 2), tick(103, "buy", 100, 1)], "1m", 1)[0];
  expect(bar.levels[1].buyImbalance).toBe(false);
  const displayed = footprintDisplayBar(bar, 1, { averageTradeSize: true, imbalanceRatio: 3 });
  expect(flags(displayed)).toEqual([[100, false, false], [101, true, false], [103, false, false]]);
  expect(displayed.levels[1].buyVolume).toBe(12);
});
it("recomputes row membership after merging and never bridges gaps into a stack", () => {
  const source = [99, 100, 101, 102, 104].map(price => tick(price, price === 99 ? "sell" : "buy", price === 99 ? 1 : 10));
  const bar = footprints(source, "1m", 1)[0];
  expect(footprintStacks(bar, 1, 3)).toEqual([{ side: "buy", from: 100, to: 103, rows: 3 }]);
  expect(bar.levels.at(-1)?.buyImbalance).toBe(false);
  expect(flags(footprints(source, "1m", 2)[0])).toEqual([[98, false, false], [100, true, false], [102, true, false], [104, true, false]]);
});
it("updates incremental and visible aggregates when late observations supply a missing diagonal", () => {
  const history = new FootprintHistory("1m"); history.add([tick(101, "buy", 9)]);
  const settings = { step: 1, ratio: 3 }, before = history.read(settings);
  expect(before[0].levels[0].buyImbalance).toBe(false);
  history.add([tick(100, "sell", 2, 1, 10)]);
  expect(history.read(settings)[0].levels[1].buyImbalance).toBe(true);
  expect(before[0].levels[0].buyImbalance).toBe(false);
  expect(history.readVisible(settings, [0])?.levels[1].buyImbalance).toBe(true);
  history.add([tick(100, "sell", 20, 1, 20)]);
  expect(history.read(settings)[0].levels[1].buyImbalance).toBe(false);
  expect(history.readVisible(settings, [0])?.levels[1].buyImbalance).toBe(false);
});
it("does not borrow diagonal rows from another candle or a future Replay prefix", () => {
  const observed = [tick(101, "buy", 9, 1, 10), tick(100, "sell", 1, 1, 60000)];
  expect(footprints(observed, "1m", 1).every(bar => bar.levels.every(row => !row.buyImbalance && !row.sellImbalance))).toBe(true);
  expect(footprints(observed.filter(trade => trade.time < 60000), "1m", 1)[0].levels[0].buyImbalance).toBe(false);
});
