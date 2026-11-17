import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindDerivedSettingsPaint, derivedSettingsForCell, resetDerivedSetting, updateDerivedSettings, validBoxSizing, validChartTypeSettings } from "@/lib/chart/derivedSettings";
import { DEFAULT_CHART_TYPE_SETTINGS } from "@/lib/chart/chartTypes";
import { boxSize, renko } from "@/lib/chart/transforms";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
import { parseWorkspace } from "@/lib/workspace";
import type { OHLCV } from "@/types/trading";

const defaults = () => structuredClone(DEFAULT_CHART_TYPE_SETTINGS);
const initialChart = useChartStore.getState(), initialWorkspace = useWorkspaceStore.getState();
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useChartStore.setState({ ...initialChart, chartTypeSettings: defaults() }, true);
  useWorkspaceStore.setState({ ...initialWorkspace, cells: structuredClone(initialWorkspace.cells), layouts: [] }, true);
});
afterEach(() => vi.restoreAllMocks());

describe("cell-owned derived chart parameters", () => {
  it("validates complete settings and strict sizing modes with finite bounded integer controls", () => {
    expect(validChartTypeSettings(defaults())).toBe(true);
    for (const value of [null, [], {}, { mode: "atr", length: 0 }, { mode: "atr", length: 1.5 }, { mode: "atr", length: 201 },
      { mode: "fixed", size: Infinity }, { mode: "fixed", size: 0 }, { mode: "fixed", size: 1, extra: true }, { mode: "percent", percent: NaN }, { mode: "percent", percent: -1 }]) expect(validBoxSizing(value)).toBe(false);
    for (const invalid of [{}, { ...defaults(), extra: true }, { ...defaults(), range: { mode: "percent", percent: 0 } },
      { ...defaults(), pointfigure: { sizing: { mode: "fixed", size: 1 }, reversal: 2.5 } }, { ...defaults(), linebreak: { lines: 11 } },
      { ...defaults(), baseline: { levelPercent: 101 } }]) expect(validChartTypeSettings(invalid)).toBe(false);
  });
  it("resolves primary and inactive cells independently and copies edits", () => {
    const id = useWorkspaceStore.getState().activeId, patch = { mode: "fixed" as const, size: 100 };
    expect(updateDerivedSettings(id, { renko: patch })).toBe(true); patch.size = 999;
    expect(derivedSettingsForCell("primary")!.renko).toEqual({ mode: "fixed", size: 100 });
    expect(derivedSettingsForCell("cell-2")!.renko).toEqual({ mode: "atr", length: 14 });
    useWorkspaceStore.getState().activate("cell-2");
    expect(derivedSettingsForCell("primary")!.renko).toEqual({ mode: "atr", length: 14 });
    expect(derivedSettingsForCell(id)!.renko).toEqual({ mode: "fixed", size: 100 });
    updateDerivedSettings(id, { renko: { mode: "fixed", size: 200 } });
    expect(useChartStore.getState().chartTypeSettings.renko.mode).toBe("atr");
    useWorkspaceStore.getState().activate(id); expect(useChartStore.getState().chartTypeSettings.renko).toEqual({ mode: "fixed", size: 200 });
  });
  it("uses different actual Renko math inputs for independent chart cells", () => {
    const id = useWorkspaceStore.getState().activeId;
    updateDerivedSettings(id, { renko: { mode: "fixed", size: 1 } }); updateDerivedSettings("cell-2", { renko: { mode: "fixed", size: 2 } });
    const bars: OHLCV[] = [100, 101, 102, 103, 104].map((close, time) => ({ time: time * 60000, open: close, high: close, low: close, close, volume: 1 }));
    const first = renko(bars, boxSize(bars, derivedSettingsForCell("primary")!.renko));
    const second = renko(bars, boxSize(bars, derivedSettingsForCell("cell-2")!.renko));
    expect(first).toHaveLength(4); expect(second).toHaveLength(2);
  });
  it("resets only the selected family and preserves other families and the other cell", () => {
    const id = useWorkspaceStore.getState().activeId;
    updateDerivedSettings(id, { renko: { mode: "fixed", size: 100 }, range: { mode: "fixed", size: 25 } });
    updateDerivedSettings("cell-2", { renko: { mode: "fixed", size: 200 } }); resetDerivedSetting(id, "renko");
    expect(derivedSettingsForCell(id)!.renko).toEqual(defaults().renko); expect(derivedSettingsForCell(id)!.range).toEqual({ mode: "fixed", size: 25 });
    expect(derivedSettingsForCell("cell-2")!.renko).toEqual({ mode: "fixed", size: 200 });
  });
  it("repaints only relevant cells immediately, ignores unrelated state and detaches subscriptions", () => {
    const id = useWorkspaceStore.getState().activeId, invalidate = vi.fn(), disposePrimary = bindDerivedSettingsPaint("primary", invalidate), disposeSecond = bindDerivedSettingsPaint("cell-2", invalidate);
    updateDerivedSettings(id, { renko: { mode: "fixed", size: 100 } }); expect(invalidate.mock.calls).toEqual([["primary"]]);
    useChartStore.getState().set({ logarithmic: true }); expect(invalidate).toHaveBeenCalledOnce();
    updateDerivedSettings("cell-2", { range: { mode: "fixed", size: 20 } }); expect(invalidate.mock.calls).toEqual([["primary"], ["cell-2"]]);
    disposePrimary(); disposeSecond(); updateDerivedSettings(id, { renko: { mode: "fixed", size: 200 } }); expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it("round-trips cells through named layouts and validated backups with legacy defaults", () => {
    const id = useWorkspaceStore.getState().activeId; updateDerivedSettings(id, { renko: { mode: "fixed", size: 100 } });
    useWorkspaceStore.getState().saveLayout("Derived"); const layout = useWorkspaceStore.getState().layouts[0];
    updateDerivedSettings(id, { renko: { mode: "fixed", size: 200 } }); useWorkspaceStore.getState().loadLayout(layout.id);
    expect(derivedSettingsForCell(id)!.renko).toEqual({ mode: "fixed", size: 100 });
    const backup = createWorkspaceBackup(); expect(parseWorkspace(JSON.stringify(backup)).chart.state.chartTypeSettings).toEqual(derivedSettingsForCell(id));
    expect((backup.premium!.state.cells as Array<Record<string, unknown>>)[0].chartTypeSettings).toEqual(derivedSettingsForCell(id));
    delete backup.chart.state.chartTypeSettings; for (const cell of backup.premium!.state.cells as Array<Record<string, unknown>>) delete cell.chartTypeSettings;
    expect(() => parseWorkspace(JSON.stringify(backup))).not.toThrow();
    useWorkspaceStore.setState({ cells: useWorkspaceStore.getState().cells.map(cell => ({ ...cell, chartTypeSettings: undefined })) });
    useWorkspaceStore.getState().activate("cell-2"); expect(derivedSettingsForCell("primary")).toEqual(defaults());
  });
  it("rejects malformed chart, cell and saved-layout parameters before they reach math", () => {
    useWorkspaceStore.getState().saveLayout("Schema");
    for (const target of ["chart", "cell", "layout"] as const) {
      const backup = createWorkspaceBackup(), invalid = { ...defaults(), renko: { mode: "atr", length: -1 } };
      if (target === "chart") backup.chart.state.chartTypeSettings = invalid;
      else if (target === "cell") (backup.premium!.state.cells as Array<Record<string, unknown>>)[0].chartTypeSettings = invalid;
      else ((backup.premium!.state.layouts as Array<{ cells: Array<Record<string, unknown>> }>)[0].cells)[0].chartTypeSettings = invalid;
      expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(/chart type settings/);
    }
  });
  it("fences application, missing and removed owners and rejects invalid runtime edits", () => {
    const id = useWorkspaceStore.getState().activeId;
    expect(updateDerivedSettings(id, { linebreak: { lines: 0 } })).toBe(false);
    expect(updateDerivedSettings("missing", { linebreak: { lines: 2 } })).toBe(false);
    useWorkspaceStore.setState({ applyingCell: true }); expect(derivedSettingsForCell("primary")).toBeUndefined();
    expect(updateDerivedSettings(id, { linebreak: { lines: 2 } })).toBe(false);
    useWorkspaceStore.setState({ applyingCell: false, cells: [] }); expect(updateDerivedSettings(id, { linebreak: { lines: 2 } })).toBe(false);
    expect(useChartStore.getState().chartTypeSettings).toEqual(defaults());
  });
});
