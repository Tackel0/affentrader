import { afterEach, describe, expect, it } from "vitest";
import type { FootprintBar, Tick } from "@/types/trading";
import { footprints } from "@/lib/orderflow/math";
import { footprintStacks } from "@/lib/orderflow/footprintAnalysis";
import { createFootprintInspection, footprintInspectionCsv, footprintInspectionPage, footprintInspectionStats, type FootprintInspectionSettings } from "@/lib/orderflow/footprintInspection";
import { captureFootprintInspection, clearFootprintSurface, publishFootprintSurface, readFootprintSurface } from "@/lib/orderflow/footprintReadout";
const settings: FootprintInspectionSettings = { step: 1, ratio: 3, minimumVolume: 0, ignoreZeroOpposite: false, minimumStackRows: 3 };
const context = { symbol: "HL:BTC", timeframe: "1m", simulated: false, coverage: 'Partial "observed", gaps unknown\nNo full tape' };
const trades: Tick[] = [99, 100, 101, 102, 104].map((price, index) => ({ id: String(price), symbol: "HL:BTC", time: index, price, quantity: price === 99 ? 1 : 10, side: price === 99 ? "sell" : "buy", simulated: false }));
const bar = () => footprints(trades, "1m", 1)[0];
const token = Symbol("inspected-footprint"), view = { symbol: "HL:BTC", timeframe: "1m", epoch: 3, replay: false, sourceStamp: "exchange1" };
afterEach(() => clearFootprintSurface("primary", token));
describe("painted footprint row inspection", () => {
  it("reports actual row conditions and contiguous stacks, without bridging an unobserved price row", () => {
    const snapshot = createFootprintInspection(bar(), settings, context, 1000);
    expect(footprintInspectionStats(bar(), settings)).toMatchObject({ buyRows: 3, sellRows: 0, buyStacks: 1, sellStacks: 0 });
    expect(snapshot.stacks).toEqual([{ side: "buy", from: 100, to: 103, rows: 3 }]);
    expect(snapshot.rows.filter(row => row.buyStack).map(row => row.lower)).toEqual([100, 101, 102]);
    expect(snapshot.rows.find(row => row.lower === 104)).toMatchObject({ buyImbalance: false, buyStack: false });
    expect(snapshot.rows.find(row => row.lower === 99)).toMatchObject({ bid: 1, ask: 0, delta: -1 });
    expect(snapshot.rows.find(row => row.poc)?.lower).toBe(100); expect(snapshot.volume).toBe(41); expect(snapshot.delta).toBe(39);
  });
  it("uses the engine's actual ratio, minimum volume and missing-opposite policy", () => {
    const strict = footprints(trades, "1m", 1, 3, { ignoreZeroOpposite: true })[0];
    expect(footprintInspectionStats(strict, { ...settings, ignoreZeroOpposite: true })).toMatchObject({ buyRows: 1, buyStacks: 0 });
    const filtered = footprints(trades, "1m", 1, 3, { minimumVolume: 11 })[0];
    expect(footprintInspectionStats(filtered, { ...settings, minimumVolume: 11 })).toMatchObject({ buyRows: 0, sellRows: 0 });
  });
  it("fixes legacy stack adjacency at a strictly preceding decimal boundary", () => {
    const legacy: FootprintBar = { time: 0, volume: 2, delta: 2, poc: .3, levels: [.19999999999999998, .3].map(price => ({ price, buyVolume: 1, sellVolume: 0, buyImbalance: true, imbalance: "buy" })) };
    expect(footprintStacks(legacy, .1, 2)).toEqual([]);
    const exact = { ...legacy, levels: [.2, .3].map(price => ({ price, buyVolume: 1, sellVolume: 0, buyImbalance: true, imbalance: "buy" as const })) };
    expect(footprintStacks(exact, .1, 2)).toMatchObject([{ from: .2, to: .4, rows: 2 }]);
  });
  it("copies/freeze-whitelists captured rows and settings independently of later trades and input edits", () => {
    const input = bar(), style = { ...settings }, snapshot = createFootprintInspection(input, style, context, 1000);
    input.levels[1].buyVolume = 999; style.step = 10;
    expect(snapshot.rows[1].ask).toBe(10); expect(snapshot.settings.step).toBe(1); expect(Object.isFrozen(snapshot.rows[1])).toBe(true); expect(Object.isFrozen(snapshot.stacks)).toBe(true);
    expect(snapshot).not.toHaveProperty("sourceStamp"); expect(snapshot.rows[1]).not.toHaveProperty("rowIndex");
  });
  it("paginates every observed row and keeps filters separate from stack calculations and exports", () => {
    const input = footprints(Array.from({ length: 123 }, (_, index) => ({ ...trades[1], id: String(index), price: index + 1, quantity: 1 })), "1m", 1)[0];
    const snapshot = createFootprintInspection(input, settings, context, 1000), selected: number[] = [];
    for (let page = 0; page < 3; page++) { const result = footprintInspectionPage(snapshot, "all", 0, page); expect(result.pages).toBe(3); selected.push(...result.rows.map(row => row.lower)); }
    expect(selected).toHaveLength(123); expect(new Set(selected).size).toBe(123); expect(selected[0]).toBe(123); expect(selected.at(-1)).toBe(1);
    expect(footprintInspectionPage(snapshot, "poc", 0, 9)).toMatchObject({ total: 1, page: 0 });
    expect(footprintInspectionPage(snapshot, "all", 2, 0)).toMatchObject({ total: 0, rows: [] });
    expect(footprintInspectionPage(snapshot, "all", 0, 0, true).rows[0].lower).toBe(1);
    expect(snapshot.stacks).toHaveLength(1); expect(footprintInspectionCsv(snapshot).split('"HL:BTC"').length - 1).toBe(123);
  });
  it("exports all rows with escaped source metadata, calculation inputs and exact model boundaries", () => {
    const snapshot = createFootprintInspection(bar(), settings, { ...context, replayThrough: 60000 }, 1000), csv = footprintInspectionCsv(snapshot), restored = JSON.parse(JSON.stringify(snapshot));
    expect(csv).toContain('"Partial ""observed"", gaps unknown\nNo full tape"'); expect(csv).toContain('"1970-01-01T00:01:00.000Z"'); expect(csv).toContain('"lower","upper_exclusive","bid_sells","ask_buys"');
    expect(restored.rows).toEqual(snapshot.rows); expect(restored.settings).toEqual(settings); expect(restored.replayThrough).toBe(60000);
  });
  it("rejects unsupported settings, malformed rows, cutoffs and oversized captures", () => {
    for (const patch of [{ step: 0 }, { ratio: 0 }, { minimumVolume: -1 }, { minimumStackRows: 1 }]) expect(() => createFootprintInspection(bar(), { ...settings, ...patch }, context)).toThrow();
    expect(() => createFootprintInspection({ ...bar(), levels: [...bar().levels].reverse() }, settings, context)).toThrow(/ordered/);
    expect(() => createFootprintInspection({ ...bar(), levels: Array(100001).fill(bar().levels[0]) }, settings, context)).toThrow(/100,000/);
    expect(() => createFootprintInspection(bar(), settings, { ...context, replayThrough: 0 })).toThrow(/Replay/);
    expect(() => footprintInspectionPage(createFootprintInspection(bar(), settings, context), "all", NaN, 0)).toThrow();
  });
  it("makes complete inspection available only for the matching painted source, candle and Replay prefix", () => {
    const publish = (replayThrough?: number) => publishFootprintSurface("primary", token, { ...view, bars: [bar()], simulated: false, dropped: 0, analysis: settings, ...(replayThrough === undefined ? {} : { replayThrough }) });
    publish(); const read = readFootprintSurface("primary", view, 0), target = read.inspectionTarget!;
    expect(read.rows.find(row => row.label === "Buy stacks")?.value).toBe("1"); expect(captureFootprintInspection(target, "exchange1", 1000)?.rows).toHaveLength(5);
    expect(readFootprintSurface("primary", { ...view, sourceStamp: "new-archive" }, 0)).toMatchObject({ status: "unavailable", rows: [] });
    for (const patch of [{ epoch: 4 }, { time: 60000 }, { symbol: "HL:ETH" }, { sourceStamp: "changed" }]) expect(captureFootprintInspection({ ...target, ...patch }, "exchange1")).toBeNull();
    expect(captureFootprintInspection(target, "new-archive")).toBeNull();
    publish(60000); expect(captureFootprintInspection(target, "exchange1")).toBeNull();
    const replay = readFootprintSurface("primary", { ...view, replay: true, replayThrough: 60000 }, 0).inspectionTarget!;
    expect(captureFootprintInspection(replay, "exchange1", 1000)?.replayThrough).toBe(60000);
    expect(captureFootprintInspection({ ...replay, replayThrough: 120000 }, "exchange1")).toBeNull();
    clearFootprintSurface("primary", token); expect(captureFootprintInspection(replay, "exchange1")).toBeNull();
  });
});
