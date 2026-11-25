"use client";
import { DEFAULT_CHART_TYPE_SETTINGS } from "@/lib/chart/chartTypes";
import { statusLinePreferences } from "@/lib/chart/statusLine";
import { clampSidebarWidth } from "@/lib/chart/sidebarResize";
import { setLinkedCrosshair } from "@/lib/chart/crosshairBus";
import { defaultDomPreferences,readDomPreferences,setDomGrouping,validDomPreferences,type DomPreferences } from "@/lib/orderflow/domPreferences";
import {
  defaultSearchPreferences,
  moveExchangePriority,
  readSearchPreferences,
  validSearchPreferences,
  type SearchExchangeId,
  type SearchPreferences,
} from "@/lib/market/symbolSearch";
import { create } from "zustand";
import { scopedName } from "@/lib/windowScope";
import { persist } from "zustand/middleware";
import { createShallowPersistStorage, hotStorage } from "@/lib/debouncedStorage";
import { useChartStore } from "./useChartStore";
import type {
  ChartSync,
  LayoutId,
  LayoutTemplate,
  ReplayCommand,
  ReplayInfo,
  StudyTemplate,
  WorkspaceCell,
  WorkspaceTheme,
} from "@/types/workspace";
import type { IndicatorInstance } from "@/types/trading";
export const LAYOUTS: {
  id: LayoutId;
  name: string;
  columns: number;
  rows: number;
  count: number;
}[] = [
  { id: "single", name: "One chart", columns: 1, rows: 1, count: 1 },
  { id: "two-columns", name: "Two columns", columns: 2, rows: 1, count: 2 },
  { id: "two-rows", name: "Two rows", columns: 1, rows: 2, count: 2 },
  { id: "three-columns", name: "Three columns", columns: 3, rows: 1, count: 3 },
  { id: "four", name: "Four charts", columns: 2, rows: 2, count: 4 },
  { id: "six", name: "Six charts", columns: 3, rows: 2, count: 6 },
  { id: "eight", name: "Eight charts", columns: 4, rows: 2, count: 8 },
];
export const INITIAL_REPLAY: ReplayInfo = {
  active: false,
  playing: false,
  cursorTime: null,
  remaining: 0,
  intervalMs: 1000,
  first: null,
  last: null,
};
function currentCell(id: string): WorkspaceCell {
  const s = useChartStore.getState();
  return {
    id,
    symbol: s.symbol,
    timeframe: s.timeframe,
    chartType: s.chartType,
    chartTypeSettings: structuredClone(s.chartTypeSettings),
    logarithmic: s.logarithmic,
    scaleMode: s.scaleMode,
    legendCollapsed: s.legendCollapsed,
    chartView: s.chartView ? structuredClone(s.chartView) : null,
    chartAppearance: s.chartAppearance ? structuredClone(s.chartAppearance) : null,
    seriesPreferences: s.seriesPreferences ? structuredClone(s.seriesPreferences) : null,
    statusLine: statusLinePreferences(s.statusLine),
    indicators: structuredClone(s.indicators),
  };
}
function seedCells(): WorkspaceCell[] {
  return [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "XRPUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "DOGEUSDT",
  ].map((symbol, index) => ({
    id: `cell-${index + 1}`,
    symbol,
    timeframe: "15m",
    chartType: "candles",
    indicators: [
      {
        id: `cell-${index + 1}-volume`,
        definitionId: "volume",
        name: "Volume",
        visible: true,
        inputs: {},
        color: "#089981",
        lineWidth: 1,
        source: "close",
      },
    ],
  }));
}
function applyCell(cell: WorkspaceCell) {
  useChartStore
    .getState()
    .set({
      symbol: cell.symbol,
      timeframe: cell.timeframe,
      chartType: cell.chartType,
      chartTypeSettings: structuredClone(cell.chartTypeSettings ?? DEFAULT_CHART_TYPE_SETTINGS),
      logarithmic: cell.logarithmic ?? false,
      scaleMode: cell.scaleMode ?? "price",
      legendCollapsed: cell.legendCollapsed ?? false,
      chartView: cell.chartView ?? null,
      chartAppearance: cell.chartAppearance ?? null,
      seriesPreferences: cell.seriesPreferences ?? null,
      statusLine: statusLinePreferences(cell.statusLine),
      indicators: structuredClone(cell.indicators),
      chartError: null,
      settingsId: null,
    });
  setLinkedCrosshair(null, false);
}
interface WorkspaceState {
  domPreferences:DomPreferences;
  setDomPreferences:(patch:Partial<Omit<DomPreferences,"groups">>)=>void;
  setDomGroup:(symbol:string,group:number)=>void;
  searchPreferences: SearchPreferences;
  setSearchPreferences: (patch: Partial<SearchPreferences>) => void;
  toggleSearchExchange: (id: SearchExchangeId) => void;
  moveSearchExchange: (id: SearchExchangeId, direction: "up" | "down" | "top") => void;
  resetSearchPreferences: () => void;
  applyingCell: boolean;
  theme: WorkspaceTheme;
  layout: LayoutId;
  activeId: string;
  cells: WorkspaceCell[];
  sync: ChartSync;
  maximizedId: string | null;
  sidebarWidth: number;
  layouts: LayoutTemplate[];
  studies: StudyTemplate[];
  replay: ReplayInfo;
  replayCommand: ReplayCommand | null;
  setTheme: (theme: WorkspaceTheme) => void;
  setLayout: (layout: LayoutId) => void;
  activate: (id: string) => void;
  capture: () => void;
  setSync: (kind: keyof ChartSync, value: boolean) => void;
  maximize: (id: string) => void;
  setSidebarWidth: (width: number) => void;
  saveLayout: (name: string) => void;
  loadLayout: (id: string) => void;
  deleteLayout: (id: string) => void;
  saveStudies: (name: string) => void;
  loadStudies: (id: string) => void;
  deleteStudies: (id: string) => void;
  setReplay: (patch: Partial<ReplayInfo>) => void;
  commandReplay: (
    action: ReplayCommand["action"],
    options?: Pick<ReplayCommand, "from" | "intervalMs">,
  ) => void;
}
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      domPreferences:defaultDomPreferences(),
      setDomPreferences:(patch)=>set(s=>{const domPreferences={...s.domPreferences,...patch};if(!validDomPreferences(domPreferences))throw new Error("Invalid DOM settings.");return {domPreferences:structuredClone(domPreferences)};}),
      setDomGroup:(symbol,group)=>set(s=>({domPreferences:setDomGrouping(s.domPreferences,symbol,group)})),
      searchPreferences: defaultSearchPreferences(),
      setSearchPreferences: (patch) =>
        set((s) => {
          const next = readSearchPreferences({ ...s.searchPreferences, ...patch });
          if (!validSearchPreferences(next)) throw new Error("Invalid search preferences.");
          return { searchPreferences: next };
        }),
      toggleSearchExchange: (id) =>
        set((s) => {
          const has = s.searchPreferences.enabledExchanges.includes(id);
          const enabledExchanges = has
            ? s.searchPreferences.enabledExchanges.filter((item) => item !== id)
            : [...s.searchPreferences.enabledExchanges, id];
          return {
            searchPreferences: readSearchPreferences({
              ...s.searchPreferences,
              enabledExchanges,
            }),
          };
        }),
      moveSearchExchange: (id, direction) =>
        set((s) => ({
          searchPreferences: readSearchPreferences({
            ...s.searchPreferences,
            exchangePriority: moveExchangePriority(s.searchPreferences.exchangePriority, id, direction),
          }),
        })),
      resetSearchPreferences: () => set({ searchPreferences: defaultSearchPreferences() }),
      theme: "light",
      layout: "single",
      activeId: "cell-1",
      cells: seedCells(),
      sync: {
        symbol: false,
        interval: false,
        crosshair: true,
        timeRange: false,
      },
      maximizedId: null,
      sidebarWidth: 300,
      layouts: [],
      studies: [],
      replay: INITIAL_REPLAY,
      replayCommand: null,
      applyingCell: false,
      setTheme: (theme) => set({ theme }),
      setLayout: (layout) => {
        get().capture();
        const count = LAYOUTS.find((l) => l.id === layout)!.count;
        const activeId = get()
          .cells.slice(0, count)
          .some((c) => c.id === get().activeId)
          ? get().activeId
          : get().cells[0].id;
        if (activeId !== get().activeId) get().activate(activeId);
        set({ layout, maximizedId: null });
      },
      activate: (id) => {
        if (id === get().activeId) return;
        get().capture();
        const cell = get().cells.find((c) => c.id === id);
        if (!cell) return;
        set({
          activeId: id,
          applyingCell: true,
          replayCommand: null,
        });
        try { applyCell(cell); } finally { set({ applyingCell: false }); }
      },
      capture: () => {
        const s = get();
        if (s.applyingCell) return;
        const active = currentCell(s.activeId);
        const cells = s.cells.map((c) =>
          c.id === s.activeId
            ? active
            : {
                ...c,
                ...(s.sync.symbol ? { symbol: active.symbol } : {}),
                ...(s.sync.interval ? { timeframe: active.timeframe } : {}),
              },
        );
        if (JSON.stringify(cells) !== JSON.stringify(s.cells)) set({ cells });
      },
      setSync: (kind, value) => {
        set((s) => ({ sync: { ...s.sync, [kind]: value } }));
        get().capture();
      },
      maximize: (id) => {
        if (get().activeId !== id) get().activate(id);
        set((s) => ({ maximizedId: s.maximizedId === id ? null : id }));
      },
      setSidebarWidth: (width) => {
        if (!Number.isFinite(width)) return;
        const sidebarWidth = clampSidebarWidth(width);
        if (sidebarWidth !== get().sidebarWidth) set({ sidebarWidth });
      },
      saveLayout: (name) => {
        get().capture();
        const s = get();
        set({
          layouts: [
            ...s.layouts,
            {
              id: crypto.randomUUID(),
              name: name.trim().slice(0, 60) || "Unnamed layout",
              layout: s.layout,
              cells: structuredClone(s.cells),
              activeId: s.activeId,
              sync: { ...s.sync },
              savedAt: Date.now(),
            },
          ].slice(-50),
        });
      },
      loadLayout: (id) => {
        const saved = get().layouts.find((l) => l.id === id);
        if (!saved) return;
        get().commandReplay("stop");
        const cell =
          saved.cells.find((c) => c.id === saved.activeId) ?? saved.cells[0];
        set({
          layout: saved.layout,
          applyingCell: true,
          cells: structuredClone(saved.cells),
          activeId: cell.id,
          sync: { ...saved.sync },
          maximizedId: null,
          replay: { ...INITIAL_REPLAY },
        });
        try { applyCell(cell); } finally { set({ applyingCell: false }); }
      },
      deleteLayout: (id) =>
        set((s) => ({ layouts: s.layouts.filter((l) => l.id !== id) })),
      saveStudies: (name) =>
        set((s) => ({
          studies: [
            ...s.studies,
            {
              id: crypto.randomUUID(),
              name: name.trim().slice(0, 60) || "Indicator template",
              indicators: structuredClone(useChartStore.getState().indicators),
              savedAt: Date.now(),
            },
          ].slice(-100),
        })),
      loadStudies: (id) => {
        const saved = get().studies.find((t) => t.id === id);
        if (saved)
          useChartStore
            .getState()
            .set({
              indicators: saved.indicators.map((i) => ({
                ...structuredClone(i),
                id: crypto.randomUUID(),
                error: undefined,
              })),
            });
      },
      deleteStudies: (id) =>
        set((s) => ({ studies: s.studies.filter((t) => t.id !== id) })),
      setReplay: (patch) => set((s) => ({ replay: { ...s.replay, ...patch } })),
      commandReplay: (action, options) =>
        set({
          replayCommand: { id: Date.now() + Math.random(), action, ...options },
        }),
    }),
    {
      name: scopedName("affentrader-premium-v1"),
      storage: createShallowPersistStorage(hotStorage),
      merge:(persisted,current)=>{
        const saved=persisted&&typeof persisted==="object"?persisted as Partial<WorkspaceState>:{};
        return {
          ...current,
          ...saved,
          domPreferences: readDomPreferences(saved.domPreferences),
          searchPreferences: readSearchPreferences(saved.searchPreferences),
        };
      },
      partialize: (s) => ({
        theme: s.theme,
        layout: s.layout,
        activeId: s.activeId,
        cells: s.cells,
        sync: s.sync,
        sidebarWidth: s.sidebarWidth,
        layouts: s.layouts,
        studies: s.studies,
        domPreferences:s.domPreferences,
        searchPreferences: s.searchPreferences,
      }),
    },
  ),
);
export function cloneIndicators(indicators: IndicatorInstance[]) {
  return indicators.map((i) => ({
    ...structuredClone(i),
    id: crypto.randomUUID(),
    error: undefined,
  }));
}
