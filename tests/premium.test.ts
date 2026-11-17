import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  LAYOUTS,
  INITIAL_REPLAY,
  useWorkspaceStore,
} from "@/stores/useWorkspaceStore";
import { useChartStore } from "@/stores/useChartStore";
import { parseWorkspace } from "@/lib/workspace";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
const initial = useWorkspaceStore.getState();
const chartInitial = useChartStore.getState();
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useChartStore.setState(
    { ...chartInitial, indicators: structuredClone(chartInitial.indicators) },
    true,
  );
  useWorkspaceStore.setState(
    {
      ...initial,
      cells: structuredClone(initial.cells),
      layouts: [],
      studies: [],
      sync: { ...initial.sync },
      replay: { ...INITIAL_REPLAY },
    },
    true,
  );
});
afterEach(() => vi.restoreAllMocks());
describe("multi-chart workspace state", () => {
  it("rejects intermediate cross-store capture while a cell or layout is being applied", () => {
    useChartStore.getState().set({ legendCollapsed: true }); useWorkspaceStore.getState().capture();
    const sourceId = useWorkspaceStore.getState().activeId, original = structuredClone(useWorkspaceStore.getState().cells.find(cell => cell.id === sourceId)!);
    const offWorkspace = useWorkspaceStore.subscribe((state, previous) => { if (state.activeId !== previous.activeId || state.cells !== previous.cells) state.capture(); });
    const offChart = useChartStore.subscribe(() => useWorkspaceStore.getState().capture());
    try {
      useWorkspaceStore.getState().activate("cell-2"); useWorkspaceStore.getState().activate(sourceId);
      expect(useChartStore.getState().legendCollapsed).toBe(true);
      expect(useWorkspaceStore.getState().cells.find(cell => cell.id === sourceId)).toEqual(original);
      expect(useWorkspaceStore.getState().applyingCell).toBe(false);
    } finally { offWorkspace(); offChart(); }
  });
  it("exports the legend display preference and validates it without rejecting legacy backups", () => {
    useChartStore.getState().set({ legendCollapsed: true });
    const backup = createWorkspaceBackup();
    expect(parseWorkspace(JSON.stringify(backup)).chart.state.legendCollapsed).toBe(true);
    delete backup.chart.state.legendCollapsed;
    expect(() => parseWorkspace(JSON.stringify(backup))).not.toThrow();
    backup.chart.state.legendCollapsed = "collapsed";
    expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(/legend preference/);
  });
  it("retains independent legend visibility across chart activation, layouts and validated backups", () => {
    const store = useWorkspaceStore.getState();
    useChartStore.getState().set({ legendCollapsed: true }); store.capture();
    const firstId = store.activeId;
    store.activate("cell-2"); expect(useChartStore.getState().legendCollapsed).toBe(false);
    useWorkspaceStore.getState().activate(firstId); expect(useChartStore.getState().legendCollapsed).toBe(true);
    useWorkspaceStore.getState().saveLayout("Legend layout"); const saved = useWorkspaceStore.getState().layouts[0];
    useChartStore.getState().set({ legendCollapsed: false }); useWorkspaceStore.getState().loadLayout(saved.id);
    expect(useChartStore.getState().legendCollapsed).toBe(true);
    const backup = createWorkspaceBackup(); expect(parseWorkspace(JSON.stringify(backup)).premium!.state.cells).toEqual(backup.premium!.state.cells);
    (backup.premium!.state.cells as Array<Record<string, unknown>>)[0].legendCollapsed = "hidden";
    expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(/legend preference/);
  });
  it("exports valid default state without relying on pre-existing LocalStorage keys", () => {
    const exported = createWorkspaceBackup();
    expect(
      parseWorkspace(JSON.stringify(exported)).premium?.state.cells,
    ).toHaveLength(8);
    expect(exported.watchlists.state.lists).toBeDefined();
    expect(exported.alerts.state.alerts).toEqual([]);
    expect(JSON.stringify(exported)).not.toContain("tradesBySymbol");
  });
  it("activates a pane before maximizing it and returns to the grid", () => {
    useWorkspaceStore.getState().setLayout("four");
    useWorkspaceStore.getState().maximize("cell-3");
    expect(useWorkspaceStore.getState().activeId).toBe("cell-3");
    expect(useChartStore.getState().symbol).toBe("SOLUSDT");
    expect(useWorkspaceStore.getState().maximizedId).toBe("cell-3");
    useWorkspaceStore.getState().maximize("cell-3");
    expect(useWorkspaceStore.getState().maximizedId).toBeNull();
  });
  it.each(LAYOUTS)("opens $name with a valid active chart", (layout) => {
    useWorkspaceStore.getState().setLayout(layout.id);
    const state = useWorkspaceStore.getState();
    expect(state.layout).toBe(layout.id);
    expect(
      state.cells.slice(0, layout.count).some((c) => c.id === state.activeId),
    ).toBe(true);
    expect(new Set(state.cells.map((c) => c.id)).size).toBe(8);
  });
  it("retains symbols, timeframes and studies independently when activating panes", () => {
    const ws = useWorkspaceStore.getState();
    ws.setLayout("four");
    useChartStore.getState().set({ timeframe: "4h", chartType: "heikinashi" });
    ws.activate("cell-2");
    expect(useChartStore.getState().symbol).toBe("ETHUSDT");
    expect(useWorkspaceStore.getState().cells[0].timeframe).toBe("4h");
    useChartStore.getState().set({ timeframe: "1m" });
    useWorkspaceStore.getState().activate("cell-1");
    expect(useChartStore.getState().timeframe).toBe("4h");
    expect(useChartStore.getState().chartType).toBe("heikinashi");
    expect(useWorkspaceStore.getState().cells[1].timeframe).toBe("1m");
  });
  it("links symbol and interval only when selected", () => {
    const ws = useWorkspaceStore.getState();
    ws.setSync("symbol", true);
    ws.setSync("interval", true);
    useChartStore.getState().set({ symbol: "SOLUSDT", timeframe: "5m" });
    ws.capture();
    expect(
      useWorkspaceStore
        .getState()
        .cells.every((c) => c.symbol === "SOLUSDT" && c.timeframe === "5m"),
    ).toBe(true);
  });
  it("saves deep layout snapshots and restores the active pane", () => {
    const ws = useWorkspaceStore.getState();
    ws.setLayout("four");
    ws.activate("cell-3");
    ws.saveLayout("Analysis");
    const saved = useWorkspaceStore.getState().layouts[0];
    useChartStore.getState().set({ symbol: "ADAUSDT" });
    useWorkspaceStore.getState().setLayout("single");
    useWorkspaceStore.getState().loadLayout(saved.id);
    expect(useWorkspaceStore.getState().layout).toBe("four");
    expect(useWorkspaceStore.getState().activeId).toBe("cell-3");
    expect(useChartStore.getState().symbol).toBe("SOLUSDT");
    expect(saved.cells[2].symbol).toBe("SOLUSDT");
  });
  it("returns the active pane to a visible slot when reducing the grid", () => {
    const ws = useWorkspaceStore.getState();
    ws.setLayout("eight");
    ws.activate("cell-8");
    ws.setLayout("two-columns");
    expect(useWorkspaceStore.getState().activeId).toBe("cell-1");
    expect(useChartStore.getState().symbol).toBe("BTCUSDT");
  });
  it("copies study templates with fresh instance ids", () => {
    const ws = useWorkspaceStore.getState();
    ws.saveStudies("EMA and volume");
    const saved = useWorkspaceStore.getState().studies[0];
    useChartStore.getState().set({ indicators: [] });
    ws.loadStudies(saved.id);
    const restored = useChartStore.getState().indicators;
    expect(restored).toHaveLength(2);
    expect(restored[0].id).not.toBe(saved.indicators[0].id);
    restored[0].inputs.length = 90;
    expect(saved.indicators[0].inputs.length).toBe(20);
  });
  it("round trips and validates the extended workspace backup", () => {
    const s = useWorkspaceStore.getState();
    s.capture();
    const premium = {
      state: {
        theme: s.theme,
        layout: s.layout,
        activeId: s.activeId,
        cells: s.cells,
        sync: s.sync,
        sidebarWidth: s.sidebarWidth,
        layouts: s.layouts,
        studies: s.studies,
      },
    };
    const backup = {
      version: 1,
      chart: {
        state: {
          symbol: "BTCUSDT",
          timeframe: "15m",
          chartType: "candles",
          feedMode: "auto",
          indicators: [],
          drawings: {},
          pineLibraries: {},
        },
      },
      watchlists: {
        state: {
          lists: [{ id: "a", name: "Crypto", symbols: ["BTCUSDT"] }],
          activeId: "a",
        },
      },
      alerts: { state: { alerts: [], logs: [] } },
      premium,
    };
    expect(parseWorkspace(JSON.stringify(backup)).premium).toEqual(premium);
    premium.state.activeId = "missing";
    expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(
      "Active chart",
    );
  });
});
