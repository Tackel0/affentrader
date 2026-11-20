import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chartViewKey, nativeChartView, readChartView, validChartView, type ChartViewPreferences } from "@/lib/chart/viewPreferences";
import { bindChartView, chartViewHost } from "@/lib/chart/viewBinding";
import { chartAppearanceHost } from "@/lib/chart/appearanceBinding";
import { bindDerivedSettingsPaint } from "@/lib/chart/derivedSettings";
import { seriesPreferencesHost } from "@/lib/chart/seriesBinding";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
import { parseWorkspace } from "@/lib/workspace";

const config = () => ({ version: 1, series: { style: "line" }, timeScale: { timezone: "UTC" },
  grid: { vertLines: { visible: true, color: "#111111" }, horzLines: { visible: true, color: "#222222" } },
  priceScale: { log: true, mode: "normal", invert: false, labelsVisible: true, currentPriceLine: true, priceLabel: true, countdown: true },
  crosshair: { style: "dashed", width: 1, opacity: 0.65, color: "#9598a1" } });
const defaults = () => readChartView(config())!;
const initialChart = useChartStore.getState(), initialWorkspace = useWorkspaceStore.getState();
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useChartStore.setState({ ...initialChart, chartView: null }, true);
  useWorkspaceStore.setState({ ...initialWorkspace, cells: structuredClone(initialWorkspace.cells), layouts: [] }, true);
});
afterEach(() => vi.restoreAllMocks());

function setup(saved: ChartViewPreferences | null = null) {
  let rendered = config(), stored: ChartViewPreferences | null | undefined = saved;
  let nativeListener: (() => void) | undefined, hostListener: (() => void) | undefined;
  const write = vi.fn((value: ChartViewPreferences) => { stored = structuredClone(value); hostListener?.(); });
  const applyConfig = vi.fn((patch: ReturnType<typeof nativeChartView>) => {
    rendered = { ...rendered, grid: { vertLines: { ...rendered.grid.vertLines, ...patch.grid.vertLines }, horzLines: { ...rendered.grid.horzLines, ...patch.grid.horzLines } },
      priceScale: { ...rendered.priceScale, ...patch.priceScale }, crosshair: { ...rendered.crosshair, ...patch.crosshair } };
    nativeListener?.(); return renderer;
  });
  const renderer = { getConfig: () => rendered, applyConfig,
    onConfigChanged: (listener: () => void) => { nativeListener = listener; return () => { nativeListener = undefined; }; } };
  const dispose = bindChartView(renderer as unknown as Parameters<typeof bindChartView>[0], { read: () => stored, write,
    subscribe: listener => { hostListener = listener; return () => { hostListener = undefined; }; } });
  return { dispose, write, applyConfig, rendered: () => rendered, stored: () => stored,
    native: (edit: (value: ReturnType<typeof config>) => void) => { edit(rendered); nativeListener?.(); },
    restore: (value: ChartViewPreferences | null | undefined) => { stored = value; hostListener?.(); } };
}

describe("native chart view persistence", () => {
  it("validates complete bounded controls and rejects extra or malformed nested fields", () => {
    const original = defaults(); expect(validChartView(original)).toBe(true);
    for (const value of [null, [], {}, { ...original, extra: true }, { ...original, grid: { vertical: true } },
      { ...original, priceScale: { ...original.priceScale, log: true } }, { ...original, crosshair: { ...original.crosshair, width: 0.1 } },
      { ...original, crosshair: { ...original.crosshair, width: 9 } }, { ...original, crosshair: { ...original.crosshair, opacity: NaN } },
      { ...original, crosshair: { ...original.crosshair, opacity: 1.1 } }]) expect(validChartView(value)).toBe(false);
    expect(validChartView({ ...original, crosshair: { ...original.crosshair, width: 0.5 } })).toBe(true);
  });

  it("extracts copies and writes narrow config patches without style, log, colors or zone ownership", () => {
    const native = config(), view = readChartView(native)!; view.grid.vertical = false;
    const patch = nativeChartView(view);
    expect(native.grid.vertLines.visible).toBe(true);
    expect(patch).not.toHaveProperty("series"); expect(patch).not.toHaveProperty("timeScale");
    expect(patch.priceScale).not.toHaveProperty("log"); expect(patch.grid.vertLines).not.toHaveProperty("color");
    expect(readChartView({})).toBeNull();
    expect(chartViewKey({ crosshair: view.crosshair, priceScale: view.priceScale, grid: view.grid })).toBe(chartViewKey(view));
  });

  it("restores preferences once without echoing config events or persisting startup defaults", () => {
    const saved = defaults(); saved.grid.vertical = false; saved.priceScale.invert = true;
    const s = setup(saved);
    expect(s.rendered().grid.vertLines.visible).toBe(false); expect(s.rendered().priceScale.invert).toBe(true);
    expect(s.rendered().priceScale.log).toBe(true); expect(s.rendered().series.style).toBe("line");
    expect(s.applyConfig).toHaveBeenCalledOnce(); expect(s.write).not.toHaveBeenCalled(); s.dispose();
    const empty = setup(); expect(empty.applyConfig).not.toHaveBeenCalled(); expect(empty.write).not.toHaveBeenCalled(); empty.dispose();
  });

  it("captures native changes once and ignores unrelated native config changes", () => {
    const s = setup(); s.native(value => { value.grid.vertLines.visible = false; });
    expect(s.write).toHaveBeenCalledOnce(); expect(s.stored()!.grid.vertical).toBe(false); expect(s.applyConfig).not.toHaveBeenCalled();
    s.native(value => { value.crosshair.color = "#ffffff"; value.timeScale.timezone = "Europe/Berlin"; });
    expect(s.write).toHaveBeenCalledOnce();
    s.rendered().grid.vertLines.visible = true; expect(s.stored()!.grid.vertical).toBe(false); s.dispose();
  });

  it("applies external restores and legacy defaults, ignores missing owners and disposes both listeners", () => {
    const s = setup(), next = defaults(); next.priceScale.countdown = false; next.crosshair.width = 0.5;
    s.restore(next); expect(s.rendered().priceScale.countdown).toBe(false); expect(s.rendered().crosshair.width).toBe(0.5);
    s.restore(undefined); expect(s.rendered().priceScale.countdown).toBe(false);
    s.restore(null); expect(readChartView(s.rendered())).toEqual(defaults()); expect(s.write).not.toHaveBeenCalled();
    const calls = s.applyConfig.mock.calls.length; s.dispose(); s.restore(next); s.native(value => { value.priceScale.invert = true; });
    expect(s.applyConfig).toHaveBeenCalledTimes(calls); expect(s.write).not.toHaveBeenCalled();
  });

  it("does not attach to renderers without the required public config surface", () => {
    const subscribe = vi.fn(), onConfigChanged = vi.fn();
    bindChartView({ getConfig: () => null, applyConfig: vi.fn(), onConfigChanged } as unknown as Parameters<typeof bindChartView>[0],
      { read: () => null, write: vi.fn(), subscribe })();
    expect(subscribe).not.toHaveBeenCalled(); expect(onConfigChanged).not.toHaveBeenCalled();
  });

  it("retains independent cells, named layouts, validated backups and legacy defaults", () => {
    const id = useWorkspaceStore.getState().activeId, host = chartViewHost(id), saved = defaults(); saved.grid.horizontal = false;
    host.write(saved); saved.grid.horizontal = true; expect(useChartStore.getState().chartView!.grid.horizontal).toBe(false);
    useWorkspaceStore.getState().saveLayout("View"); const layout = useWorkspaceStore.getState().layouts[0];
    useWorkspaceStore.getState().activate("cell-2"); expect(useChartStore.getState().chartView).toBeNull();
    const first = host.read()!; first.priceScale.invert = true; host.write(first);
    expect(useChartStore.getState().chartView).toBeNull(); useWorkspaceStore.getState().activate(id);
    expect(useChartStore.getState().chartView!.priceScale.invert).toBe(true);
    useWorkspaceStore.getState().loadLayout(layout.id); expect(useChartStore.getState().chartView!.priceScale.invert).toBe(false);
    const backup = createWorkspaceBackup(); expect(parseWorkspace(JSON.stringify(backup)).chart.state.chartView).toEqual(host.read());
    delete backup.chart.state.chartView; for (const cell of backup.premium!.state.cells as Array<Record<string, unknown>>) delete cell.chartView;
    expect(() => parseWorkspace(JSON.stringify(backup))).not.toThrow();
  });

  it("skips serializing renderer preferences on live market and Replay store updates", () => {
    const workspace = useWorkspaceStore.getState();
    workspace.setLayout("eight");
    const changed = vi.fn();
    const subscriptions = useWorkspaceStore.getState().cells.flatMap(({ id }) => [
      chartViewHost(id).subscribe(changed),
      chartAppearanceHost(id).subscribe(changed),
      seriesPreferencesHost(id).subscribe(changed),
      bindDerivedSettingsPaint(id, changed),
    ]);
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      for (let tick = 1; tick <= 100; tick++) {
        useChartStore.getState().set({
          candles: [{ time: tick, open: 100, high: 100, low: 100, close: 100, volume: 2 }],
        });
        useWorkspaceStore.getState().setReplay({ cursorTime: tick });
      }
      expect(stringify).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      const activeView = chartViewHost(workspace.activeId);
      activeView.write(defaults());
      expect(changed).toHaveBeenCalledOnce();
    } finally {
      stringify.mockRestore();
      subscriptions.forEach(unsubscribe => unsubscribe());
    }
  });

  it("rejects malformed chart/cell preferences and stops writes during application or removal", () => {
    const host = chartViewHost(useWorkspaceStore.getState().activeId);
    for (const location of ["chart", "cell"] as const) {
      const backup = createWorkspaceBackup(), malformed = { ...defaults(), grid: { vertical: "false", horizontal: true } };
      if (location === "chart") backup.chart.state.chartView = malformed;
      else (backup.premium!.state.cells as Array<Record<string, unknown>>)[0].chartView = malformed;
      expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(/chart view preferences/);
    }
    useWorkspaceStore.setState({ applyingCell: true }); host.write(defaults()); expect(host.read()).toBeUndefined();
    expect(useChartStore.getState().chartView).toBeNull(); useWorkspaceStore.setState({ applyingCell: false, cells: [] });
    host.write(defaults()); expect(useChartStore.getState().chartView).toBeNull();
  });
});
