import { describe, expect, it } from "vitest";
import type { OHLCV } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { ExecutionRangeProfileCache, rangeExecutions } from "@/lib/orderflow/executionRangeProfile";
const base = Date.UTC(2026, 10, 1, 12), minute = 60000;
const bars = (count: number) => Array.from({ length: count }, (_, i) => ({ time: base + i * minute, open: 90, high: 1000, low: 1, close: 500, volume: 1e9 }));
const tick = (id: string, price: number, quantity = 1, offset = 1, side: Tick["side"] = "buy"): Tick => ({ id, price, quantity, time: base + offset, side, symbol: "HL:BTC", simulated: false });
const options = { rows: 4, valueAreaPct: 70, developing: false };
describe("classified range profile quantities and causal developing levels", () => {
  it("places each aggressor quantity once at its execution price and ignores OHLCV distribution", () => {
    const input = [tick("a", 100, 3), tick("b", 101, 2, 2, "sell"), tick("c", 102, 5), tick("d", 104, 7, 3, "sell")];
    const result = new ExecutionRangeProfileCache().read(bars(1), options, input, "1m")!;
    expect(result.profile.rows.map(row => [row.up, row.down])).toEqual([[3, 0], [0, 2], [5, 0], [0, 7]]);
    expect(result).toMatchObject({ executions: 4, buys: 8, sells: 9, total: 17, bars: 1, simulated: false });
    expect(result.profile.edges).toEqual([100, 101, 102, 103, 104]); expect(result.profile.poc).toBe(3);
  });
  it("honors inclusive first/exclusive final-candle bounds and deduplicates identical IDs", () => {
    const input = [tick("before", 100, 1000, -1), tick("first", 100, 2, 0), tick("last", 101, 3, minute - 1), tick("edge", 102, 9000, minute)];
    const result = new ExecutionRangeProfileCache().read(bars(1), options, [...input, input[1]], "1m")!;
    expect(result).toMatchObject({ executions: 2, total: 5 }); expect(rangeExecutions(input, bars(1), "1m").map(t => t.id)).toEqual(["first", "last"]);
    expect(new ExecutionRangeProfileCache().read([], options, input, "1m")).toBeNull();
  });
  it("preserves decimal boundary assignment and canonical quantities across row aggregation", () => {
    const input = [tick("min", .1, .1), tick("below", .29999999999999993, .2), tick("edge", .3, .3), tick("max", .5, .4)];
    const result = new ExecutionRangeProfileCache().read(bars(1), options, input, "1m")!;
    expect(result.profile.rows.map(row => row.up)).toEqual([.1, .2, .3, .4]); expect(result.total).toBe(1);
    const one = new ExecutionRangeProfileCache().read(bars(1), options, [tick("a", 100, .1), tick("b", 100, .2)], "1m")!;
    expect(one.profile.rows).toHaveLength(1); expect(one.total).toBe(.3); expect(one.profile.centers[0]).toBe(100);
    expect(new ExecutionRangeProfileCache().read(bars(1), options, [tick("a", 100, .1), tick("b", 100, .2), tick("c", 100, .2, 2, "sell")], "1m")!.delta).toBe(.1);
  });
  it("keeps developing POC and value-area prefixes independent of future extremes and decimal exponents", () => {
    const early = [tick("a", 100, .1), tick("b", 101, .2, minute + 1, "sell")], future = [tick("future", 500, 1e-20, 2 * minute + 1)];
    const first = new ExecutionRangeProfileCache().read(bars(2), { ...options, developing: true }, early, "1m")!;
    const full = new ExecutionRangeProfileCache().read(bars(3), { ...options, developing: true }, [...early, ...future], "1m")!;
    expect(full.developingPoc.slice(0, 2)).toEqual(first.developingPoc); expect(full.developingVaHigh.slice(0, 2)).toEqual(first.developingVaHigh); expect(full.developingVaLow.slice(0, 2)).toEqual(first.developingVaLow);
    expect(first.profile.edges.at(-1)).toBe(101); expect(full.profile.edges.at(-1)).toBe(500);
  });
  it("invalidates older execution repairs and backward prefixes without retaining failed intermediate data", () => {
    const cache = new ExecutionRangeProfileCache(), input = [tick("a", 100, 1), tick("b", 101, 2, minute + 1)];
    const first = cache.read(bars(2), options, input, "1m")!; expect(cache.read(bars(2), options, input, "1m")).toBe(first);
    input[0].quantity = 9; expect(cache.read(bars(2), options, input, "1m")!.total).toBe(11);
    expect(() => cache.read(bars(2), { ...options, rows: 999 }, input, "1m")).toThrow();
    expect(cache.read(bars(1), options, input, "1m")!.total).toBe(9);
  });
  it("rejects conflicting IDs, mixed sources/markets, invalid trades and unsupported intervals", () => {
    const cache = new ExecutionRangeProfileCache(), a = tick("same", 100);
    for (const input of [[a, { ...a, quantity: 9 }], [a, tick("other", 101, 1, 2, "sell"), { ...tick("sim", 102), simulated: true }], [a, { ...tick("eth", 102), symbol: "HL:ETH" }], [{ ...a, quantity: Infinity }], [{ ...a, time: NaN }], [{ ...a, seq: NaN }]]) expect(() => cache.read(bars(1), options, input, "1m")).toThrow();
    expect(() => cache.read(bars(1), options, [a], "100T")).toThrow(/time interval/);
    expect(() => cache.read(bars(1), options, [tick("a", 100, 1e308), tick("b", 101, 1e308)], "1m")).toThrow(/precision/);
    expect(() => cache.read(bars(1), options, Array.from({ length: 100001 }, (_, i) => tick(String(i), 100)), "1m")).toThrow(/100,000/);
  });
  it("uses real calendar-month ends and leaves unavailable ranges empty", () => {
    const source: OHLCV[] = [{ ...bars(1)[0], time: Date.UTC(2026, 1, 1) }];
    const input = [{ ...tick("feb", 100, 2), time: Date.UTC(2026, 1, 28, 23, 59, 59, 999) }, { ...tick("march", 200, 99), time: Date.UTC(2026, 2, 1) }];
    expect(new ExecutionRangeProfileCache().read(source, options, input, "1M")!.total).toBe(2);
    expect(new ExecutionRangeProfileCache().read(source, options, [], "1M")).toBeNull();
  });
  it("calculates a complete 100,000-execution developing range without rescanning every execution per candle", () => {
    const source = bars(1000), input = Array.from({ length: 100000 }, (_, i) => tick(String(i), 100 + i % 1000 / 100, .01, Math.floor(i / 100) * minute + i % 100, i % 2 ? "buy" : "sell"));
    const result = new ExecutionRangeProfileCache().read(source, { ...options, rows: 40, developing: true }, input, "1m")!;
    expect(result).toMatchObject({ total: 1000, executions: 100000, buys: 500, sells: 500 }); expect(result.developingPoc).toHaveLength(1000);
  }, 30000);
});
