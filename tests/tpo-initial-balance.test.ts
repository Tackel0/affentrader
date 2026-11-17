import { describe, expect, it, vi } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { tpoInitialBalance } from "@/lib/orderflow/tpoInitialBalance";
import { buildTpoSessions, createTpoCache, tpoCalendar } from "@/lib/orderflow/tpoModel";
import { defaultTpo, resolveTpo, tpoSettings, validTpo } from "@/lib/orderflow/tpoSettings";
import { nativeSeriesPreferences } from "@/lib/chart/seriesPreferences";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";
const minute = 60000, block = 30 * minute, day = 86400000;
const bar = (time: number, low = 100, high = 101) => ({ time, low, high, open: low, close: high, volume: 1 });
const source = Array.from({ length: 13 }, (_, i) => bar(i * 5 * minute, 100 - i, 101 + i));
const calculate = (bars = source, until = source.at(-1)!.time, blocks = 2) => tpoInitialBalance(bars, 0, day, block, blocks, 5 * minute, until);
describe("TPO initial balance", () => {
  it("develops within the opening blocks, completes after the boundary is revealed and excludes later extremes", () => {
    expect(calculate(source.slice(0, 1), 0)).toMatchObject({ status: "developing", high: 101, low: 100, loadedBars: 1, expectedBars: 12, missingSlots: 0 });
    expect(calculate()).toMatchObject({ status: "complete", high: 112, low: 89, range: 23, loadedBars: 12, end: 60 * minute });
    const extended = [...source, bar(90 * minute, -1000, 9999)]; expect(calculate(extended, 90 * minute)).toEqual(calculate());
    expect(calculate(source, 0).high).toBe(101);
  });
  it("labels missing openings/internal slots and withholds a range if no opening candles are loaded", () => {
    expect(calculate(source.slice(1))).toMatchObject({ status: "incomplete", loadedBars: 11, missingSlots: 1 });
    expect(calculate(source.filter((_, i) => i !== 5))).toMatchObject({ status: "incomplete", missingSlots: 1 });
    expect(calculate([bar(60 * minute)])).toMatchObject({ status: "unavailable", high: null, low: null, range: null, loadedBars: 0 });
    expect(calculate(source.slice(0, 12), 55 * minute).status).toBe("developing");
  });
  it("clamps at session end, supports a single opening block and rejects unsupported settings/data", () => {
    expect(calculate(source, 60 * minute, 1)).toMatchObject({ high: 106, low: 95, expectedBars: 6 });
    expect(tpoInitialBalance(source, 0, block, block, 2, 5 * minute, block).end).toBe(block);
    for (const count of [0, 1.5, 49, NaN]) expect(() => calculate(source, 60 * minute, count)).toThrow();
    expect(() => calculate([bar(0, 2, 1)])).toThrow(/Invalid/); expect(() => calculate([bar(1)])).toThrow(/unaligned/);
  });
  it("keeps decimal range differences exact and fails visibly for overflowing price spans", () => {
    expect(calculate([bar(0, .2, .3)], 0).range).toBe(.1);
    expect(() => calculate([bar(0, -Number.MAX_VALUE, Number.MAX_VALUE)], 0)).toThrow(/precision/);
  });
  it("uses elapsed opening blocks through a DST fold and only the revealed Replay prefix", () => {
    const style = { ...defaultTpo(), rowSize: 1, sessionZone: "America/New_York", sessionStartMinutes: 90 };
    const session = tpoCalendar(style).forDate("2026-11-01"); expect(session.start).toBe(Date.parse("2026-11-01T05:30:00Z"));
    const bars = source.map(bar => ({ ...bar, time: bar.time + session.start }));
    const prefix = buildTpoSessions(bars.slice(0, 2), style, "5m")[0].initialBalance;
    const full = buildTpoSessions(bars, style, "5m")[0].initialBalance;
    expect(prefix).toMatchObject({ status: "developing", high: 102, low: 99 }); expect(full.end).toBe(Date.parse("2026-11-01T06:30:00Z")); expect(full.status).toBe("complete");
  });
  it("retains legacy preferences, validates new fields and exposes native controls", () => {
    const { ibBlocks, ibVisible, ibColor, ...legacy } = defaultTpo();
    expect(validTpo(legacy)).toBe(true); expect(resolveTpo(legacy)).toEqual(defaultTpo());
    for (const patch of [{ ibBlocks: 0 }, { ibBlocks: 1.5 }, { ibColor: "bad" }, { ibVisible: "false" }, { extra: true }]) expect(validTpo({ ...legacy, ...patch })).toBe(false);
    const native = nativeSeriesPreferences({ tpo: legacy } as never); expect(native.chartTypes?.tpo).toMatchObject({ ibBlocks: 2, ibVisible: true, ibColor: "#00bcd4" });
    const rows = tpoSettings().rows ?? []; expect(rows.some(row => "key" in row && row.key === "ibMinutes")).toBe(true);
  });
  it("reuses models for IB color/visibility edits while block-count edits and old opening repairs recompute", () => {
    const cache = createTpoCache(), bars = source.map(bar => ({ ...bar })), style = { ...defaultTpo(), rowSize: 1 };
    const first = cache.read(bars, style, "5m", "HL:BTC");
    expect(cache.read(bars, { ...style, ibVisible: false, ibColor: "#123456" }, "5m", "HL:BTC")).toBe(first);
    expect(cache.read(bars, { ...style, ibMinutes: 30 }, "5m", "HL:BTC")[0].initialBalance.high).toBe(106);
    bars[0].high = 120; expect(cache.read(bars, style, "5m", "HL:BTC")[0].initialBalance.high).toBe(120);
  });
  it("projects exact IB extremes on regular/inverted scales, identifies partial coverage and obeys visibility", () => {
    const style = { ...defaultTpo(), rowSize: 1, lettersVisible: false, histogramVisible: false, candlesVisible: false, pocVisible: false, valueAreaVisible: false, boundariesVisible: false };
    const sessions = buildTpoSessions(source, style, "5m");
    for (const invert of [false, true]) {
      const points: number[][] = [], dash = vi.fn(), text = vi.fn();
      const ctx = { save() {}, restore() {}, beginPath() {}, moveTo: (...values: number[]) => points.push(values), lineTo: (...values: number[]) => points.push(values), stroke: vi.fn(), setLineDash: dash, fillText: text } as unknown as CanvasRenderingContext2D;
      const args = { bounds: { top: 0, height: 300 }, scale: {}, theme: { textColor: "#ffffff" }, coords: { width: 500, timeToX: (time: number) => time / day * 400,
        priceToY: (price: number) => invert ? price : 300 - price } } as unknown as RendererLayerArgs;
      paintTpoSessions(ctx, args, sessions, style); expect(points.map(point => point[1])).toContain(invert ? 112 : 188); expect(points.map(point => point[1])).toContain(invert ? 89 : 211); expect(text.mock.calls[0][0]).toBe("IB");
      paintTpoSessions(ctx, args, buildTpoSessions(source.slice(1), style, "5m"), style); expect(dash).toHaveBeenCalledWith([3, 3]); expect(text.mock.calls.at(-1)![0]).toContain("incomplete");
      const before = text.mock.calls.length; paintTpoSessions(ctx, args, sessions, { ...style, ibVisible: false }); expect(text.mock.calls).toHaveLength(before);
    }
  });
});
