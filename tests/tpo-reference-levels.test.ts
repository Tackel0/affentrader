import { describe, expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { buildTpoSessions, createTpoCache, tpoCalendar } from "@/lib/orderflow/tpoModel";
import { defaultTpo, resolveTpo, validTpo } from "@/lib/orderflow/tpoSettings";
import { tpoReferenceLevels } from "@/lib/orderflow/tpoReferenceLevels";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";
import { clearTpoSurface, publishTpoSurface, readTpoSurface } from "@/lib/orderflow/tpoReadout";
import { nativeSeriesPreferences } from "@/lib/chart/seriesPreferences";

const minute = 60000, day = 86400000;
const bar = (time: number, low = .2, high = .3) => ({ time, low, high, open: low, close: high, volume: 1 });
const opening = Array.from({ length: 12 }, (_, i) => bar(i * 5 * minute));
const full = [...opening, bar(60 * minute, 9, 10)];
const style = { ...defaultTpo(), rowSize: .1, sessionMinutes: 60, extendPoc: true, extendVah: true, extendVal: true };
const sessions = (bars = full) => buildTpoSessions(bars, style, "5m");

describe("fully covered completed TPO reference levels", () => {
  it("waits for a revealed timestamp at session end and uses canonical POC/VA edges", () => {
    const developing = sessions(opening)[0];
    expect(developing.completion).toEqual({ status: "developing", expectedBars: 12, missingSlots: 0 });
    expect(tpoReferenceLevels(developing)).toBeNull();
    const complete = sessions()[0];
    expect(complete.completion).toEqual({ status: "complete", expectedBars: 12, missingSlots: 0 });
    expect(tpoReferenceLevels(complete)).toEqual({ sessionStart: 0, from: 60 * minute, poc: .25, vah: .4, val: .2 });
    const legacy = { ...complete, rows: complete.rows.map(({ grid, ...row }) => row) };
    expect(tpoReferenceLevels(legacy)).toEqual(tpoReferenceLevels(complete));
  });
  it("refuses missing first, internal and final slots, without counting future developing slots as missing", () => {
    for (const removed of [0, 5, 11]) {
      const model = sessions([...opening.filter((_, i) => i !== removed), full.at(-1)!])[0];
      expect(model.completion).toEqual({ status: "incomplete", expectedBars: 12, missingSlots: 1 }); expect(tpoReferenceLevels(model)).toBeNull();
    }
    expect(sessions(opening.slice(0, 4))[0].completion).toEqual({ status: "developing", expectedBars: 12, missingSlots: 0 });
    expect(sessions([opening[0], opening[2]])[0].completion).toMatchObject({ status: "incomplete", missingSlots: 1 });
    const unaligned = buildTpoSessions([bar(0), bar(60 * minute)], { ...style, sessionMinutes: 7 }, "5m")[0];
    expect(unaligned.completion.status).toBe("incomplete"); expect(tpoReferenceLevels(unaligned)).toBeNull();
  });
  it("counts DST-shortened and DST-extended sessions using their actual windows", () => {
    for (const [date, expected] of [["2026-03-08", 276], ["2026-11-01", 300]] as const) {
      const preferences = { ...style, sessionMinutes: 1440, sessionZone: "America/New_York" }, window = tpoCalendar(preferences).forDate(date);
      const bars = Array.from({ length: expected + 1 }, (_, i) => bar(window.start + i * 5 * minute));
      const model = buildTpoSessions(bars, preferences, "5m")[0];
      expect(model.completion).toEqual({ status: "complete", expectedBars: expected, missingSlots: 0 });
      expect(tpoReferenceLevels(model)?.from).toBe(window.end);
    }
  });
  it("extends off-screen completed profiles to the right edge on regular/inverted axes, independently of base lines", () => {
    const preferences = { ...style, candlesVisible: false, histogramVisible: false, lettersVisible: false, ibVisible: false,
      pocVisible: false, valueAreaVisible: false, boundariesVisible: false };
    for (const invert of [false, true]) {
      const strokes: number[][][] = [], path: number[][] = [];
      const ctx = { save() {}, restore() {}, setLineDash() {}, beginPath() { path.length = 0; }, moveTo: (...p: number[]) => path.push(p),
        lineTo: (...p: number[]) => path.push(p), stroke: () => strokes.push(path.map(p => [...p])), fillText() {} } as unknown as CanvasRenderingContext2D;
      const y = (price: number) => invert ? price * 100 : 100 - price * 100;
      const args = { bars: full, bounds: { top: 0, height: 300 }, scale: {}, theme: { textColor: "#fff" }, coords: {
        width: 400, timeToX: (time: number) => time / minute - 160, priceToY: y } } as unknown as RendererLayerArgs;
      paintTpoSessions(ctx, args, sessions(), preferences);
      expect(strokes).toEqual([[[0, y(.25)], [400, y(.25)]], [[0, y(.4)], [400, y(.4)]], [[0, y(.2)], [400, y(.2)]]]);
      strokes.length = 0; paintTpoSessions(ctx, args, sessions(), { ...preferences, extendPoc: false }); expect(strokes).toHaveLength(2);
      strokes.length = 0; paintTpoSessions(ctx, args, sessions(opening), preferences); expect(strokes).toEqual([]);
    }
  });
  it("does not draw before the session end enters the viewport or outside the price pane", () => {
    const preferences = { ...style, candlesVisible: false, histogramVisible: false, lettersVisible: false, ibVisible: false,
      pocVisible: false, valueAreaVisible: false, boundariesVisible: false };
    let lines = 0;
    const ctx = { save() {}, restore() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { lines++; }, fillText() {} } as unknown as CanvasRenderingContext2D;
    const args = { bars: full, bounds: { top: 0, height: 300 }, scale: {}, theme: { textColor: "#fff" }, coords: {
      width: 400, timeToX: (time: number) => 500 + time / minute, priceToY: () => 20 } } as unknown as RendererLayerArgs;
    paintTpoSessions(ctx, args, sessions(), preferences); expect(lines).toBe(0);
    args.coords.timeToX = time => time / minute - 160; args.coords.priceToY = () => -1;
    paintTpoSessions(ctx, args, sessions(), preferences); expect(lines).toBe(0);
  });
  it("preserves old preferences and reuses models for extension style changes", () => {
    const { extendPoc, extendVah, extendVal, extensionPocColor, extensionVaColor, ...legacy } = defaultTpo();
    expect(validTpo(legacy)).toBe(true); expect(resolveTpo(legacy)).toEqual(defaultTpo());
    expect(nativeSeriesPreferences({ tpo: legacy } as never).chartTypes?.tpo).toMatchObject({ extendPoc: false, extendVah: false, extendVal: false });
    for (const patch of [{ extendPoc: "true" }, { extendVah: 1 }, { extendVal: null }, { extensionPocColor: "bad" }, { extensionVaColor: "bad" }])
      expect(validTpo({ ...legacy, ...patch })).toBe(false);
    const cache = createTpoCache(), first = cache.read(full, style, "5m", "TEST");
    expect(cache.read(full, { ...style, extendPoc: false, extensionVaColor: "#123456" }, "5m", "TEST")).toBe(first);
  });
  it("reports the latest covered completed reference separately from the selected developing session", () => {
    const bars = [...opening, bar(day)], models = buildTpoSessions(bars, style, "5m"), token = Symbol("references"), cell = "reference-test";
    const context = { symbol: "TEST", timeframe: "5m", epoch: 0, replay: true, seriesRange: { first: 0, last: day, count: 13, high: .3, low: .2 } };
    try {
      publishTpoSurface(cell, token, { ...context, sessions: models, style });
      const values = Object.fromEntries(readTpoSurface(cell, context, day).rows.map(row => [row.label, row.value]));
      expect(values).toMatchObject({ "Session completion": "developing", "Latest completed reference session": "1970-01-01 00:00:00 UTC",
        "Reference extension start": "1970-01-01 01:00:00 UTC", "Extended POC": "0.25", "Extended VAH": "0.4", "Extended VAL": "0.2" });
      publishTpoSurface(cell, token, { ...context, sessions: models, style: { ...style, extendPoc: false, extendVah: false, extendVal: false } });
      expect(readTpoSurface(cell, context, day).rows.some(row => row.label === "Extended POC")).toBe(false);
    } finally { clearTpoSurface(cell, token); }
  });
});
