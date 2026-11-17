import { describe, expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { buildTpoRows, tpoValueArea, type TpoRow } from "@/lib/orderflow/tpoMath";
import { tpoStructure } from "@/lib/orderflow/tpoStructure";
import { buildTpoSessions, createTpoCache } from "@/lib/orderflow/tpoModel";
import { defaultTpo, resolveTpo, validTpo } from "@/lib/orderflow/tpoSettings";
import { nativeSeriesPreferences } from "@/lib/chart/seriesPreferences";
import { clearTpoSurface, publishTpoSurface, readTpoSurface } from "@/lib/orderflow/tpoReadout";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";

const minute = 60000;
const bar = (time: number, low: number, high = low) => ({ time, low, high, open: low, close: high, volume: 1 });
const source = [bar(0, .1, .4), bar(5 * minute, .1), bar(10 * minute, .4)];
const settings = { ...defaultTpo(), rowSize: .1, blockMinutes: "5" as const, poorHighVisible: true, poorLowVisible: true, singlePrintsVisible: true };
const rowsFor = (bars: typeof source, step = .1) => buildTpoRows(bars, step, 5 * minute, 0);
const counts = (values: number[]) => values.map((count, index) => ({ price: index, count, periods: [], periodIndices: [] })) as TpoRow[];

describe("TPO value area and observed profile structure", () => {
  it("adds only the upper neighbor on an equidistant count tie and stops at the target", () => {
    expect(tpoValueArea(counts([2, 4, 2]), 70)).toEqual({ poc: 1, low: 1, high: 2, count: 6, total: 8 });
    expect(tpoValueArea(counts([1, 3, 4, 3, 1]), 50)).toEqual({ poc: 2, low: 2, high: 3, count: 7, total: 12 });
  });
  it("chooses the nearer neighbor when counts tie, crosses empty rows and handles edge POCs", () => {
    expect(tpoValueArea(counts([3, 5, 4, 3]), 80)).toEqual({ poc: 1, low: 0, high: 2, count: 12, total: 15 });
    expect(tpoValueArea(counts([2, 0, 5, 0, 2]), 100)).toEqual({ poc: 2, low: 0, high: 4, count: 9, total: 9 });
    expect(tpoValueArea(counts([4, 2, 2]), 100)).toMatchObject({ low: 0, high: 2, count: 8 });
  });
  it("finds poor extremes and exact interior single-print zones on canonical decimal boundaries", () => {
    const rows = rowsFor(source), model = tpoStructure(rows, .1);
    expect(rows.map(row => row.count)).toEqual([2, 1, 1, 2]);
    expect(model).toEqual({ poorLow: { lower: .1, upper: .2, firstRow: 0, lastRow: 0, rows: 1, opportunities: 2 },
      poorHigh: { lower: .4, upper: .5, firstRow: 3, lastRow: 3, rows: 1, opportunities: 2 },
      singlePrintZones: [{ lower: .2, upper: .4, firstRow: 1, lastRow: 2, rows: 2 }] });
    const legacyRows = rows.map(({ grid, ...row }) => row);
    expect(tpoStructure(legacyRows, .1)).toEqual(model);
  });
  it("excludes tapering tails and empty gaps rather than calling every one-block row a single print", () => {
    const tails = rowsFor([bar(0, 100, 104), bar(5 * minute, 102, 103)], 1);
    expect(tails.map(row => row.count)).toEqual([1, 1, 2, 2, 1]);
    expect(tpoStructure(tails, 1)).toEqual({ poorHigh: null, poorLow: null, singlePrintZones: [] });
    const gap = rowsFor([bar(0, 100, 101), bar(5 * minute, 100), bar(10 * minute, 103, 104), bar(15 * minute, 104)], 1);
    expect(gap.map(row => row.count)).toEqual([2, 1, 0, 1, 2]); expect(tpoStructure(gap, 1).singlePrintZones).toEqual([]);
    expect(tpoStructure([], 1)).toEqual({ poorHigh: null, poorLow: null, singlePrintZones: [] });
  });
  it("revises developing structures only from revealed history and reuses models for marker styles", () => {
    const cache = createTpoCache(), first = cache.read(source, settings, "5m", "TEST");
    expect(first[0].structure.singlePrintZones).toHaveLength(1);
    expect(cache.read(source, { ...settings, poorColor: "#123456", singlePrintsVisible: false }, "5m", "TEST")).toBe(first);
    const revealed = [...source, bar(15 * minute, .2, .3)];
    expect(cache.read(revealed, settings, "5m", "TEST")[0].structure.singlePrintZones).toEqual([]);
    expect(buildTpoSessions(source, settings, "5m")[0].structure.singlePrintZones).toHaveLength(1);
    const singleRow = tpoStructure(rowsFor([bar(0, .1), bar(5 * minute, .1)]), .1);
    expect(singleRow.poorLow).toEqual(singleRow.poorHigh); expect(singleRow.singlePrintZones).toEqual([]);
  });
  it("resolves legacy settings and validates independently persisted controls", () => {
    const { poorHighVisible, poorLowVisible, singlePrintsVisible, poorColor, singlePrintColor, ...legacy } = defaultTpo();
    expect(validTpo(legacy)).toBe(true); expect(resolveTpo(legacy)).toEqual(defaultTpo());
    expect(nativeSeriesPreferences({ tpo: legacy } as never).chartTypes?.tpo).toMatchObject({ poorHighVisible: false, poorLowVisible: false, singlePrintsVisible: false });
    for (const patch of [{ poorHighVisible: 1 }, { poorLowVisible: "false" }, { singlePrintsVisible: null }, { poorColor: "bad" }, { singlePrintColor: "bad" }])
      expect(validTpo({ ...legacy, ...patch })).toBe(false);
  });
  it("paints exact structural boundaries and zone fills on regular/inverted axes with independent visibility", () => {
    const style = { ...settings, lettersVisible: false, histogramVisible: false, candlesVisible: false, ibVisible: false, pocVisible: false, valueAreaVisible: false, boundariesVisible: false };
    const sessions = buildTpoSessions(source, style, "5m");
    for (const inverted of [false, true]) {
      const paths: number[][] = [], strokes: Array<{ color: string; points: number[][] }> = [], fills: number[][] = [], labels: string[] = [];
      const target = { strokeStyle: "", save() {}, restore() {}, beginPath() { paths.length = 0; }, moveTo: (...v: number[]) => paths.push(v),
        lineTo: (...v: number[]) => paths.push(v), stroke() { strokes.push({ color: target.strokeStyle, points: paths.map(p => [...p]) }); },
        rect: (...v: number[]) => fills.push(v), fill() {}, fillText: (label: string) => labels.push(label) };
      const y = (price: number) => inverted ? price * 100 : 300 - price * 100;
      const args = { bounds: { top: 0, height: 300 }, scale: {}, theme: { textColor: "#fff" }, coords: { width: 2000, priceToY: y,
        timeToX: (time: number) => time / minute } } as unknown as RendererLayerArgs;
      paintTpoSessions(target as unknown as CanvasRenderingContext2D, args, sessions, style);
      expect(strokes.map(stroke => stroke.points)).toEqual([[[4, y(.5)], [1436, y(.5)]], [[4, y(.1)], [1436, y(.1)]], [[4, y(.2)], [1436, y(.2)]], [[4, y(.4)], [1436, y(.4)]]]);
      expect(fills).toEqual([[4, Math.min(y(.2), y(.4)), 1432, 20]]);
      expect(labels).toEqual(["Poor high · 2 blocks", "Poor low · 2 blocks", "Single print · 2 rows"]);
      strokes.length = 0; fills.length = 0; labels.length = 0;
      paintTpoSessions(target as unknown as CanvasRenderingContext2D, args, sessions, { ...style, poorHighVisible: false, poorLowVisible: false, singlePrintsVisible: false });
      expect(strokes).toEqual([]); expect(fills).toEqual([]); expect(labels).toEqual([]);
    }
  });
  it("publishes exact ranges and distinguishes interior single prints from all one-block rows", () => {
    const token = Symbol("structure"), cell = "structure-test", sessions = buildTpoSessions(source, settings, "5m");
    const context = { symbol: "TEST", timeframe: "5m", epoch: 0, replay: true, seriesRange: { first: 0, last: 10 * minute, count: 3, high: .4, low: .4 } };
    try {
      publishTpoSurface(cell, token, { ...context, sessions, style: settings });
      const rows = Object.fromEntries(readTpoSurface(cell, context, 0).rows.map(row => [row.label, row.value]));
      expect(rows).toMatchObject({ "Poor high row [lower, upper)": "[0.4, 0.5)", "Poor low row [lower, upper)": "[0.1, 0.2)",
        "Poor high opportunities": "2", "Poor low opportunities": "2", "Interior single-print zones": "1", "Interior single-print rows": "2",
        "Single-print zone 1 [lower, upper)": "[0.2, 0.4) · 2 rows" });
    } finally { clearTpoSurface(cell, token); }
  });
});
