import { afterEach, describe, expect, it, vi } from "vitest";
import { footprints } from "@/lib/orderflow/math";
import { footprintDeltaPercent, footprintStacks } from "@/lib/orderflow/footprintAnalysis";
import { defaultFootprint, resolveFootprint, validFootprint } from "@/lib/orderflow/footprint";
import { footprintUpdates } from "@/lib/orderflow/footprintUpdates";
import type { FootprintBar, Tick } from "@/types/trading";
const tick = (price: number, quantity: number, side: "buy" | "sell", time = 1000): Tick => ({ id: `${price}-${side}-${time}`, symbol: "BTCUSDT", price, quantity, side, time, simulated: false });
const bar = (prices: number[], both = false): FootprintBar => ({ time: 0, volume: prices.length, delta: prices.length, poc: prices[0],
  levels: prices.map(price => ({ price, buyVolume: 1, sellVolume: 0, imbalance: "buy", buyImbalance: true, sellImbalance: both })) });
afterEach(() => vi.useRealTimers());
describe("classified footprint analysis", () => {
  it("applies minimum dominant-side volume inclusively without changing totals or POC", () => {
    const trades = [tick(99, 1, "sell"), tick(100, 3, "buy"), tick(101, 2.99, "buy")];
    const raw = footprints(trades, "1m", 1)[0], filtered = footprints(trades, "1m", 1, 3, { minimumVolume: 3 })[0];
    expect(filtered).toMatchObject({ volume: raw.volume, delta: raw.delta, poc: raw.poc });
    expect(filtered.levels[1].buyImbalance).toBe(true); expect(filtered.levels[2].buyImbalance).toBe(false);
  });
  it("can require an observed nonzero diagonal counterpart, including missing adjacent rows", () => {
    const trades = [tick(99, 1, "sell"), tick(100, 3, "buy"), tick(103, 100, "buy")];
    const result = footprints(trades, "1m", 1, 3, { ignoreZeroOpposite: true })[0];
    expect(result.levels[1].buyImbalance).toBe(true); expect(result.levels[2].buyImbalance).toBe(false);
    expect(footprints(trades, "1m", 1)[0].levels[2].buyImbalance).toBe(false);
  });
  it("compares genuinely small executions without a fabricated epsilon counter-volume", () => {
    const result = footprints([tick(99, 1e-16, "sell"), tick(100, 3e-16, "buy")], "1m", 1)[0];
    expect(result.levels[1].buyImbalance).toBe(true);
  });
  it("rejects invalid filter options and unclassified executions rather than calling them sells", () => {
    const trades = [tick(100, 10, "buy"), { ...tick(100, 1000, "sell"), side: "unknown" } as unknown as Tick];
    expect(footprints(trades, "1m", 1)[0]).toMatchObject({ volume: 10, delta: 10 });
    for (const ratio of [NaN, 0, Infinity]) expect(footprints(trades, "1m", 1, ratio)).toEqual([]);
    for (const minimumVolume of [-1, Infinity, NaN]) expect(footprints(trades, "1m", 1, 3, { minimumVolume })).toEqual([]);
  });
  it("finds maximal consecutive zones independently on both sides", () => {
    expect(footprintStacks(bar([100, 101, 102, 103], true), 1, 3)).toEqual([
      { side: "buy", from: 100, to: 104, rows: 4 }, { side: "sell", from: 100, to: 104, rows: 4 },
    ]);
  });
  it("breaks zones at missing price rows and non-imbalanced rows, without connecting bars", () => {
    expect(footprintStacks(bar([100, 101, 103, 104]), 1, 3)).toEqual([]);
    const source = bar([100, 101, 102, 103, 104]); source.levels[2].buyImbalance = false;
    expect(footprintStacks(source, 1, 2).map(zone => [zone.from, zone.to])).toEqual([[100, 102], [103, 105]]);
    expect(footprintStacks(bar([100, 101]), 1, 3)).toEqual([]); expect(footprintStacks(bar([102]), 1, 3)).toEqual([]);
  });
  it("supports decimal and negative row grids but rejects unsafe coordinates and invalid lengths", () => {
    expect(footprintStacks(bar([-.3, -.2, -.1, 0]), .1, 3)[0]).toMatchObject({ from: -.3, to: .1, rows: 4 });
    expect(footprintStacks(bar([1e20, 1e20]), .01, 2)).toEqual([]);
    for (const minimum of [1, 2.5, 21, Infinity]) expect(footprintStacks(bar([100, 101, 102]), 1, minimum)).toEqual([]);
  });
  it("reports classified delta percentage and unavailable invalid/empty statistics", () => {
    expect(footprintDeltaPercent({ volume: 10, delta: 4 })).toBe(40);
    expect(footprintDeltaPercent({ volume: 10, delta: -10 })).toBe(-100);
    expect(footprintDeltaPercent({ volume: 1e308, delta: 1e308 })).toBe(100);
    for (const source of [{ volume: 0, delta: 0 }, { volume: 5, delta: 6 }, { volume: Infinity, delta: 1 }]) expect(footprintDeltaPercent(source)).toBeNull();
  });
  it("breaks stacks across unsupported legacy coordinates without throwing or joining the sides", () => {
    const source = bar([100, 101, NaN, 102, 103], true);
    expect(footprintStacks(source, 1, 3)).toEqual([]);
    source.levels[2] = { ...source.levels[2], price: 1e20 };
    expect(footprintStacks(source, 1, 3)).toEqual([]);
    source.levels[2] = { ...source.levels[2], price: 102, rowIndex: Infinity, upperPrice: 103 };
    expect(footprintStacks(source, 1, 3)).toEqual([]);
  });
  it("restores legacy bags and validates each advanced key without dropping unrelated original preferences", () => {
    const legacy = { ...defaultFootprint(), rowSize: 10 }; for (const key of ["stackedVisible", "stackedRows", "imbalanceMinVolume", "ignoreZeroOpposite", "statisticsVisible", "volumeMode"] as const) delete legacy[key];
    expect(validFootprint(legacy)).toBe(true); expect(resolveFootprint(legacy)).toEqual({ ...defaultFootprint(), rowSize: 10 });
    for (const invalid of [{ stackedRows: 1 }, { stackedRows: 2.5 }, { imbalanceMinVolume: -1 }, { ignoreZeroOpposite: "yes" }, { statisticsVisible: 1 }, { extra: true }]) expect(validFootprint({ ...defaultFootprint(), ...invalid })).toBe(false);
  });
  it("batches trade-only updates and cancels stale pending paints on source/style/Replay/disposal changes", () => {
    vi.useFakeTimers(); let receive: (tick: Tick) => void = () => {}; const off = vi.fn(), invalidate = vi.fn();
    const subscribe = vi.fn((cb: (tick: Tick) => void) => { receive = cb; return off; });
    const updates = footprintUpdates(subscribe, invalidate);
    expect(subscribe).not.toHaveBeenCalled();
    updates.set({ id: "cell-2", symbol: "BTCUSDT" }); receive(tick(100, 1, "buy")); receive(tick(101, 1, "buy"));
    vi.advanceTimersByTime(49); expect(invalidate).not.toHaveBeenCalled(); vi.advanceTimersByTime(1); expect(invalidate).toHaveBeenCalledExactlyOnceWith("cell-2");
    receive(tick(100, 1, "buy")); updates.set({ id: "cell-2", symbol: "ETHUSDT" }); vi.advanceTimersByTime(100); expect(invalidate).toHaveBeenCalledTimes(1);
    receive({ ...tick(100, 1, "buy"), symbol: "ETHUSDT" }); updates.set(undefined); vi.advanceTimersByTime(100); expect(invalidate).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledOnce(); expect(off).toHaveBeenCalledOnce();
    updates.set({ id: "primary", symbol: "BTCUSDT" }); receive(tick(100, 1, "buy")); updates.destroy(); vi.advanceTimersByTime(100); expect(off).toHaveBeenCalledTimes(2); expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
