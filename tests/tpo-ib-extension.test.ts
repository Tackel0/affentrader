import { describe, expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { tpoIbExtension } from "@/lib/orderflow/tpoIbExtension";
import { tpoInitialBalance } from "@/lib/orderflow/tpoInitialBalance";
import { buildTpoSessions, createTpoCache } from "@/lib/orderflow/tpoModel";
import { defaultTpo, resolveTpo, tpoSettings, validTpo } from "@/lib/orderflow/tpoSettings";
import { nativeSeriesPreferences } from "@/lib/chart/seriesPreferences";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";
import { clearTpoSurface, publishTpoSurface, readTpoSurface } from "@/lib/orderflow/tpoReadout";

const minute = 60000;
const bars = Array.from({ length: 13 }, (_, i) => ({ time: i * 5 * minute, low: .2, high: .3, open: .2, close: .3, volume: 1 }));
const ib = (low = .2, high = .3) => tpoInitialBalance([{ time: 0, low, high }], 0, minute, minute, 1, minute, minute);
const style = { ...defaultTpo(), rowSize: .1, ibExtensionVisible: true, histogramVisible: false, lettersVisible: false,
  ibVisible: false, pocVisible: false, valueAreaVisible: false, boundariesVisible: false, candlesVisible: false };

describe("completed Initial Balance range expansion", () => {
  it("preserves canonical decimals at fractional percentages, tiny/negative prices and flat ranges", () => {
    expect(tpoIbExtension(ib(), 150)).toEqual({ status: "ready", upper: .45, lower: .05 });
    expect(tpoIbExtension(ib(2e-12, 3e-12), 50)).toEqual({ status: "ready", upper: 3.5e-12, lower: 1.5e-12 });
    expect(tpoIbExtension(ib(-3, -2), 50)).toEqual({ status: "ready", upper: -1.5, lower: -3.5 });
    expect(tpoIbExtension(ib(5, 5), 500)).toEqual({ status: "ready", upper: 5, lower: 5 });
  });
  it("withholds levels before completion and when coverage is incomplete", () => {
    for (const status of ["developing", "incomplete", "unavailable"] as const)
      expect(tpoIbExtension({ ...ib(), status }, 100)).toEqual({ status, upper: null, lower: null });
    expect(tpoIbExtension(buildTpoSessions(bars.slice(0, 12), style, "5m")[0].initialBalance, 100).status).toBe("developing");
    expect(tpoIbExtension(buildTpoSessions(bars.filter((_, i) => i !== 2), style, "5m")[0].initialBalance, 100).status).toBe("incomplete");
  });
  it("rejects invalid percentages and exposes unsupported numeric spans without damaging the IB", () => {
    for (const percent of [0, 501, .5, NaN, Infinity]) expect(() => tpoIbExtension(ib(), percent)).toThrow(RangeError);
    const large = ib(Number.MAX_VALUE / 2, Number.MAX_VALUE), before = { ...large };
    expect(tpoIbExtension(large, 500)).toEqual({ status: "unsupported", upper: null, lower: null }); expect(large).toEqual(before);
    expect(tpoIbExtension(ib(.9999999999999999, 1), 1).status).toBe("unsupported");
  });
  it("reads both older preference generations and applies native settings without rebuilding the session model", () => {
    const { ibExtensionPercent, ibExtensionVisible, ...previous } = defaultTpo();
    const { ibBlocks, ibVisible, ibColor, ...oldest } = previous;
    for (const legacy of [previous, oldest]) {
      expect(validTpo(legacy)).toBe(true); expect(resolveTpo(legacy)).toEqual(defaultTpo());
      expect(nativeSeriesPreferences({ tpo: legacy } as never).chartTypes?.tpo).toMatchObject({ ibExtensionVisible: false, ibExtensionPercent: 100 });
    }
    for (const patch of [{ ibExtensionPercent: 0 }, { ibExtensionPercent: 501 }, { ibExtensionPercent: 1.5 }, { ibExtensionVisible: "yes" }])
      expect(validTpo({ ...previous, ...patch })).toBe(false);
    const keys = (tpoSettings().rows ?? []).flatMap(row => "key" in row ? [row.key] : []);
    expect(keys).toContain("ibExtensionVisible"); expect(keys).toContain("ibExtensionPercent");
    const cache = createTpoCache(), first = cache.read(bars, style, "5m", "TEST");
    expect(cache.read(bars, { ...style, ibExtensionPercent: 200 }, "5m", "TEST")).toBe(first);
  });
  it("projects independent extension lines only from IB end on regular and inverted scales", () => {
    const sessions = buildTpoSessions(bars, style, "5m");
    for (const inverted of [false, true]) {
      const points: number[][] = [], labels: string[] = [];
      const ctx = { save() {}, restore() {}, beginPath() {}, moveTo: (...v: number[]) => points.push(v), lineTo: (...v: number[]) => points.push(v),
        stroke() {}, setLineDash() {}, fillText: (label: string) => labels.push(label) } as unknown as CanvasRenderingContext2D;
      const priceToY = (price: number) => inverted ? price * 100 : 300 - price * 100;
      const args = { bounds: { top: 0, height: 300 }, scale: {}, theme: { textColor: "#fff" }, coords: { width: 2000, priceToY,
        timeToX: (time: number) => time / minute } } as unknown as RendererLayerArgs;
      paintTpoSessions(ctx, args, sessions, style);
      expect(points).toEqual([[60, priceToY(.4)], [1436, priceToY(.4)], [60, priceToY(.1)], [1436, priceToY(.1)]]);
      expect(labels).toEqual(["IB +100%", "IB −100%"]);
      points.length = 0; labels.length = 0;
      paintTpoSessions(ctx, args, buildTpoSessions(bars.slice(0, 12), style, "5m"), style); expect(points).toEqual([]);
      paintTpoSessions(ctx, args, sessions, { ...style, ibExtensionVisible: false }); expect(points).toEqual([]); expect(labels).toEqual([]);
    }
  });
  it("publishes exact extension readouts and unavailable developing levels independently of IB bracket visibility", () => {
    const token = Symbol("extension"), cell = "extension-test";
    const context = { symbol: "TEST", timeframe: "5m", epoch: 0, replay: true, seriesRange: { first: 0, last: 60 * minute, count: 13, high: .3, low: .2 } };
    const sessions = buildTpoSessions(bars, style, "5m");
    try {
      const read = () => Object.fromEntries(readTpoSurface(cell, context, 0).rows.map(row => [row.label, row.value]));
      publishTpoSurface(cell, token, { ...context, sessions, style });
      expect(read()).toMatchObject({ "IB extension status": "ready", "IB extension upper": "0.4", "IB extension lower": "0.1" });
      publishTpoSurface(cell, token, { ...context, sessions: [{ ...sessions[0], initialBalance: { ...sessions[0].initialBalance, status: "developing" } }], style });
      expect(read()).toMatchObject({ "IB extension status": "developing", "IB extension upper": "—", "IB extension lower": "—" });
      publishTpoSurface(cell, token, { ...context, sessions, style: { ...style, ibExtensionVisible: false } });
      expect(read()["IB extension upper"]).toBeUndefined();
    } finally { clearTpoSurface(cell, token); }
  });
});
