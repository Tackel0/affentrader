import { describe, expect, it } from "vitest";
import { bookTick, buildLadder } from "@/components/DomPanel";
import type { OrderBook } from "@/types/trading";
import { depthBookStatus, groupedLadderStep, ladderIndex, ladderPrice } from "@/lib/orderflow/depthLadder";

const book = (bids: [number, number][], asks: [number, number][]): OrderBook => ({
  symbol: "BTCUSDT",
  bids: bids.map(([price, quantity]) => ({ price, quantity })),
  asks: asks.map(([price, quantity]) => ({ price, quantity })),
  time: 0,
  simulated: false,
});

describe("depth ladder", () => {
  const b = book(
    [[100.0, 5], [99.99, 3], [99.97, 2]],
    [[100.01, 4], [100.02, 6], [100.05, 1]],
  );
  it("detects the tick size from the book", () => {
    expect(bookTick(b)).toBeCloseTo(0.01, 8);
    expect(bookTick(book([], []))).toBe(0.01);
  });
  it("lists rows from high to low with bid and ask sizes", () => {
    const rows = buildLadder(b, 0.01, 3);
    const prices = rows.map((r) => r.price);
    expect([...prices].sort((x, y) => y - x)).toEqual(prices);
    expect(rows.find((r) => r.price === 100)?.bid).toBe(5);
    expect(rows.find((r) => r.price === 100.02)?.ask).toBe(6);
    expect(rows.find((r) => r.price === 99.98)).toMatchObject({ bid: 0, ask: 0 });
  });
  it("sums levels into coarser groups without losing size", () => {
    const rows = buildLadder(b, 0.05, 3);
    expect(rows.reduce((s, r) => s + r.bid, 0)).toBe(10);
    expect(rows.reduce((s, r) => s + r.ask, 0)).toBe(11);
  });
  it("returns nothing for a one-sided book", () => {
    expect(buildLadder(book([[1, 1]], []), 0.01, 3)).toEqual([]);
  });
  it("retains tiny nonzero prices and uses canonical decimal quantities", () => {
    const rows = buildLadder(book([[3e-12, .1], [2.9e-12, .2]], [[4e-12, .3]]), 1e-12, 3);
    expect(new Set(rows.map(row => row.price)).size).toBe(rows.length); expect(rows.every(row => row.price > 0)).toBe(true);
    expect(rows.find(row => row.price === 2e-12)?.bid).toBe(.2); expect(rows.find(row => row.price === 3e-12)?.bid).toBe(.1);
    const grouped = buildLadder(book([[100.02, .1], [100.01, .2]], [[101, 1]]), 1, 3); expect(grouped.find(row => row.price === 100)?.bid).toBe(.3);
    expect(groupedLadderStep(.0000001, 50)).toBe(.000005);
  });
  it("keeps strictly preceding bids and following asks on the correct side of exact boundaries", () => {
    expect(ladderPrice(.29999999999999993, .1, "bid")).toBe(.2);
    expect(ladderPrice(.30000000000000004, .1, "ask")).toBe(.4);
    expect(ladderPrice(.3, .1, "ask")).toBe(.3);
    expect(ladderIndex(.3, .09999999999999999, "ask")).toBe(4);
    expect(ladderPrice(.25, .1)).toBe(.3); expect(ladderPrice(.24999999999999997, .1)).toBe(.2);
  });
  it("compresses a trillion-row spread and retains both sides without filling the gap", () => {
    const rows = buildLadder(book([[1, 2]], [[1000000, 3]]), .000001, 12);
    expect(rows).toHaveLength(24); expect(rows.find(row => row.price === 1)).toMatchObject({ bid: 2, omittedAbove: "999998999999" });
    expect(rows.reduce((sum, row) => sum + row.ask, 0)).toBe(3); expect(rows.every((row, i) => !i || row.price < rows[i - 1].price)).toBe(true);
  });
  it("bounds dense spread rows and rejects invalid levels, grids and quantity overflow", () => {
    expect(buildLadder(book([[1000, 1]], [[1101, 1]]), 1, 100)).toHaveLength(300);
    for (const step of [0, -1, Infinity, NaN, Number.MIN_VALUE]) expect(() => buildLadder(b, step, 12)).toThrow();
    for (const count of [0, 101, 1.5]) expect(() => buildLadder(b, .01, count)).toThrow();
    for (const invalid of [book([[100, 0]], [[101, 1]]), book([[100, 1], [100, 2]], [[101, 1]]), book([[101, 1]], [[100, 1]]), book([[NaN, 1]], [[101, 1]])]) expect(() => buildLadder(invalid, 1, 12)).toThrow();
    expect(() => buildLadder(book([[100.02, 1e308], [100.01, 1e308]], [[101, 1]]), 50, 12)).toThrow(/quantity/);
    expect(() => buildLadder(book([[1, 1]], [[2, 1]]), 100, 12)).toThrow(/nonpositive/);
  });
  it("measures observed spacing exactly without treating it as verified venue metadata", () => {
    expect(bookTick(book([[.3, 1], [.2, 1]], [[.4, 1]]))).toBe(.1);
    expect(bookTick(book([[3e-12, 1]], [[4e-12, 1]]))).toBe(1e-12);
    expect(() => bookTick(book(Array.from({ length: 1001 }, (_, i) => [10000 - i, 1]), [[10001, 1]]))).toThrow(/1,000/);
  });
  it("excludes mismatched, simulated, Replay and expired books", () => {
    const snapshot = { ...b, time: 10000 }, context = { symbol: "BTCUSDT", replay: false, simulation: false, now: 15000 };
    expect(depthBookStatus(snapshot, context)).toBeNull();
    expect(depthBookStatus(snapshot, { ...context, now: 15001 })).toContain("stale");
    expect(depthBookStatus(snapshot, { ...context, symbol: "HL:BTC" })).toContain("matching");
    expect(depthBookStatus(snapshot, { ...context, replay: true })).toContain("Live depth is excluded");
    expect(depthBookStatus(snapshot, { ...context, simulation: true })).toContain("Simulation");
    expect(depthBookStatus({ ...snapshot, simulated: true }, context)).toContain("matching");
    expect(depthBookStatus({ ...snapshot, time: 17000 }, context)).toContain("timestamp");
    expect(depthBookStatus(book([[1, 1]], []), { ...context, now: 0 })).toContain("both sides");
  });
});
