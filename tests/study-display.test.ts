import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indicatorExecutionSignature, showsIndicatorValues } from "@/lib/indicators/presentation";
import { indicatorLegendValues, type DataWindowView } from "@/lib/chart/dataWindow";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
import { parseWorkspace } from "@/lib/workspace";
import type { IndicatorInstance } from "@/types/trading";

const study = (id = "ema20"): IndicatorInstance => ({ id, definitionId: "ema", name: "EMA", inputs: { length: 20 }, source: "close", color: "#2962ff", lineWidth: 2, visible: true });
const initialChart = useChartStore.getState(), initialWorkspace = useWorkspaceStore.getState();
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useChartStore.setState({ ...initialChart, indicators: [study(), study("ema50")] }, true);
  useWorkspaceStore.setState({ ...initialWorkspace, cells: structuredClone(initialWorkspace.cells), layouts: [], studies: [] }, true);
});
afterEach(() => vi.restoreAllMocks());

describe("per-study status-line display", () => {
  it("honors global precedence, legacy defaults, visibility and error gates", () => {
    for (const global of [true, false]) for (const local of [true, false, undefined]) for (const visible of [true, false]) for (const error of [undefined, "Failed"]) {
      expect(showsIndicatorValues({ ...study(), valuesInStatusLine: local, visible, error }, global)).toBe(global && local !== false && visible && !error);
    }
  });

  it("keeps presentation-only changes outside the signature used to restart calculations", () => {
    const original = study(), signature = indicatorExecutionSignature(original);
    expect(indicatorExecutionSignature({ ...original, valuesInStatusLine: false })).toBe(signature);
    expect(indicatorExecutionSignature({ ...original, valuesInStatusLine: true })).toBe(signature);
    expect(indicatorExecutionSignature({ ...original, valuesOnPriceScale: false })).toBe(signature);
    expect(indicatorExecutionSignature({ ...original, valuesOnPriceScale: true })).toBe(signature);
    for (const patch of [{ inputs: { length: 50 } }, { source: "hlc3" as const }, { lineWidth: 3 }, { color: "#ff0000" }, { visible: false }, { script: "plot(close)" }])
      expect(indicatorExecutionSignature({ ...original, ...patch })).not.toBe(signature);
  });

  it("isolates duplicate instances without modifying native readout groups", () => {
    const row = { label: "EMA", value: "42.50", color: "#2962ff" };
    const readout: DataWindowView = { symbol: "BTCUSDT", timeframe: "5m", zone: "UTC", replay: false, recovering: false, error: null, status: "ready",
      indicatorIds: { ema20: "native20", ema50: "native50" }, readout: { date: "2026-10-27", time: "12:00", ohlc: null,
        groups: [{ id: "native20", name: "EMA", rows: [row], legendRows: [row] }, { id: "native50", name: "EMA", rows: [row], legendRows: [row] }] } };
    const before = structuredClone(readout);
    useChartStore.getState().updateIndicator("ema20", { valuesInStatusLine: false, valuesOnPriceScale: false });
    const visible = useChartStore.getState().indicators.filter(indicator => showsIndicatorValues(indicator, true)).map(indicator => indicator.id);
    expect(visible).toEqual(["ema50"]);
    expect(indicatorLegendValues(readout).ema20).toEqual([row]);
    expect(readout).toEqual(before);
  });

  it("retains display through templates, cell activation, saved layouts and validated export", () => {
    useChartStore.getState().updateIndicator("ema20", { valuesInStatusLine: false, valuesOnPriceScale: false });
    const workspace = useWorkspaceStore.getState(), firstId = workspace.activeId;
    workspace.saveStudies("Display"); workspace.saveLayout("Display layout"); workspace.activate("cell-2"); workspace.activate(firstId);
    expect(useChartStore.getState().indicators[0].valuesInStatusLine).toBe(false);
    expect(useChartStore.getState().indicators[0].valuesOnPriceScale).toBe(false);
    useChartStore.getState().updateIndicator("ema20", { valuesInStatusLine: true, valuesOnPriceScale: true });
    workspace.loadLayout(useWorkspaceStore.getState().layouts[0].id);
    expect(useChartStore.getState().indicators[0].valuesInStatusLine).toBe(false);
    expect(useChartStore.getState().indicators[0].valuesOnPriceScale).toBe(false);
    useChartStore.getState().updateIndicator("ema20", { valuesOnPriceScale: true });
    workspace.loadStudies(useWorkspaceStore.getState().studies[0].id);
    expect(useChartStore.getState().indicators[0]).toMatchObject({ valuesInStatusLine: false, valuesOnPriceScale: false, visible: true });
    const backup = createWorkspaceBackup();
    expect(parseWorkspace(JSON.stringify(backup)).chart.state.indicators).toEqual(backup.chart.state.indicators);
    const stored = useChartStore.persist.getOptions().partialize!(useChartStore.getState()) as { indicators: IndicatorInstance[] };
    expect(stored.indicators[0].valuesInStatusLine).toBe(false);
    expect(stored.indicators[0].valuesOnPriceScale).toBe(false);
  });

  it("rejects malformed study flags in charts, cells and templates while accepting omitted legacy flags", () => {
    for (const location of ["chart", "cell", "template"] as const) {
      const backup = createWorkspaceBackup();
      useWorkspaceStore.getState().saveStudies("Study");
      if (location === "template") backup.premium!.state.studies = structuredClone(useWorkspaceStore.getState().studies);
      const indicators = location === "chart" ? backup.chart.state.indicators : location === "cell"
        ? (backup.premium!.state.cells as Array<{ indicators: unknown }>)[0].indicators
        : (backup.premium!.state.studies as Array<{ indicators: unknown }>)[0].indicators;
      (indicators as Array<Record<string, unknown>>)[0].valuesInStatusLine = "false";
      expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(/indicator status line visibility/);
      delete (indicators as Array<Record<string, unknown>>)[0].valuesInStatusLine;
      (indicators as Array<Record<string, unknown>>)[0].valuesOnPriceScale = 0;
      expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(/indicator price-scale visibility/);
      delete (indicators as Array<Record<string, unknown>>)[0].valuesOnPriceScale;
      expect(() => parseWorkspace(JSON.stringify(backup))).not.toThrow();
    }
  });
});
