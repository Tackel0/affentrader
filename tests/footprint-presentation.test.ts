import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chartType, type RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, footprintStep, paintFootprintBar, paintFootprintCandles, resolveFootprint, validFootprint, type FootprintPreferences } from "@/lib/orderflow/footprint";
import { footprints } from "@/lib/orderflow/math";
import { registerOrderflowPlugins } from "@/lib/orderflow/velaPlugins";
import { bindSeriesPreferences, seriesPreferencesHost } from "@/lib/chart/seriesBinding";
import { nativeSeriesPreferences, readSeriesPreferences, validSeriesPreferences } from "@/lib/chart/seriesPreferences";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
import { parseWorkspace } from "@/lib/workspace";
import type { Tick } from "@/types/trading";
import { defaultTpo, tpoSettings } from "@/lib/orderflow/tpoSettings";

const tick = (price: number, quantity: number, side: "buy" | "sell", time = 1000): Tick => ({ id: `${price}-${side}-${time}`, symbol: "BTCUSDT", price, quantity, side, time, simulated: false });
const trades = [tick(100, 2, "sell"), tick(100, 8, "buy"), tick(101, 4, "sell"), tick(101, 4, "buy")];
const candle = { time: 0, open: 100, high: 102, low: 99, close: 101, volume: 18 };
const args = (invert = false) => ({ coords: { timeToX: () => 100, pxPerBar: () => 100, width: 500,
  priceToY: (price: number) => invert ? (price - 95) * 20 : (110 - price) * 20 },
  scale: { min: 95, max: 110 }, bounds: { top: 0, height: 300 }, theme: { textColor: "#222222" } }) as unknown as RendererLayerArgs;
function canvas() {
  const calls: Array<{ kind: string; values: unknown[]; fill: string; stroke: string; align: string; alpha: number }> = [];
  const ctx = { fillStyle: "", strokeStyle: "", textAlign: "left", globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillRect(...values: number[]) { record("fill", values); }, strokeRect(...values: number[]) { record("outline", values); },
    fillText(...values: unknown[]) { record("text", values); } };
  const record = (kind: string, values: unknown[]) => calls.push({ kind, values, fill: ctx.fillStyle, stroke: ctx.strokeStyle, align: ctx.textAlign, alpha: ctx.globalAlpha });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
const nativeConfig = () => ({ candles: { upColor: "#089981", downColor: "#f23645", bodyVisible: true, borderVisible: false,
  borderUpColor: "#089981", borderDownColor: "#f23645", wickVisible: true, wickUpColor: "#089981", wickDownColor: "#f23645" },
  bars: { upColor: "#089981", downColor: "#f23645" }, line: { color: "#2962ff", width: 2 },
  area: { lineColor: "#2962ff", width: 2, topColor: "#2962ff44", bottomColor: "#2962ff00" },
  baseline: { topLineColor: "#089981", bottomLineColor: "#f23645", topFillColor: "#08998144", topFillColor2: "#08998100", bottomFillColor: "#f2364544", bottomFillColor2: "#f2364500", width: 2, baselineLevel: 50 },
  animations: { zoom: true, pan: true, autoscale: true, intro: false }, series: { spacing: 1 }, priceScale: { animateLastPrice: false }, chartTypes: { footprint: {}, tpo: { keep: true } } });
const chart = useChartStore.getState(), workspace = useWorkspaceStore.getState();
beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); useChartStore.setState({ ...chart, seriesPreferences: null }, true);
  useWorkspaceStore.setState({ ...workspace, cells: structuredClone(workspace.cells), layouts: [] }, true); });
afterEach(() => { useChartStore.setState(chart, true); useWorkspaceStore.setState(workspace, true); vi.restoreAllMocks(); });

describe("reference-style bid/ask footprint", () => {
  it("projects the canonical upper price rather than recomputing a drifting decimal sum", () => {
    const view = args(), project = vi.fn((price: number) => price * 1000); view.coords.priceToY = project;
    const { ctx } = canvas(); paintFootprintBar(ctx, view, footprints([tick(.2, 1, "buy")], "1m", .1)[0], undefined, .1, defaultFootprint());
    expect(new Set(project.mock.calls.map(call => call[0]))).toEqual(new Set([.2, .3]));
    view.scale = { min: 0, max: 4.8 } as RendererLayerArgs["scale"];
    expect(footprintStep(view, defaultFootprint(), 100000, .1)).toBe(.1);
  });
  it("paints one total-volume value per row and scales against the largest combined row", () => {
    const { ctx, calls } = canvas(); const bar = footprints(trades, "1m", 1)[0];
    paintFootprintBar(ctx, args(), bar, undefined, 1, { ...defaultFootprint(), volumeMode: "total", volumeSplit: false, stackedVisible: false });
    expect(calls.filter(c => c.kind === "text").map(c => [c.values[0], c.align, c.fill])).toEqual([["10", "left", "#d1d4dc"], ["8", "left", "#d1d4dc"]]);
    const fills = calls.filter(c => c.kind === "fill");
    expect(fills[0].values).toEqual([67, 180, 74, 19]);
    expect(fills[1].values[2]).toBeCloseTo(59.2);
    expect(calls.filter(c => c.kind === "outline").map(c => c.values)).toEqual([[67.5, 180.5, 73, 18]]);
    expect(bar).toMatchObject({ volume: 18, delta: 6, poc: 100 });
  });
  it("paints signed delta using its own absolute maximum and preserves total-volume POC", () => {
    const bar = footprints([tick(100, 5, "buy"), tick(100, 3, "sell"), tick(101, 3, "sell"), tick(102, 1, "buy"), tick(102, 1, "sell")], "1m", 1)[0];
    const { ctx, calls } = canvas(); paintFootprintBar(ctx, args(), bar, undefined, 1, { ...defaultFootprint(), volumeMode: "delta" });
    expect(calls.filter(c => c.kind === "text").map(c => [c.values[0], c.fill])).toEqual([["+2", "#d1d4dc"], ["-3", "#d1d4dc"], ["0", "#d1d4dc"]]);
    const fills = calls.filter(c => c.kind === "fill"); expect(fills).toHaveLength(2);
    expect(fills[0].values[0]).toBe(104); expect(fills[0].values[2]).toBeCloseTo(37 * 2 / 3);
    expect(fills[1].values).toEqual([67, 160, 37, 19]);
    expect(calls.filter(c => c.kind === "outline").map(c => c.values[1])).toEqual([180.5]);
  });
  it("preserves exact zero and tiny-volume normalization with mode-specific histograms disabled", () => {
    for (const volumeMode of ["bid-ask", "total", "delta"] as const) {
      const bar = footprints([tick(100, 1e-16, "buy"), tick(101, 1e-16, "buy"), tick(101, 1e-16, "sell")], "1m", 1)[0];
      const { ctx, calls } = canvas(); paintFootprintBar(ctx, args(), bar, undefined, 1, { ...defaultFootprint(), volumeMode, volumeSplit: false, pocVisible: false });
      const widths = calls.filter(c => c.kind === "fill").map(c => c.values[2]);
      expect(Math.max(...widths as number[])).toBe(volumeMode === "total" ? 74 : 37);
      const hidden = canvas(); paintFootprintBar(hidden.ctx, args(), bar, undefined, 1,
        { ...defaultFootprint(), volumeMode, histogramVisible: false, pocVisible: false });
      expect(hidden.calls.every(c => c.kind === "text")).toBe(true);
      expect(hidden.calls).toHaveLength(volumeMode === "bid-ask" ? 3 : 2);
    }
  });
  it("keeps all-balanced delta rows neutral without a zero-denominator histogram on either axis", () => {
    const bar = footprints([tick(100, 2, "buy"), tick(100, 2, "sell"), tick(101, 1, "buy"), tick(101, 1, "sell")], "1m", 1)[0];
    for (const inverted of [false, true]) {
      const { ctx, calls } = canvas(); paintFootprintBar(ctx, args(inverted), bar, undefined, 1,
        { ...defaultFootprint(), volumeMode: "delta", textColorAuto: false, textColor: "#aabbcc" });
      expect(calls.filter(c => c.kind === "fill")).toEqual([]);
      expect(calls.filter(c => c.kind === "text")).toEqual([]);
      expect(calls.filter(c => c.kind === "outline")[0].values).toEqual([67.5, inverted ? 100.5 : 180.5, 73, 18]);
    }
  });
  it("validates modes strictly and migrates both original and advanced legacy preferences", () => {
    const legacy: FootprintPreferences = { ...defaultFootprint() }; delete legacy.volumeMode;
    expect(validFootprint(legacy)).toBe(true); expect(resolveFootprint(legacy).volumeMode).toBe("bid-ask");
    for (const volumeMode of ["bid-ask", "total", "delta"] as const) expect(validFootprint({ ...legacy, volumeMode })).toBe(true);
    for (const volumeMode of [null, undefined, 1, "Delta", "", "other"]) {
      expect(validFootprint({ ...legacy, volumeMode })).toBe(false);
      expect(resolveFootprint({ ...legacy, volumeMode }).volumeMode).toBe("bid-ask");
    }
    expect(footprintSettings().rows!.find(row => row.kind === "select" && row.key === "volumeMode")).toMatchObject({
      kind: "select", defval: "bid-ask", options: [["bid-ask", "Bid × Ask Profile"], ["bid-ask-ladder", "Bid × Ask Ladder"], ["total", "Volume Profile"], ["delta", "Delta Profile"], ["absolute-delta", "Absolute Delta"]] });
  });
  it("retains actual OHLC candles when zoom hides detailed footprint rows, including Replay", () => {
    const view = args(); view.coords.pxPerBar = () => 5;
    const { ctx, calls } = canvas();
    paintFootprintBar(ctx, view, footprints(trades, "1m", 1)[0], candle, 1,
      { ...defaultFootprint(), stackedVisible: true, statisticsVisible: true });
    expect(calls.map(c => c.kind)).toEqual(["fill"]);
    expect(calls[0].values).toEqual([98.5, 180, 3, 20]);
    expect(calls[0].fill).toBe("#089981");
    const hidden = canvas(); paintFootprintBar(hidden.ctx, view, footprints(trades, "1m", 1)[0], candle, 1,
      { ...defaultFootprint(), candleVisible: false }); expect(hidden.calls).toEqual([]);
  });
  it("paints exact statistics and delegates projected stacks to the overlay on both price axes", () => {
    const source = footprints([tick(100, 1, "buy"), tick(101, 2, "buy"), tick(102, 3, "buy")], "1m", 1)[0];
    for (const inverted of [false, true]) {
      const { ctx, calls } = canvas(); paintFootprintBar(ctx, args(inverted), source, undefined, 1,
        { ...defaultFootprint(), stackedVisible: true, statisticsVisible: true, candleVisible: false, histogramVisible: false, pocVisible: false });
      expect(calls.filter(c => c.kind === "outline")).toEqual([]);
      const text = calls.filter(c => c.kind === "text").map(c => c.values[0]); expect(text.slice(-6)).toEqual(["Volume", "6", "Delta", "+6", "Delta %", "100%"]);
    }
  });
  it("labels negative and zero deltas independently from price candle direction", () => {
    for (const [buy, sell, delta, percent] of [[1, 3, "-2", "-50%"], [2, 2, "0", "0%"]] as const) {
      const { ctx, calls } = canvas(); paintFootprintBar(ctx, args(), footprints([tick(100, buy, "buy"), tick(100, sell, "sell")], "1m", 1)[0], candle, 1,
        { ...defaultFootprint(), statisticsVisible: true });
      expect(calls.filter(c => c.kind === "text").slice(-4).map(c => c.values[0])).toEqual(["Delta", delta, "Delta %", percent]);
    }
  });
  it("draws independently scaled bid/ask halves, a separate candle and exactly one POC outline", () => {
    const { ctx, calls } = canvas(); paintFootprintBar(ctx, args(), footprints(trades, "1m", 1)[0], candle, 1, { ...defaultFootprint(), gradientCells: false });
    const fills = calls.filter(c => c.kind === "fill"), outline = calls.find(c => c.kind === "outline")!;
    expect(fills).toHaveLength(5); expect(calls.filter(c => c.kind === "outline")).toHaveLength(1);
    expect(fills[0].values[2]).toBe(4);
    expect(fills[1].fill).toBe("#f23645"); expect(fills[2].fill).toBe("#089981");
    expect(fills[2].values[2]).toBe(Number(fills[1].values[2]) * 4);
    expect(Number(fills[0].values[0]) + 4).toBeLessThan(Number(outline.values[0]));
    const text = calls.filter(c => c.kind === "text");
    expect(text.map(c => c.values[0])).toEqual(["2", "8", "4", "4"]);
    expect(text.map(c => c.align)).toEqual(["right", "left", "right", "left"]);
    expect(Number(text[0].values[1])).toBeLessThan(Number(text[1].values[1]));
  });
  it("honors histogram/candle/POC switches while retaining bid/ask text on inverted axes", () => {
    const { ctx, calls } = canvas(); paintFootprintBar(ctx, args(true), footprints(trades, "1m", 1)[0], candle, 1,
      { ...defaultFootprint(), histogramVisible: false, candleVisible: false, pocVisible: false, imbalanceVisible: false, imbalanceRecolor: false });
    expect(calls.every(c => c.kind === "text")).toBe(true); expect(calls).toHaveLength(4);
    expect(calls.every(c => c.fill === "#d1d4dc")).toBe(true);
    expect(calls.flatMap(c => c.values.filter(value => typeof value === "number")).every(Number.isFinite)).toBe(true);
  });
  it("retains real OHLC side candles without manufacturing order flow for unobserved or Replay history", () => {
    const { ctx, calls } = canvas(), view = args();
    view.bars = [candle]; view.coords.visibleTimeRange = () => ({ from: 0, to: 60000 });
    paintFootprintCandles(ctx, view, defaultFootprint());
    expect(calls.map(c => c.kind)).toEqual(["fill"]); expect(calls[0].values[2]).toBe(4);
    paintFootprintCandles(ctx, view, { ...defaultFootprint(), candleVisible: false }); expect(calls).toHaveLength(1);
  });
  it("uses custom text and side colors and retains candles when detailed rows are too narrow", () => {
    const { ctx, calls } = canvas(); const style = { ...defaultFootprint(), gradientCells: false, buyColor: "#123456", sellColor: "#abcdef", askColor: "#123456", bidColor: "#abcdef", textColor: "#fedcba", textColorAuto: false, imbalanceVisible: false, imbalanceRecolor: false };
    paintFootprintBar(ctx, args(), footprints(trades, "1m", 1)[0], candle, 1, style);
    expect(calls.filter(c => c.kind === "text").every(c => c.fill === "#fedcba")).toBe(true);
    expect(calls.some(c => c.fill === "#123456")).toBe(true); expect(calls.some(c => c.fill === "#abcdef")).toBe(true);
    const narrow = args(); narrow.coords.pxPerBar = () => 20; const before = calls.length;
    paintFootprintBar(ctx, narrow, footprints(trades, "1m", 1)[0], candle, 1, style);
    const narrowCalls = calls.slice(before); expect(narrowCalls.filter(call => call.kind === "fill").length).toBeGreaterThan(1);
    expect(narrowCalls.some(call => call.kind === "text")).toBe(false);
    expect(narrowCalls[0]).toMatchObject({ kind: "fill", fill: "#123456" });
  });
  it("keeps manual row grids fixed and resolves bounded partial native bags", () => {
    const source = { rowSize: .5, candleVisible: false, rowHeight: 999, imbalanceRatio: NaN, textColor: "url(x)" };
    const style = resolveFootprint(source); expect(style).toEqual({ ...defaultFootprint(), rowSize: .5, candleVisible: false });
    expect(footprintStep(args(), style, 100)).toBe(.5);
    expect(() => footprintStep(args(), defaultFootprint(), 100)).toThrow("verified venue");
    expect(footprintStep(args(), defaultFootprint(), 100, .01)).toBeGreaterThan(0);
    expect(validFootprint(defaultFootprint())).toBe(true);
    for (const invalid of [{}, { ...style, extra: 1 }, { ...style, rowSize: -1 }, { ...style, rowHeight: 12.5 }, { ...style, pocVisible: "false" }]) expect(validFootprint(invalid)).toBe(false);
  });
  it("registers the native settings page and removes the overlapping base candle", () => {
    registerOrderflowPlugins(); expect(chartType("footprint")?.basePainting).toBe("none");
    expect(chartType("footprint")?.settings).toEqual(footprintSettings());
    expect(chartType("tpo")?.settings).toEqual(tpoSettings());
  });
  it("retains simultaneous diagonal imbalances instead of suppressing one side", () => {
    const bar = footprints([tick(99, 1, "sell"), tick(100, 5, "buy"), tick(100, 6, "sell"), tick(101, 1, "buy")], "1m", 1)[0];
    const level = bar.levels.find(l => l.price === 100)!;
    expect(level.buyImbalance).toBe(true); expect(level.sellImbalance).toBe(true);
    expect(footprints(trades, "1m", 1, 10)[0].levels[1].buyImbalance).toBe(false);
  });
  it("aligns weekly/monthly footprints to the candle calendar and refuses synthetic tick timestamps", () => {
    const monday = Date.UTC(2026, 9, 26), november = Date.UTC(2026, 10, 1);
    expect(footprints([tick(100, 1, "buy", monday + 2 * 86400000)], "1W", 1)[0].time).toBe(monday);
    expect(footprints([tick(100, 1, "buy", november + 86400000)], "1M", 1)[0].time).toBe(november);
    expect(footprints(trades, "100T", 1)).toEqual([]);
    expect(footprints([...trades, tick(NaN, 5, "buy"), tick(100, -2, "sell")], "1m", 1)[0].volume).toBe(18);
  });
  it("round-trips footprint settings through independent cells, layouts and strict backups", () => {
    const id = useWorkspaceStore.getState().activeId, host = seriesPreferencesHost(id), value = readSeriesPreferences(nativeConfig())!;
    const multiple = { ...defaultFootprint(), rowSize: 10, pocVisible: false, stackedVisible: true, stackedRows: 4, imbalanceMinVolume: .25, ignoreZeroOpposite: true, statisticsVisible: true,
      volumeMode: "delta" as const, fp2Enabled: true, fp2RowSize: .5, fp2Position: "left", fp2BuyColor: "#123456", fp2StatisticsVisible: true, fp2StatisticsPosition: "above", fp2StatBuyPct: true, fp2StatTradeCount: true, fp2StatisticsSize: 12,
      fp2MinBidVolume: .25, fp2MaxAskVolume: 100, vrEnabled: true, vrWidthPercent: 42, vrVolumeMode: "total", vrMinBidVolume: .25, vrBuyColor: "#12345680", fp2ImbalanceRecolor: false, fp2StackedRows: 40, fp2StackedBuyColor: "#12345680", fp5Enabled: false, fp5ImbalanceRecolor: true, fp5VolumeMode: "absolute-delta", fp5StatAskCount: true, fp5MaxVolume: 7, fp5StackedSellColor: "rgba(4,5,6,0.3)", readoutInstance: "2" };
    value.footprint = multiple; host.write(value);
    expect(readSeriesPreferences({ ...nativeConfig(), ...nativeSeriesPreferences(value) })!.footprint).toMatchObject(multiple);
    useWorkspaceStore.getState().saveLayout("Footprint"); const layout = useWorkspaceStore.getState().layouts[0];
    useWorkspaceStore.getState().activate("cell-2"); expect(useChartStore.getState().seriesPreferences).toBeNull();
    useWorkspaceStore.getState().activate(id); expect(host.read()!.footprint!.rowSize).toBe(10);
    host.write({ ...value, footprint: defaultFootprint() }); useWorkspaceStore.getState().loadLayout(layout.id);
    const backup = createWorkspaceBackup();
    const restored = parseWorkspace(JSON.stringify(backup)).chart.state.seriesPreferences as NonNullable<ReturnType<typeof readSeriesPreferences>>;
    expect(restored.footprint).toEqual(value.footprint);
    (backup.chart.state.seriesPreferences as NonNullable<ReturnType<typeof readSeriesPreferences>>).footprint!.rowHeight = 999;
    expect(() => parseWorkspace(JSON.stringify(backup))).toThrow();
    delete value.footprint; expect(validSeriesPreferences(value)).toBe(true);
  });
  it("restores legacy preferences to initial footprint defaults without erasing unrelated bags", () => {
    const config = nativeConfig(); let stored = readSeriesPreferences(config)!, update: (() => void) | undefined;
    const merge = (patch: Record<string, unknown>, target: Record<string, unknown> = config) => { for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === "object") { target[key] ??= {}; merge(value as Record<string, unknown>, target[key] as Record<string, unknown>); } else target[key] = value;
    } };
    const dispose = bindSeriesPreferences({ getConfig: () => config, applyConfig: (patch: ReturnType<typeof nativeSeriesPreferences>) => merge(patch), onConfigChanged: () => () => {} } as unknown as Parameters<typeof bindSeriesPreferences>[0],
      { read: () => stored, write: () => {}, subscribe: cb => { update = cb; return () => {}; } });
    stored.footprint = { ...defaultFootprint(), rowSize: 5 }; update?.(); expect(readSeriesPreferences(config)!.footprint!.rowSize).toBe(5);
    delete stored.footprint; update?.(); expect(readSeriesPreferences(config)!.footprint!.rowSize).toBe(0);
    expect(config.chartTypes.tpo.keep).toBe(true); dispose();
  });
  it("round-trips TPO sessions/paint through independent cells, layouts and guarded backups", () => {
    const owner = useWorkspaceStore.getState().activeId, host = seriesPreferencesHost(owner), value = readSeriesPreferences(nativeConfig())!;
    value.tpo = { ...defaultTpo(), rowSize: 5, sessionZone: "America/New_York", sessionStartMinutes: 570, sessionMinutes: 390, weekdaysOnly: true, splitPeriods: true };
    host.write(value); useWorkspaceStore.getState().saveLayout("TPO session"); const layout = useWorkspaceStore.getState().layouts[0];
    useWorkspaceStore.getState().activate("cell-2"); expect(useChartStore.getState().seriesPreferences).toBeNull();
    useWorkspaceStore.getState().activate(owner); expect(host.read()!.tpo).toEqual(value.tpo);
    host.write({ ...value, tpo: defaultTpo() }); useWorkspaceStore.getState().loadLayout(layout.id);
    const backup = createWorkspaceBackup(), imported = parseWorkspace(JSON.stringify(backup));
    expect((imported.chart.state.seriesPreferences as typeof value).tpo).toEqual(value.tpo);
    (backup.chart.state.seriesPreferences as typeof value).tpo!.sessionMinutes = Infinity;
    expect(() => parseWorkspace(JSON.stringify(backup))).toThrow();
    delete value.tpo; expect(validSeriesPreferences(value)).toBe(true);
  });
  it("keeps session-profile study inputs isolated across cells, layouts and JSON backup", () => {
    const owner = useWorkspaceStore.getState().activeId;
    const indicator = { id: "test-session-profile", definitionId: "session-profile", name: "SVP", visible: true,
      inputs: { rows: 24, sessionZone: "Europe/Berlin", rowSize: 1, showPoc: false, volumeMode: "Delta" },
      color: "#2962ff", lineWidth: 2, source: "close" as const };
    useChartStore.getState().addIndicator(indicator); useWorkspaceStore.getState().saveLayout("Session profile");
    const layout = useWorkspaceStore.getState().layouts[0];
    useWorkspaceStore.getState().activate("cell-2");
    expect(useChartStore.getState().indicators.some(study => study.id === indicator.id)).toBe(false);
    useWorkspaceStore.getState().activate(owner); expect(useChartStore.getState().indicators.find(study => study.id === indicator.id)?.inputs).toEqual(indicator.inputs);
    useChartStore.getState().removeIndicator(indicator.id); useWorkspaceStore.getState().loadLayout(layout.id);
    const imported = parseWorkspace(JSON.stringify(createWorkspaceBackup()));
    expect((imported.chart.state.indicators as typeof indicator[]).find(study => study.id === indicator.id)?.inputs).toEqual(indicator.inputs);
  });
});
