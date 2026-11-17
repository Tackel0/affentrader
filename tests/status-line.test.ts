import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STATUS_LINE, statusLinePreferences, studyArguments, validStatusLine } from "@/lib/chart/statusLine";
import { statusLineBinding, statusLineSettings } from "@/lib/chart/statusLineSettings";
import { installTradingSettings } from "@/lib/chart/tradingSettings";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
import { parseWorkspace } from "@/lib/workspace";
import type { Vela } from "@luxalgo/vela";

const initialChart = useChartStore.getState(), initialWorkspace = useWorkspaceStore.getState();
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useChartStore.setState({ ...initialChart, statusLine: { ...DEFAULT_STATUS_LINE } }, true);
  useWorkspaceStore.setState({ ...initialWorkspace, cells: structuredClone(initialWorkspace.cells), layouts: [] }, true);
});
afterEach(() => vi.restoreAllMocks());

describe("chart status line preferences", () => {
  it("validates the complete optional schema and rejects malformed display state", () => {
    expect(validStatusLine(DEFAULT_STATUS_LINE)).toBe(true);
    for (const candidate of [null, [], {}, { ...DEFAULT_STATUS_LINE, volume: "false" }, { ...DEFAULT_STATUS_LINE, extra: true }]) {
      expect(validStatusLine(candidate)).toBe(false);
      expect(statusLinePreferences(candidate)).toEqual(DEFAULT_STATUS_LINE);
    }
    const local = statusLinePreferences(); local.ohlc = false;
    expect(DEFAULT_STATUS_LINE.ohlc).toBe(true);
  });

  it("shows multi-input and Pine scalar arguments without losing zero or false", () => {
    expect(studyArguments({ fastLength: 12, slowLength: 26, signalLength: 9 })).toBe("12 26 9");
    expect(studyArguments({ offset: 0, enabled: false, source: "hlc3", color: "#fff", lineWidth: 2 })).toBe("0 false hlc3");
    expect(studyArguments({ invalid: NaN, period: 14 })).toBe("14");
  });

  it("contributes working status-line rows alongside the existing native Trading tab", () => {
    let installed: ReturnType<typeof statusLineSettings>[] = [];
    const chart = { renderer: { set: vi.fn(), setSettingsSections: (sections: typeof installed) => { installed = sections; } } } as unknown as Vela;
    installTradingSettings(chart);
    expect(installed.map(section => section.id)).toEqual(["status-line", "trading"]);
    const rows = installed[0].rows.filter(row => "get" in row);
    expect(rows).toHaveLength(6);
    for (const row of rows) { row.set!(false); expect(row.get!()).toBe(false); }
    expect(useChartStore.getState().statusLine).toEqual(Object.fromEntries(Object.keys(DEFAULT_STATUS_LINE).map(key => [key, false])));
    expect(useChartStore.getState().indicators).toEqual(initialChart.indicators);
  });

  it("targets the owning cell after activation changes without overwriting the new active chart", () => {
    const first = useWorkspaceStore.getState().activeId, binding = statusLineBinding(first);
    binding.write("indicatorValues", false); useWorkspaceStore.getState().activate("cell-2");
    expect(useChartStore.getState().statusLine).toEqual(DEFAULT_STATUS_LINE);
    binding.write("ohlc", false);
    expect(useChartStore.getState().statusLine.ohlc).toBe(true);
    useWorkspaceStore.getState().activate(first);
    expect(useChartStore.getState().statusLine).toMatchObject({ ohlc: false, indicatorValues: false });
  });

  it("rejects writes during cell application and after an owner disappears", () => {
    const binding = statusLineBinding(useWorkspaceStore.getState().activeId);
    useWorkspaceStore.setState({ applyingCell: true }); binding.write("ohlc", false);
    expect(useChartStore.getState().statusLine.ohlc).toBe(true);
    useWorkspaceStore.setState({ applyingCell: false, cells: [] }); binding.write("volume", false);
    expect(useChartStore.getState().statusLine.volume).toBe(true);
  });

  it("round trips per-cell and saved-layout preferences through validated backups, accepting legacy cells", () => {
    const workspace = useWorkspaceStore.getState(), id = workspace.activeId;
    statusLineBinding(id).write("indicatorArguments", false); workspace.saveLayout("Status line");
    statusLineBinding(id).write("indicatorArguments", true);
    useWorkspaceStore.getState().loadLayout(useWorkspaceStore.getState().layouts[0].id);
    expect(useChartStore.getState().statusLine.indicatorArguments).toBe(false);
    const backup = createWorkspaceBackup();
    expect(parseWorkspace(JSON.stringify(backup)).chart.state.statusLine).toMatchObject({ indicatorArguments: false });
    const cells = backup.premium!.state.cells as Array<Record<string, unknown>>;
    cells[0].statusLine = { ...DEFAULT_STATUS_LINE, ohlc: "yes" };
    expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(/status line preferences/);
    delete cells[0].statusLine; delete backup.chart.state.statusLine;
    expect(() => parseWorkspace(JSON.stringify(backup))).not.toThrow();
    useWorkspaceStore.setState({ cells: useWorkspaceStore.getState().cells.map(cell => ({ ...cell, statusLine: undefined })) });
    useWorkspaceStore.getState().activate("cell-2");
    expect(useChartStore.getState().statusLine).toEqual(DEFAULT_STATUS_LINE);
  });
});
