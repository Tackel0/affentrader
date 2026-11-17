import { describe, expect, it, vi } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { buildTpoRows, tpoLetter, tpoValueArea, TpoProfileError } from "@/lib/orderflow/tpoMath";
import { buildTpoSessions, createTpoCache, tpoCalendar, tpoWindow } from "@/lib/orderflow/tpoModel";
import { defaultTpo, resolveTpo, validTpo } from "@/lib/orderflow/tpoSettings";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";
import { tpoProfile } from "@/lib/orderflow/math";

const minute = 60000, day = 86400000, instant = (value: string) => Date.parse(`${value}Z`);
const bar = (time: number, low: number, high = low) => ({ time, low, high, open: low, close: high, volume: 1 });
const samples = [bar(0, 100, 104), bar(5 * minute, 101, 103), bar(10 * minute, 101, 103), bar(15 * minute, 102)];
const settings = () => ({ ...defaultTpo(), rowSize: 1, blockMinutes: "5" as const });
function canvas() {
  const calls: Array<{ kind: string; values: unknown[]; fill: string; stroke: string; alpha: number }> = [];
  const paths: number[][] = [];
  const target = { fillStyle: "", strokeStyle: "", globalAlpha: 1, save() {}, restore() {}, beginPath() { paths.length = 0; },
    moveTo(...values: number[]) { paths.push(values); }, lineTo(...values: number[]) { paths.push(values); },
    rect(...values: number[]) { paths.push(values); }, fill() { for (const values of paths) record("fill", values); },
    fillRect(...values: number[]) { record("fill", values); }, fillText(...values: unknown[]) { record("text", values); },
    stroke() { record("stroke", paths.map(point => [...point])); } };
  const record = (kind: string, values: unknown[]) => calls.push({ kind, values, fill: target.fillStyle, stroke: target.strokeStyle, alpha: target.globalAlpha });
  return { ctx: target as unknown as CanvasRenderingContext2D, calls };
}
const args = (invert = false) => ({ bars: samples, bounds: { top: 0, height: 300 }, scale: { min: 95, max: 110 },
  theme: { textColor: "#222222", upColor: "#089981", downColor: "#f23645" }, coords: { width: 1000,
    timeToX: (time: number) => 20 + time / day * 900, priceToY: (price: number) => invert ? (price - 95) * 20 : (110 - price) * 20,
    visibleTimeRange: () => ({ from: 0, to: day }), pxPerBar: () => 4 } }) as unknown as RendererLayerArgs;

describe("complete session TPO", () => {
  it("preserves subpixel geometry, split columns, session-time colors and outside-VA alpha", () => {
    const source = Array.from({ length: 24 }, (_, i) => bar(i * 5 * minute, 100, 102));
    for (const splitPeriods of [false, true]) {
      const style = { ...settings(), splitPeriods, candlesVisible: false, lettersVisible: false, ibVisible: false };
      const sessions = buildTpoSessions(source, style, "5m"), view = args(), fixture = canvas();
      view.coords.priceToY = price => (110 - price) * .25;
      const fill = vi.spyOn(fixture.ctx, "fill");
      paintTpoSessions(fixture.ctx, view, sessions, style);
      const rectangles = fixture.calls.filter(call => call.kind === "fill");
      expect(fill).toHaveBeenCalledTimes(72); expect(rectangles).toHaveLength(72);
      for (let row = 0; row < 3; row++) for (let item = 0; item < 24; item++) {
        const block = rectangles[row * 24 + item];
        expect(block.values).toEqual([splitPeriods ? 18 + item * 3.125 : 24 + item * 8, (110 - (101 + row)) * .25, splitPeriods ? 2.8125 : 7.4, 1]);
        const inArea = row >= sessions[0].valueArea.low && row <= sessions[0].valueArea.high;
        expect(block.fill).toBe(rectangles[item].fill);
        expect(block.fill).toMatch(/^rgba\(/);
        expect(block.alpha).toBe(inArea ? .9 : .9 * .45);
      }
    }
  });
  it("projects canonical row edges, POC centers and session boundaries without recomputing decimal sums", () => {
    const style = { ...settings(), rowSize: .1, valueAreaPercent: 100, candlesVisible: false };
    const sessions = buildTpoSessions([bar(0, .2, .3)], style, "5m"), view = args(), { ctx } = canvas();
    const project = vi.fn((price: number) => price * 500); view.coords.priceToY = project;
    paintTpoSessions(ctx, view, sessions, style);
    const projected = project.mock.calls.map(call => call[0]);
    expect(projected).toContain(.3); expect(projected).toContain(.4); expect(projected).toContain(.25);
    expect(projected).not.toContain(.30000000000000004);
  });
  it("counts one opportunity per block/price and retains empty rows between separate auctions", () => {
    const rows = buildTpoRows([bar(0, 100, 102), bar(minute, 100, 102), bar(30 * minute, 101, 102)], 1, 30 * minute, 0);
    expect(rows.map(row => row.count)).toEqual([1, 2, 2]); expect(rows[1].periods).toEqual(["A", "B"]);
    const sparse = buildTpoRows([bar(0, 100), bar(30 * minute, 103)], 1, 30 * minute, 0);
    expect(sparse.map(row => row.count)).toEqual([1, 0, 0, 1]);
  });
  it("selects a single midpoint-nearest POC and expands the value area toward the upper neighbor on equal distance", () => {
    const rows = buildTpoRows(samples, 1, 5 * minute, 0);
    expect(rows.map(row => row.count)).toEqual([1, 3, 4, 3, 1]);
    expect(tpoValueArea(rows, 70)).toEqual({ poc: 2, low: 1, high: 3, count: 10, total: 12 });
    expect(tpoValueArea(rows, 100)).toEqual({ poc: 2, low: 0, high: 4, count: 12, total: 12 });
    expect(tpoValueArea(rows.map((row, index) => ({ ...row, count: index % 2 ? 1 : 5 })), 1)?.poc).toBe(2);
    expect(tpoValueArea([rows[0], { ...rows[0], price: 101 }], 1)?.poc).toBe(0);
  });
  it("keeps the full session model and row grid unchanged when viewport bounds/scale change", () => {
    const cache = createTpoCache(), style = defaultTpo(), model = cache.read(samples, style, "5m", "BTCUSDT");
    const initial = JSON.stringify(model), { ctx } = canvas(), view = args();
    paintTpoSessions(ctx, view, model, style);
    view.scale.min = 97; view.scale.max = 105; view.coords.visibleTimeRange = () => ({ from: 6 * minute, to: 12 * minute });
    paintTpoSessions(ctx, view, model, style);
    expect(cache.read(samples, style, "5m", "BTCUSDT")).toBe(model); expect(JSON.stringify(model)).toBe(initial);
    expect(model[0].valueArea.total).toBeGreaterThan(4);
  });
  it("builds profiles for all loaded dates, while a Replay prefix excludes future letters and extremes", () => {
    const history = [bar(0, 100), bar(30 * minute, 101), bar(day, 200), bar(day + 30 * minute, 300)];
    const full = buildTpoSessions(history, { ...defaultTpo(), rowSize: 10 }, "5m");
    expect(full).toHaveLength(2); expect(full[1].rows.at(-1)!.price).toBe(300);
    const revealed = buildTpoSessions(history.slice(0, 3), { ...defaultTpo(), rowSize: 10 }, "5m");
    expect(revealed[1].rows).toHaveLength(1); expect(revealed[1].rows[0].periods).toEqual(["A"]);
    expect(tpoWindow(history.slice(0, 3))).toEqual({ from: 0, to: day + 30 * minute });
  });
  it("counts repeated DST hours separately and honors 23/25-hour calendar days", () => {
    const calendar = tpoCalendar({ ...defaultTpo(), sessionZone: "America/New_York" });
    expect(calendar.forDate("2026-03-08").end - calendar.forDate("2026-03-08").start).toBe(23 * 3600000);
    expect(calendar.forDate("2026-11-01").end - calendar.forDate("2026-11-01").start).toBe(25 * 3600000);
    const models = buildTpoSessions([bar(instant("2026-11-01T05:15:00"), 100), bar(instant("2026-11-01T06:15:00"), 100)],
      { ...defaultTpo(), sessionZone: "America/New_York", rowSize: 1 }, "5m");
    expect(models[0].rows[0].periodIndices).toEqual([2, 4]); expect(models[0].rows[0].periods).toEqual(["C", "E"]);
  });
  it("resolves an ambiguous start to its first occurrence and rolls a nonexistent opening forward", () => {
    const folded = tpoCalendar({ ...defaultTpo(), sessionZone: "America/New_York", sessionStartMinutes: 90 });
    expect(folded.at(instant("2026-11-01T06:15:00"))?.start).toBe(instant("2026-11-01T05:30:00"));
    const gap = tpoCalendar({ ...defaultTpo(), sessionZone: "America/New_York", sessionStartMinutes: 150 });
    expect(gap.forDate("2026-03-08").start).toBe(instant("2026-03-08T07:00:00"));
  });
  it("filters regular-session/weekday bounds, follows DST, and groups overnight bars under their session opening", () => {
    const regular = tpoCalendar({ ...defaultTpo(), sessionZone: "America/New_York", sessionStartMinutes: 570, sessionMinutes: 390, weekdaysOnly: true });
    expect(regular.at(instant("2026-03-06T14:25:00"))).toBeNull();
    expect(regular.at(instant("2026-03-06T14:30:00"))?.start).toBe(instant("2026-03-06T14:30:00"));
    expect(regular.at(instant("2026-03-06T21:00:00"))).toBeNull();
    expect(regular.at(instant("2026-03-07T15:00:00"))).toBeNull();
    expect(regular.at(instant("2026-03-09T13:30:00"))?.start).toBe(instant("2026-03-09T13:30:00"));
    const night = tpoCalendar({ ...defaultTpo(), sessionStartMinutes: 18 * 60, sessionMinutes: 23 * 60 });
    expect(night.at(instant("2026-10-28T02:00:00"))?.date).toBe("2026-10-27");
    expect(night.at(instant("2026-10-28T17:30:00"))).toBeNull();
  });
  it("keeps later block letters distinguishable instead of wrapping back to A", () => {
    expect([0, 25, 26, 51, 52, 61, 62, 124].map(tpoLetter)).toEqual(["A", "Z", "a", "z", "0", "9", "A2", "A3"]);
    expect(buildTpoRows([bar(52 * 5 * minute, 100)], 1, 5 * minute, 0)[0].periods).toEqual(["0"]);
  });
  it("rejects excessive rows/cells and unsupported prices without returning a truncated profile", () => {
    expect(buildTpoRows([bar(0, 0, 1999)], 1, minute, 0)).toHaveLength(2000);
    for (const run of [() => buildTpoRows([bar(0, 0, 2000)], 1, minute, 0),
      () => buildTpoRows(Array.from({ length: 101 }, (_, index) => bar(index, 0, 1999)), 1, 1, 0),
      () => tpoProfile([bar(0, 100, 101)], 1e-9),
      () => buildTpoRows([bar(0, 101, 100)], 1, minute, 0), () => buildTpoRows([bar(-1, 100)], 1, minute, 0)])
      expect(run).toThrow(TpoProfileError);
    for (const size of [0, NaN, Infinity]) expect(() => buildTpoRows(samples, size, minute, 0)).toThrow(TpoProfileError);
  });
  it("rejects coarse/nondividing/tick bars and session boundaries needing a finer source", () => {
    for (const interval of ["45m", "7m", "100T", "bad"]) expect(() => buildTpoSessions(samples, defaultTpo(), interval)).toThrow(/divide/);
    expect(() => buildTpoSessions([bar(35 * minute, 100)], { ...defaultTpo(), sessionStartMinutes: 35 }, "15m")).toThrow(/finer/);
    expect(() => buildTpoSessions([bar(0, 100)], { ...defaultTpo(), sessionMinutes: 5 }, "15m")).toThrow(/finer/);
    expect(() => tpoCalendar(defaultTpo()).at(Infinity)).toThrow(TpoProfileError);
  });
  it("invalidates tail revisions, settings and replaced historical arrays, and caches typed failures", () => {
    const source = samples.map(bar => ({ ...bar })), cache = createTpoCache(), style = settings();
    const first = cache.read(source, style, "5m", "BTCUSDT"); source.at(-1)!.close = 999;
    expect(cache.read(source, style, "5m", "BTCUSDT")).not.toBe(first);
    source.at(-1)!.high = 105; const changed = cache.read(source, style, "5m", "BTCUSDT"); expect(changed).not.toBe(first);
    expect(cache.read(source.map((bar, index) => index ? bar : { ...bar, high: 106 }), style, "5m", "BTCUSDT")).not.toBe(changed);
    const invalid = { ...style, rowSize: 1e-9 }; let error: unknown;
    try { cache.read(source, invalid, "5m", "BTCUSDT"); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(TpoProfileError);
    try { cache.read(source, invalid, "5m", "BTCUSDT"); } catch (caught) { expect(caught).toBe(error); }
  });
  it("validates and resolves native settings without mutating partial/legacy bags", () => {
    expect(validTpo(defaultTpo())).toBe(true);
    const resolved = resolveTpo({ lettersVisible: false, rowSize: 2, sessionZone: "Europe/Berlin", splitPeriods: true });
    expect(resolved).toEqual({ ...defaultTpo(), lettersVisible: false, rowSize: 2, sessionZone: "Europe/Berlin", splitPeriods: true });
    for (const bad of [{}, { ...resolved, extra: true }, { ...resolved, rowSize: -1 }, { ...resolved, sessionZone: "bad/zone" },
      { ...resolved, blockMinutes: 30 }, { ...resolved, valueAreaPercent: NaN }, { ...resolved, candlesVisible: "false" }]) expect(validTpo(bad)).toBe(false);
  });
  it("paints time-colored blocks, dims outer rows, and retains letters, POC, range and native-price candles", () => {
    const style = settings(), sessions = buildTpoSessions(samples, style, "5m"), { ctx, calls } = canvas();
    paintTpoSessions(ctx, args(), sessions, style);
    const blocks = calls.filter(call => call.kind === "fill");
    expect(blocks.filter(call => call.fill.startsWith("rgba(") && call.alpha === .9)).toHaveLength(10);
    expect(blocks.filter(call => call.fill.startsWith("rgba(") && call.alpha === .9 * .45)).toHaveLength(2);
    expect(calls.filter(call => call.kind === "text" && !String(call.values[0]).startsWith("IB"))).toHaveLength(12);
    expect(calls.some(call => call.kind === "text" && String(call.values[0]).startsWith("IB"))).toBe(true);
    expect(calls.filter(call => call.kind === "stroke" && call.stroke === style.pocColor && call.alpha === 1)).toHaveLength(1);
    expect(calls.some(call => call.kind === "stroke" && call.stroke === style.boundaryColor)).toBe(true);
    expect(blocks.filter(call => call.fill === "#089981")).toHaveLength(4);
  });
  it("splits periods into separate columns and honors independent visibility on inverted axes", () => {
    const source = [bar(0, 100), bar(15 * minute, 100)], style = { ...settings(), candlesVisible: false, pocVisible: false, valueAreaVisible: false, boundariesVisible: false, histogramVisible: false, ibVisible: false };
    const sessions = buildTpoSessions(source, style, "5m"), merged = canvas(), split = canvas();
    const view = args(true); view.coords.timeToX = time => 20 + time / minute * 2;
    paintTpoSessions(merged.ctx, view, sessions, style); paintTpoSessions(split.ctx, view, sessions, { ...style, splitPeriods: true });
    expect(merged.calls.every(call => call.kind === "text")).toBe(true);
    const distance = (calls: typeof merged.calls) => Number(calls[1].values[1]) - Number(calls[0].values[1]);
    expect(distance(split.calls)).toBe(30); expect(distance(merged.calls)).toBe(8);
    const hidden = canvas(); paintTpoSessions(hidden.ctx, args(), sessions, { ...style, lettersVisible: false }); expect(hidden.calls).toEqual([]);
  });
});
