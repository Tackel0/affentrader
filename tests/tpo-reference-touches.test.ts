import { describe, expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { buildTpoSessions, createTpoCache, type TpoSession } from "@/lib/orderflow/tpoModel";
import { defaultTpo, resolveTpo, validTpo } from "@/lib/orderflow/tpoSettings";
import { createTpoTouchCache, tpoReferenceTouches } from "@/lib/orderflow/tpoReferenceTouches";
import { tpoReferenceLevels } from "@/lib/orderflow/tpoReferenceLevels";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";
import { clearTpoSurface, publishTpoSurface, readTpoSurface } from "@/lib/orderflow/tpoReadout";

const minute = 60000, day = 86400000;
const bar = (time: number, low: number, high = low) => ({ time, low, high, open: low, close: high, volume: 1 });
const opening = Array.from({ length: 12 }, (_, i) => bar(i * 5 * minute, .2, .3));
const style = { ...defaultTpo(), rowSize: .1, sessionMinutes: 60, extendPoc: true, extendVah: true, extendVal: true, extensionUntilTouch: true };
const end = 60 * minute;
const bars = [...opening, bar(end, .2), bar(end + 5 * minute, .25), bar(end + 10 * minute, .4)];
const models = () => buildTpoSessions(bars, style, "5m");

describe("TPO observed reference touches", () => {
  it("uses inclusive ranges from session end, independently for exact POC/VA edges", () => {
    const sessions = models();
    expect(tpoReferenceLevels(sessions[0])).toEqual({ sessionStart: 0, from: end, poc: .25, vah: .4, val: .2 });
    expect(tpoReferenceTouches(bars, sessions).get(0)).toEqual({ poc: end + 5 * minute, vah: end + 10 * minute, val: end });
    const duplicate = [...sessions, { ...sessions[0], start: -day, end: end + 10 * minute }];
    expect(tpoReferenceTouches(bars, duplicate).get(-day)).toEqual({ poc: null, vah: end + 10 * minute, val: null });
  });
  it("does not infer touches across price/time gaps or before completion", () => {
    const sessions = models();
    expect(tpoReferenceTouches(opening, sessions).get(0)).toEqual({ poc: null, vah: null, val: null });
    expect(tpoReferenceTouches([...opening, bar(end + day, .1), bar(end + 2 * day, .5)], sessions).get(0)).toEqual({ poc: null, vah: null, val: null });
    for (const removed of [0, 5, 11]) {
      const source = bars.filter((_, index) => index !== removed);
      expect(tpoReferenceTouches(source, buildTpoSessions(source, style, "5m")).size).toBe(0);
    }
    expect(tpoReferenceTouches(opening, buildTpoSessions(opening, style, "5m")).size).toBe(0);
  });
  it("matches an independent chronological scan for many sessions, repeated prices and overlapping bar ranges", () => {
    let seed = 729;
    const random = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
    const source = Array.from({ length: 30 }, (_, index) => Array.from({ length: 12 }, (_, slot) => {
      const low = Math.floor(random() * 15) / 10 + .1;
      return bar(index * day + slot * 5 * minute, low, low + Math.floor(random() * 8) / 10);
    })).flat();
    const sessions = buildTpoSessions(source, style, "5m"), result = tpoReferenceTouches(source, sessions);
    for (const session of sessions) {
      const reference = tpoReferenceLevels(session); if (!reference) { expect(result.has(session.start)).toBe(false); continue; }
      for (const level of ["poc", "vah", "val"] as const) expect(result.get(session.start)![level]).toBe(
        source.find(candle => candle.time >= reference.from && candle.low <= reference[level] && candle.high >= reference[level])?.time ?? null);
    }
  });
  it("indexes 20,000 sessions without a future-bar scan for each reference", () => {
    const base = models()[0];
    const source = Array.from({ length: 20000 }, (_, index) => bar(index * 5 * minute, index * 10, index * 10 + 2));
    const sessions: TpoSession[] = source.map((candle, index) => ({ ...base, start: candle.time, end: candle.time + 5 * minute,
      rows: [{ ...base.rows[0], price: index * 10, grid: undefined }], valueArea: { ...base.valueArea, poc: 0, low: 0, high: 0 } }));
    source.at(-1)!.low = 0;
    const result = tpoReferenceTouches(source, sessions);
    expect(result.size).toBe(20000);
    for (const session of sessions.slice(0, -1)) expect(result.get(session.start)).toEqual({ poc: source.at(-1)!.time, vah: source.at(-1)!.time, val: source.at(-1)!.time });
    expect(result.get(sessions.at(-1)!.start)).toEqual({ poc: null, vah: null, val: null });
  });
  it("reuses unchanged paint results and recomputes after older in-place repairs, forming updates and backward Replay seeks", () => {
    const source = bars.map(candle => ({ ...candle })), cache = createTpoTouchCache(), sessions = models();
    const first = cache.read(source, sessions); expect(cache.read(source, sessions)).toBe(first);
    source[12].high = .4;
    const repaired = cache.read(source, sessions); expect(repaired).not.toBe(first); expect(repaired.get(0)).toEqual({ poc: end, vah: end, val: end });
    expect(cache.read(opening, sessions).get(0)).toEqual({ poc: null, vah: null, val: null });
    expect(cache.read(source, sessions).get(0)).toEqual(repaired.get(0));
    const only = [...opening, bar(end, .1)];
    expect(cache.read(only, sessions).get(0)!.val).toBeNull(); only.at(-1)!.high = .2;
    expect(cache.read(only, sessions).get(0)!.val).toBe(end);
  });
  it("clips independent lines at observed bar centers on regular/inverted scales, omits zero-length touches and retains continuous mode", () => {
    const preferences = { ...style, candlesVisible: false, histogramVisible: false, lettersVisible: false, ibVisible: false,
      pocVisible: false, valueAreaVisible: false, boundariesVisible: false };
    for (const invert of [false, true]) {
      const paths: number[][][] = [], path: number[][] = [];
      const ctx = { save() {}, restore() {}, setLineDash() {}, beginPath() { path.length = 0; }, moveTo: (...p: number[]) => path.push(p),
        lineTo: (...p: number[]) => path.push(p), stroke: () => paths.push(path.map(p => [...p])), fillText() {} } as unknown as CanvasRenderingContext2D;
      const y = (price: number) => invert ? price * 100 : 100 - price * 100;
      const args = { bars, bounds: { top: 0, height: 300 }, scale: {}, theme: { textColor: "#fff" }, coords: {
        width: 400, timeToX: (time: number) => (time - end) / (5 * minute) * 10 + 20, priceToY: y } } as unknown as RendererLayerArgs;
      paintTpoSessions(ctx, args, models(), preferences);
      expect(paths).toEqual([[[20, y(.25)], [30, y(.25)]], [[20, y(.4)], [40, y(.4)]]]);
      paths.length = 0;
      paintTpoSessions(ctx, args, models(), { ...preferences, extensionUntilTouch: false });
      expect(paths).toEqual([[[20, y(.25)], [400, y(.25)]], [[20, y(.4)], [400, y(.4)]], [[20, y(.2)], [400, y(.2)]]]);
    }
  });
  it("reports observed bar timestamps, unknown gaps and independent visibility through the real surface", () => {
    const token = Symbol("touch"), context = { symbol: "BTCUSDT", timeframe: "5m", epoch: 0, replay: true,
      seriesRange: { first: 0, last: day, count: bars.length + 1, high: .5, low: .5 } };
    const source = [...bars, bar(day, .5)], sessions = buildTpoSessions(source, style, "5m");
    try {
      publishTpoSurface("touch-test", token, { ...context, sessions, style, touches: tpoReferenceTouches(source, sessions) });
      const view = readTpoSurface("touch-test", context, day);
      expect(Object.fromEntries(view.rows.map(row => [row.label, row.value]))).toMatchObject({
        "POC first observed touch": "1970-01-01 01:05:00 UTC", "VAH first observed touch": "1970-01-01 01:10:00 UTC", "VAL first observed touch": "1970-01-01 01:00:00 UTC" });
      publishTpoSurface("touch-test", token, { ...context, sessions, style: { ...style, extendVah: false }, touches: tpoReferenceTouches(opening, sessions) });
      expect(readTpoSurface("touch-test", context, day).rows).toContainEqual({ label: "POC first observed touch", value: "None in loaded candles; gaps are unknown" });
      expect(readTpoSurface("touch-test", context, day).rows.some(row => row.label === "VAH first observed touch")).toBe(false);
    } finally { clearTpoSurface("touch-test", token); }
  });
  it("preserves old settings, validates the toggle and reuses mathematical profiles for touch-style changes", () => {
    const { extensionUntilTouch, ...legacy } = defaultTpo();
    expect(validTpo(legacy)).toBe(true); expect(resolveTpo(legacy).extensionUntilTouch).toBe(false);
    for (const value of ["true", 1, null]) expect(validTpo({ ...legacy, extensionUntilTouch: value })).toBe(false);
    expect(resolveTpo({ ...legacy, extensionUntilTouch: true }).extensionUntilTouch).toBe(true);
    const cache = createTpoCache(), first = cache.read(bars, style, "5m", "BTCUSDT");
    expect(cache.read(bars, { ...style, extensionUntilTouch: false }, "5m", "BTCUSDT")).toBe(first);
  });
});
