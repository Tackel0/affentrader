import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindSeriesPreferences, seriesPreferencesHost } from "@/lib/chart/seriesBinding";
import { nativeSeriesPreferences, readSeriesPreferences, validSeriesPreferences, type SeriesPreferences } from "@/lib/chart/seriesPreferences";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
import { parseWorkspace } from "@/lib/workspace";

const defaults = (): SeriesPreferences => ({
  candles: { upColor: "#089981", downColor: "#f23645", bodyVisible: true, borderVisible: false, borderUpColor: "#089981", borderDownColor: "#f23645", wickVisible: true, wickUpColor: "#089981", wickDownColor: "#f23645" },
  bars: { upColor: "#089981", downColor: "#f23645" }, line: { color: "#2962ff", width: 2 },
  area: { lineColor: "#2962ff", width: 2, topColor: "rgba(41,98,255,0.4)", bottomColor: "rgba(41,98,255,0)" },
  baseline: { topLineColor: "#089981", bottomLineColor: "#f23645", topFillColor: "#08998144", topFillColor2: "#08998100", bottomFillColor: "#f2364544", bottomFillColor2: "#f2364500", width: 2, baselineLevel: 50 },
  animations: { zoom: true, pan: true, autoscale: true, intro: false }, animateLastPrice: false, spacing: 1,
});
const config = () => ({ ...nativeSeriesPreferences(defaults()), series: { style: "candles", spacing: 1 },
  priceScale: { animateLastPrice: false, mode: "percent", log: false }, layout: { background: "#000000" }, timeScale: { timezone: "UTC" } });
const initialChart = useChartStore.getState(), initialWorkspace = useWorkspaceStore.getState();
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useChartStore.setState({ ...initialChart, seriesPreferences: null }, true);
  useWorkspaceStore.setState({ ...initialWorkspace, cells: structuredClone(initialWorkspace.cells), layouts: [] }, true);
});
afterEach(() => vi.restoreAllMocks());

function setup(saved: SeriesPreferences | null = null, footprint?: Record<string, unknown>) {
  let rendered = config(), stored: SeriesPreferences | null | undefined = saved;
  if (footprint) Object.assign(rendered, { chartTypes: { footprint } });
  let native: (() => void) | undefined, external: (() => void) | undefined;
  const merge = (patch: Record<string, unknown>, target: Record<string, unknown> = rendered) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === "object") { if (!target[key] || typeof target[key] !== "object") target[key] = {}; merge(value as Record<string, unknown>, target[key] as Record<string, unknown>); }
      else target[key] = value;
    }
  };
  const applyConfig = vi.fn((patch: ReturnType<typeof nativeSeriesPreferences>) => { merge(patch); native?.(); });
  const write = vi.fn((value: SeriesPreferences) => { stored = structuredClone(value); external?.(); });
  const renderer = { getConfig: () => rendered, applyConfig,
    onConfigChanged: (listener: () => void) => { native = listener; return () => { native = undefined; }; } };
  const dispose = bindSeriesPreferences(renderer as unknown as Parameters<typeof bindSeriesPreferences>[0], {
    read: () => stored, write, subscribe: listener => { external = listener; return () => { external = undefined; }; },
  });
  return { rendered: () => rendered, stored: () => stored, applyConfig, write, dispose,
    edit: (patch: Record<string, unknown>) => { merge(patch); native?.(); },
    restore: (value: SeriesPreferences | null | undefined) => { stored = value; external?.(); } };
}
describe("native series presentation persistence", () => {
  it("strictly validates native style, spacing and animation bounds", () => {
    const value = defaults(); expect(validSeriesPreferences(value)).toBe(true);
    for (const invalid of [null, [], {}, { ...value, extra: 1 }, { ...value, spacing: 0 }, { ...value, spacing: 11 },
      { ...value, animateLastPrice: "false" }, { ...value, candles: { ...value.candles, bodyVisible: 0 } },
      { ...value, line: { ...value.line, width: NaN } }, { ...value, line: { ...value.line, width: 11 } },
      { ...value, area: { ...value.area, bottomColor: "url(x)" } }, { ...value, baseline: { ...value.baseline, baselineLevel: 101 } },
      { ...value, animations: { zoom: true } }]) expect(validSeriesPreferences(invalid)).toBe(false);
    expect(validSeriesPreferences({ ...value, spacing: 0.1, baseline: { ...value.baseline, baselineLevel: 0 } })).toBe(true);
  });
  it("copies a complete presentation while excluding style choice, scale mode, canvas and time zone", () => {
    const rendered = config(), value = readSeriesPreferences(rendered)!;
    value.candles.bodyVisible = false; value.line.width = 4;
    expect(rendered.candles.bodyVisible).toBe(true); expect(rendered.line.width).toBe(2);
    const patch = nativeSeriesPreferences(value);
    expect(patch.series).toEqual({ spacing: 1 }); expect(patch.priceScale).toEqual({ animateLastPrice: false });
    expect(patch).not.toHaveProperty("layout"); expect(patch).not.toHaveProperty("timeScale"); expect(readSeriesPreferences({})).toBeNull();
  });
  it("restores all saved style families and motion atomically without startup feedback", () => {
    const value = defaults(); value.candles.bodyVisible = false; value.bars.downColor = "#aabbcc"; value.line.width = 5;
    value.area.topColor = "#11223344"; value.baseline.baselineLevel = 35; value.spacing = 1.5; value.animations.zoom = false; value.animateLastPrice = true;
    const s = setup(value); expect(readSeriesPreferences(s.rendered())).toEqual(value); expect(s.applyConfig).toHaveBeenCalledOnce(); expect(s.write).not.toHaveBeenCalled();
    expect(s.rendered().series.style).toBe("candles"); expect(s.rendered().priceScale.mode).toBe("percent"); s.dispose();
  });
  it("captures native changes without rerunning or claiming unrelated native controls", () => {
    const s = setup(); s.edit({ candles: { bodyVisible: false, upColor: "#aa22ff" }, animations: { pan: false } });
    expect(s.write).toHaveBeenCalledOnce(); expect(s.stored()!.candles.bodyVisible).toBe(false); expect(s.stored()!.animations.pan).toBe(false);
    s.edit({ series: { style: "line" }, priceScale: { log: true }, layout: { background: "#ffffff" }, timeScale: { timezone: "Europe/Berlin" } });
    expect(s.write).toHaveBeenCalledOnce(); expect(s.applyConfig).not.toHaveBeenCalled(); s.dispose();
  });
  it("seeds palette defaults before a first candle-color edit and preserves old shared colors", () => {
    for (const initial of [{}, { buyColor: "#123456", sellColor: "#abcdef" }]) {
      const s = setup(null, initial); expect(s.applyConfig).toHaveBeenCalledOnce(); expect(s.write).not.toHaveBeenCalled();
      const before = readSeriesPreferences(s.rendered())!.footprint!;
      expect(before.askColor).toBe("buyColor" in initial ? initial.buyColor : "#089981");
      s.edit({ chartTypes: { footprint: { buyColor: "#fedcba" } } });
      const after = readSeriesPreferences(s.rendered())!.footprint!;
      expect(after.buyColor).toBe("#fedcba"); expect(after.askColor).toBe(before.askColor); expect(after.volumeBuyColor).toBe(before.volumeBuyColor); expect(after.deltaUpColor).toBe(before.deltaUpColor);
      expect(s.applyConfig).toHaveBeenCalledOnce(); s.dispose();
    }
  });
  it("restores legacy defaults, fences missing ownership and stops both listeners on disposal", () => {
    const s = setup(), value = defaults(); value.line.width = 5;
    s.restore(value); expect(s.rendered().line.width).toBe(5);
    s.restore(undefined); s.edit({ candles: { bodyVisible: false } }); expect(s.write).not.toHaveBeenCalled();
    s.restore(null); expect(readSeriesPreferences(s.rendered())).toEqual(defaults());
    const calls = s.applyConfig.mock.calls.length; s.dispose(); s.restore(value); s.edit({ line: { width: 3 } });
    expect(s.applyConfig).toHaveBeenCalledTimes(calls); expect(s.write).not.toHaveBeenCalled();
  });
  it("retains independent cells, named layouts and validated backup round trips", () => {
    const id = useWorkspaceStore.getState().activeId, host = seriesPreferencesHost(id), value = defaults();
    value.candles.bodyVisible = false; host.write(value); value.candles.bodyVisible = true;
    expect(host.read()!.candles.bodyVisible).toBe(false);
    useWorkspaceStore.getState().saveLayout("Series"); const layout = useWorkspaceStore.getState().layouts[0];
    useWorkspaceStore.getState().activate("cell-2"); expect(useChartStore.getState().seriesPreferences).toBeNull();
    value.line.width = 5; host.write(value); expect(useChartStore.getState().seriesPreferences).toBeNull();
    useWorkspaceStore.getState().activate(id); expect(useChartStore.getState().seriesPreferences!.line.width).toBe(5);
    useWorkspaceStore.getState().loadLayout(layout.id); expect(useChartStore.getState().seriesPreferences!.line.width).toBe(2);
    const backup = createWorkspaceBackup(); expect(parseWorkspace(JSON.stringify(backup)).chart.state.seriesPreferences).toEqual(host.read());
    delete backup.chart.state.seriesPreferences; for (const cell of backup.premium!.state.cells as Array<Record<string, unknown>>) delete cell.seriesPreferences;
    expect(() => parseWorkspace(JSON.stringify(backup))).not.toThrow();
  });
  it("rejects malformed chart/cell imports and applying/removed owner writes", () => {
    for (const target of ["chart", "cell"]) {
      const backup = createWorkspaceBackup(), invalid = { ...defaults(), spacing: Infinity };
      if (target === "chart") backup.chart.state.seriesPreferences = invalid;
      else (backup.premium!.state.cells as Array<Record<string, unknown>>)[0].seriesPreferences = invalid;
      expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(/series preferences/);
    }
    const host = seriesPreferencesHost(useWorkspaceStore.getState().activeId);
    useWorkspaceStore.setState({ applyingCell: true }); host.write(defaults()); expect(host.read()).toBeUndefined();
    useWorkspaceStore.setState({ applyingCell: false, cells: [] }); host.write(defaults()); expect(host.read()).toBeUndefined();
    expect(useChartStore.getState().seriesPreferences).toBeNull();
  });
});
