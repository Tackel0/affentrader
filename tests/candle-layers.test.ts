import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { chartType } from "@luxalgo/vela";
import { candleClassification, candleLayerSettings, defaultPluginCandles, paintPluginCandle, readPluginCandles, validPluginCandles } from "@/lib/chart/candleLayers";
import { registerChartStyles } from "@/lib/chart/styles";
import { bindSeriesPreferences, seriesPreferencesHost } from "@/lib/chart/seriesBinding";
import { nativeSeriesPreferences, readSeriesPreferences, validSeriesPreferences } from "@/lib/chart/seriesPreferences";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
import { parseWorkspace } from "@/lib/workspace";
import type { OHLCV } from "@/types/trading";

const bar = (open: number, close: number, volume = 10): OHLCV => ({ time: 1, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume });
const previous = bar(100, 100);
const config = () => ({ candles: defaultPluginCandles().hollow, bars: { upColor: "#089981", downColor: "#f23645" },
  line: { color: "#2962ff", width: 2 }, area: { lineColor: "#2962ff", width: 2, topColor: "#2962ff44", bottomColor: "#2962ff00" },
  baseline: { topLineColor: "#089981", bottomLineColor: "#f23645", topFillColor: "#08998144", topFillColor2: "#08998100", bottomFillColor: "#f2364544", bottomFillColor2: "#f2364500", width: 2, baselineLevel: 50 },
  series: { spacing: 1, style: "hollow" }, priceScale: { animateLastPrice: false }, animations: { zoom: true, pan: true, autoscale: true, intro: false },
  chartTypes: { hollow: {}, volumecandles: {}, footprint: { untouched: 1 } } });
const initialChart = useChartStore.getState(), initialWorkspace = useWorkspaceStore.getState();
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useChartStore.setState({ ...initialChart, seriesPreferences: null }, true);
  useWorkspaceStore.setState({ ...initialWorkspace, cells: structuredClone(initialWorkspace.cells), layouts: [] }, true);
});
afterEach(() => vi.restoreAllMocks());
function context(settings = {}) {
  const calls: Array<{ op: string; color: unknown; values: number[] }> = [];
  const ctx = { strokeStyle: "", fillStyle: "", lineWidth: 1,
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: () => calls.push({ op: "wick", color: ctx.strokeStyle, values: [] }),
    fillRect: (...values: number[]) => calls.push({ op: "fill", color: ctx.fillStyle, values }),
    strokeRect: (...values: number[]) => calls.push({ op: "outline", color: ctx.strokeStyle, values }) };
  const args = { settings, coords: { timeToX: () => 20, priceToY: (value: number) => -value, bodySpacing: () => 10, pxPerBar: () => 10 }, scale: {}, bounds: {} } as unknown as RendererLayerArgs;
  return { ctx: ctx as unknown as CanvasRenderingContext2D, args, calls };
}
describe("native Hollow and Volume candle controls", () => {
  it("separates Hollow previous-close color from its own open-close fill for all four combinations", () => {
    expect(candleClassification(bar(99, 101), previous, "hollow", false)).toEqual({ up: true, hollow: true });
    expect(candleClassification(bar(105, 102), previous, "hollow", false)).toEqual({ up: true, hollow: false });
    expect(candleClassification(bar(95, 99), previous, "hollow", false)).toEqual({ up: false, hollow: true });
    expect(candleClassification(bar(100, 98), previous, "hollow", false)).toEqual({ up: false, hollow: false });
  });
  it("lets Volume candles choose open-close or previous-close color and handles the first bar", () => {
    expect(candleClassification(bar(95, 99), previous, "volumecandles", false).up).toBe(true);
    expect(candleClassification(bar(95, 99), previous, "volumecandles", true).up).toBe(false);
    expect(candleClassification(bar(95, 99), undefined, "volumecandles", true).up).toBe(true);
  });
  it("independently respects body, border and wick visibility without drawing hidden geometry", () => {
    const s = context({ bodyVisible: false, borderVisible: false, wickVisible: false });
    paintPluginCandle(s.ctx, s.args, "hollow", bar(99, 101), previous, 10); expect(s.calls).toEqual([]);
    const border = context({ bodyVisible: false, borderVisible: true, wickVisible: false, borderUpColor: "#112233" });
    paintPluginCandle(border.ctx, border.args, "volumecandles", bar(99, 101), previous, 10);
    expect(border.calls.map(call => [call.op, call.color])).toEqual([["outline", "#112233"]]);
  });
  it("uses distinct chosen body and wick inks for filled and hollow candles", () => {
    const s = context({ upColor: "#112233", wickUpColor: "#aabbcc" });
    paintPluginCandle(s.ctx, s.args, "hollow", bar(105, 102), previous, 10);
    expect(s.calls.map(call => [call.op, call.color])).toEqual([["wick", "#aabbcc"], ["fill", "#112233"]]);
    const hollow = context({ downColor: "#445566", wickVisible: false });
    paintPluginCandle(hollow.ctx, hollow.args, "hollow", bar(95, 99), previous, 10);
    expect(hollow.calls.map(call => [call.op, call.color])).toEqual([["outline", "#445566"]]);
  });
  it("gives higher-volume bars larger widths and keeps zero-volume/doji geometry finite", () => {
    const s = context({ wickVisible: false });
    paintPluginCandle(s.ctx, s.args, "volumecandles", bar(99, 101, 0), previous, 100);
    paintPluginCandle(s.ctx, s.args, "volumecandles", bar(99, 101, 100), previous, 100);
    expect(s.calls[1].values[2]).toBeGreaterThan(s.calls[0].values[2]);
    paintPluginCandle(s.ctx, s.args, "volumecandles", bar(100, 100, 0), previous, 0);
    expect(s.calls.flatMap(call => call.values).every(Number.isFinite)).toBe(true);
    expect(s.calls.at(-1)!.values[3]).toBe(1);
  });
  it("registers active native SDK sections with complete paint controls and the Volume color switch", () => {
    registerChartStyles(); expect(chartType("hollow")?.settings).toEqual(candleLayerSettings("hollow"));
    expect(chartType("volumecandles")?.settings?.rows?.map(row => "key" in row ? row.key : "")).toEqual(["colorBasedOnPreviousClose", "bodyVisible", "borderVisible", "wickVisible"]);
    expect(chartType("hollow")?.basePainting).toBe("none");
  });
  it("rejects malformed plugin imports while resolving partial SDK bags and preserving false", () => {
    const value = defaultPluginCandles(); expect(validPluginCandles(value)).toBe(true);
    for (const invalid of [{}, { ...value, extra: {} }, { ...value, hollow: { ...value.hollow, bodyVisible: 0 } },
      { ...value, volumecandles: { ...value.volumecandles, upColor: "url(x)" } }, { ...value, volumecandles: { ...value.volumecandles, colorBasedOnPreviousClose: "false" } }]) expect(validPluginCandles(invalid)).toBe(false);
    const source = { hollow: { bodyVisible: false, upColor: "#112233" } }, copy = readPluginCandles(source);
    expect(copy.hollow.bodyVisible).toBe(false); expect(copy.hollow.upColor).toBe("#112233"); copy.hollow.upColor = "#ffffff";
    expect(source.hollow.upColor).toBe("#112233");
  });
  it("round-trips plugin styles per cell/layout/backup and accepts older series preferences", () => {
    const id = useWorkspaceStore.getState().activeId, host = seriesPreferencesHost(id), value = readSeriesPreferences(config())!;
    value.pluginCandles!.hollow.wickVisible = false; host.write(value);
    useWorkspaceStore.getState().saveLayout("Candle paint"); const layout = useWorkspaceStore.getState().layouts[0];
    useWorkspaceStore.getState().activate("cell-2"); expect(useChartStore.getState().seriesPreferences).toBeNull();
    useWorkspaceStore.getState().activate(id); expect(useChartStore.getState().seriesPreferences!.pluginCandles!.hollow.wickVisible).toBe(false);
    host.write({ ...value, pluginCandles: defaultPluginCandles() }); useWorkspaceStore.getState().loadLayout(layout.id);
    const backup = createWorkspaceBackup(); expect(parseWorkspace(JSON.stringify(backup)).chart.state.seriesPreferences).toEqual(host.read());
    delete value.pluginCandles; expect(validSeriesPreferences(value)).toBe(true);
  });
  it("restores legacy host choices to initial plugin defaults without touching other type bags or feedback", () => {
    const rendered = config(); let listener: (() => void) | undefined, native: (() => void) | undefined;
    let stored = readSeriesPreferences(rendered)!; const write = vi.fn();
    const merge = (patch: Record<string, unknown>, target: Record<string, unknown> = rendered) => { for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === "object") { if (!target[key]) target[key] = {}; merge(value as Record<string, unknown>, target[key] as Record<string, unknown>); } else target[key] = value;
    } };
    const dispose = bindSeriesPreferences({ getConfig: () => rendered, applyConfig: (patch: ReturnType<typeof nativeSeriesPreferences>) => { merge(patch); native?.(); }, onConfigChanged: (cb: () => void) => { native = cb; return () => {}; } } as unknown as Parameters<typeof bindSeriesPreferences>[0],
      { read: () => stored, write, subscribe: cb => { listener = cb; return () => {}; } });
    stored = structuredClone(stored); stored.pluginCandles!.hollow.bodyVisible = false; listener?.();
    expect(readSeriesPreferences(rendered)!.pluginCandles!.hollow.bodyVisible).toBe(false);
    delete stored.pluginCandles; listener?.(); expect(readSeriesPreferences(rendered)!.pluginCandles!.hollow.bodyVisible).toBe(true);
    expect(rendered.chartTypes.footprint.untouched).toBe(1); expect(write).not.toHaveBeenCalled(); dispose();
  });
});
