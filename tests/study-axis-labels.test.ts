import { describe, expect, it, vi } from "vitest";
import type { IndicatorModel, LineLikeSeries } from "@luxalgo/vela";
import { NativeRenderer } from "@luxalgo/vela";
import { bindStudyAxisLabels, paintStudyAxisLabels, placeStudyAxisLabels, studyAxisLabels, type StudyAxisFrame } from "@/lib/chart/studyAxisLabels";
import type { IndicatorInstance } from "@/types/trading";

const preference: IndicatorInstance = { id: "host", definitionId: "ema", name: "EMA", inputs: { length: 20 }, source: "close", color: "#2962ff", lineWidth: 2, visible: true };
const bar = (close: number) => ({ time: 1, open: 40, high: 100, low: 0, close, volume: 1 });
function fixture() {
  const scale = { min: 0, max: 100, invert: false }, pane = { id: "price", kind: "price", scale, bounds: { top: 0, height: 200 } };
  const series: LineLikeSeries = { id: "plot", title: "Plot", paneId: "price", kind: "line", points: [{ time: 1, value: 40 }, { time: 2, value: 50 }, { time: 3, value: 999 }], style: { color: "#2962ff", width: 2, lineStyle: "solid" } };
  const model = { id: "native", paneId: "price", series: [series] } as IndicatorModel;
  const ctx = { canvas: { width: 800 }, save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), setLineDash: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
  const frame = { ctx, scene: { bars: [bar(40), bar(50)], indicators: new Map([[model.id, model]]), panes: new Map([[pane.id, pane]]), showAxisLabels: true, showPriceLabel: false, showCountdown: false, style: { fontSize: 12 }, offsetOf: () => 0, scaleFor: () => scale, ownScaleIndicatorsForPane: () => [] }, coords: { dpr: 1, priceToY: (value: number, s: typeof scale, bounds: typeof pane.bounds) => bounds.top + (s.invert ? value - s.min : s.max - value) / (s.max - s.min) * bounds.height }, theme: { fontFamily: "Arial", upColor: "#00ff00", downColor: "#ff0000" }, dataW: 600, panes: [pane], axisX: (column: number) => 600 + column * 64, format: (value: number) => value.toFixed(2) } as unknown as StudyAxisFrame;
  return { frame, model, series, pane, ctx, policy: new Map([["native", { ...preference }]]) };
}

describe("study values on native price axes", () => {
  it("installs and removes the callback through the actual patched native renderer with chrome-only invalidation", () => {
    const native = NativeRenderer.prototype as unknown as { setStudyAxisLabelPainter(painter: unknown): void };
    const target = { chrome: { afStudyAxisLabels: null as unknown }, scheduler: { invalidate: vi.fn() } }, painter = vi.fn();
    native.setStudyAxisLabelPainter.call(target, painter);
    expect(target.chrome.afStudyAxisLabels).toBe(painter); expect(target.scheduler.invalidate).toHaveBeenLastCalledWith(2);
    native.setStudyAxisLabelPainter.call(target, null);
    expect(target.chrome.afStudyAxisLabels).toBeNull(); expect(target.scheduler.invalidate).toHaveBeenCalledTimes(2);
  });
  it("uses only the last revealed slot, including sliced inputs, null warm-up and future Pine projections", () => {
    const { frame, series, policy } = fixture();
    expect(studyAxisLabels(frame, policy).map(label => label.value)).toEqual([50]);
    frame.scene.offsetOf = () => 1;
    expect(studyAxisLabels(frame, policy)[0].value).toBe(40);
    series.points[0].value = null;
    expect(studyAxisLabels(frame, policy)).toEqual([]);
    frame.scene.offsetOf = () => 3;
    expect(studyAxisLabels(frame, policy)).toEqual([]);
    frame.scene.offsetOf = () => 0; frame.scene.bars = [bar(40)]; series.points[0].value = 42;
    expect(studyAxisLabels(frame, policy)[0].value).toBe(42);
  });
  it("honors legacy defaults, independent instance preferences and global/native surface restrictions without editing plots", () => {
    const { frame, model, series, policy } = fixture();
    for (const patch of [{ valuesOnPriceScale: false }, { visible: false }, { error: "failed" }]) {
      policy.set("native", { ...preference, ...patch }); expect(studyAxisLabels(frame, policy)).toEqual([]);
    }
    policy.set("native", { ...preference, valuesInStatusLine: false });
    expect(studyAxisLabels(frame, policy)).toHaveLength(1);
    frame.scene.showAxisLabels = false; expect(studyAxisLabels(frame, policy)).toEqual([]); frame.scene.showAxisLabels = true;
    series.visible = false; expect(studyAxisLabels(frame, policy)).toEqual([]);
    series.display = { pane: false, legend: false, dataWindow: true, priceScale: true };
    const before = structuredClone(model);
    expect(studyAxisLabels(frame, policy)).toHaveLength(1); expect(model).toEqual(before);
    series.display.priceScale = false; expect(studyAxisLabels(frame, policy)).toEqual([]);
    expect(studyAxisLabels(frame, new Map())).toEqual([]);
  });
  it("uses native scale formatting, own-scale columns, inverted panes and force-overlay routing", () => {
    const { frame, model, series, policy } = fixture();
    const oscillator = { id: "osc", kind: "indicator", collapsed: false, scale: { min: 0, max: 100, invert: true }, bounds: { top: 220, height: 100 } };
    frame.panes.push(oscillator); (frame.scene.panes as Map<string, typeof oscillator>).set("osc", oscillator);
    model.paneId = "osc"; model.ownScale = true; frame.scene.ownScaleIndicatorsForPane = () => [model]; frame.scene.scaleFor = () => oscillator.scale;
    const format = vi.fn((value: number, scale: unknown, height: number) => `${value}/${scale === oscillator.scale}/${height}`); frame.format = format;
    expect(studyAxisLabels(frame, policy)[0]).toMatchObject({ x: 664, desiredY: 270, text: "50/true/100", columnKey: "osc:1" });
    expect(format).toHaveBeenLastCalledWith(50, oscillator.scale, 100, oscillator, true, model);
    series.overlay = true;
    expect(studyAxisLabels(frame, policy)[0]).toMatchObject({ x: 600, desiredY: 100, text: "50/false/200", columnKey: "price:0" });
    expect(format).toHaveBeenLastCalledWith(50, frame.panes[0].scale, 200, frame.panes[0], false, model);
    series.overlay = false; frame.scene.ownScaleIndicatorsForPane = () => [];
    expect(studyAxisLabels(frame, policy)).toEqual([]);
    model.ownScale = false; oscillator.collapsed = true; expect(studyAxisLabels(frame, policy)).toEqual([]);
  });
  it("handles candle/bar closes, per-point colors and excludes markers, NaN and out-of-pane values", () => {
    const { frame, model, series, policy } = fixture(); series.points[1].color = "#ffffff";
    expect(studyAxisLabels(frame, policy)[0].color).toBe("#ffffff");
    for (const kind of ["candle", "bar"] as const) {
      model.series = [{ id: "candles", title: "Candles", paneId: "price", kind, bars: [bar(30), bar(45)], barColors: [null, { color: "#123456" }] }];
      expect(studyAxisLabels(frame, policy)[0]).toMatchObject({ value: 45, color: "#123456" });
    }
    model.series = [series];
    for (const value of [null, NaN, Infinity, 101]) { series.points[1].value = value; expect(studyAxisLabels(frame, policy)).toEqual([]); }
    model.series = [{ id: "marker", title: "Marker", paneId: "price", kind: "markers", markers: [] }]; expect(studyAxisLabels(frame, policy)).toEqual([]);
  });
  it("reserves the price/countdown chip, separates overlapping values and omits excess labels within bounded panes", () => {
    const { frame, policy } = fixture(); frame.scene.showPriceLabel = true; frame.scene.showCountdown = true;
    const source = studyAxisLabels(frame, policy)[0];
    const result = placeStudyAxisLabels(frame, Array.from({ length: 30 }, (_, index) => ({ ...source, key: `${index}` })));
    expect(result.length).toBeGreaterThan(1); expect(result.length).toBeLessThan(30);
    for (const label of result) {
      expect(label.y - 8).toBeGreaterThanOrEqual(label.top); expect(label.y + 8).toBeLessThanOrEqual(label.bottom);
      expect(label.y + 8 < 89 || label.y - 8 > 131).toBe(true);
      for (const other of result) if (other !== label) expect(Math.abs(label.y - other.y)).toBeGreaterThan(16);
    }
    expect(placeStudyAxisLabels(frame, [source, { ...source, key: "own", columnKey: "price:1" }]).find(label => label.key === "own")?.y).toBe(100);
  });
  it("uses contrasting ink and restores all canvas state even when snapshot text painting throws", () => {
    const { frame, series, ctx, policy } = fixture(); series.points[1].color = "#ffffff";
    expect(paintStudyAxisLabels(frame, policy)).toHaveLength(1);
    expect((ctx as unknown as CanvasRenderingContext2D).fillStyle).toBe("#131722");
    ctx.fillText.mockImplementation(() => { throw new Error("snapshot canvas"); });
    expect(() => paintStudyAxisLabels(frame, policy)).toThrow("snapshot canvas");
    expect(ctx.save).toHaveBeenCalledTimes(4); expect(ctx.restore).toHaveBeenCalledTimes(4);
  });
  it("reads the live host policy on every native paint, invalidates only chrome and detaches subscriptions", () => {
    const { frame, ctx } = fixture(); let listener: (() => void) | undefined, values = [{ indicator: { ...preference }, nativeId: "native" }];
    const renderer = { setStudyAxisLabelPainter: vi.fn() }, unsubscribe = vi.fn();
    const dispose = bindStudyAxisLabels(renderer, { read: () => values, subscribe: fn => { listener = fn; return unsubscribe; } });
    const painter = renderer.setStudyAxisLabelPainter.mock.calls[0][0] as (frame: StudyAxisFrame) => void;
    painter(frame); expect(ctx.fillText).toHaveBeenCalledTimes(1);
    values = [{ indicator: { ...preference, valuesOnPriceScale: false }, nativeId: "native" }]; listener!(); painter(frame);
    expect(ctx.fillText).toHaveBeenCalledTimes(1); expect(renderer.setStudyAxisLabelPainter).toHaveBeenCalledTimes(2);
    dispose(); listener!(); painter(frame); expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(renderer.setStudyAxisLabelPainter).toHaveBeenLastCalledWith(null); expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(() => bindStudyAxisLabels({}, { read: () => [], subscribe: () => () => {} })).toThrow(/adapter is missing/);
  });
});
