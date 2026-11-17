import type { Vela } from "@luxalgo/vela";
import type { ChartType } from "@/types/trading";
import { CHART_TYPE_IDS } from "./chartTypes";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

export interface ChartTypeHost {
  read(): ChartType | undefined;
  write(style: ChartType): void;
  subscribe(listener: () => void): () => void;
}

/** A dialog keeps its original cell owner even if the workspace changes around it. */
export function chartTypeHost(cellId: string): ChartTypeHost {
  const read = () => {
    const workspace = useWorkspaceStore.getState();
    if (!workspace.cells.some(cell => cell.id === cellId)) return undefined;
    return workspace.activeId === cellId ? useChartStore.getState().chartType
      : workspace.cells.find(cell => cell.id === cellId)?.chartType;
  };
  return {
    read,
    write: chartType => {
      const workspace = useWorkspaceStore.getState();
      if (workspace.applyingCell || !workspace.cells.some(cell => cell.id === cellId)) return;
      if (workspace.activeId === cellId) useChartStore.getState().set({ chartType });
      else useWorkspaceStore.setState(state => ({ cells: state.cells.map(cell => cell.id === cellId ? { ...cell, chartType } : cell) }));
    },
    subscribe: listener => {
      let previous = read();
      const changed = () => { const next = read(); if (next !== previous) { previous = next; listener(); } };
      const offChart = useChartStore.subscribe(changed), offWorkspace = useWorkspaceStore.subscribe(changed);
      return () => { offChart(); offWorkspace(); };
    },
  };
}

/** Vela announces BEFORE repainting. Publish only the settled final style, outside that callback. */
export function bindNativeChartType(chart: Pick<Vela, "on" | "renderer">, host: ChartTypeHost): () => void {
  if (!chart.renderer.supports("priceStyle")) return () => {};
  let disposed = false, serial = 0, hostVersion = 0;
  const offHost = host.subscribe(() => { hostVersion++; });
  const offChart = chart.on("priceStyle:change", event => {
    const request = ++serial, version = hostVersion;
    queueMicrotask(() => {
      if (disposed || request !== serial || version !== hostVersion) return;
      const settled = chart.renderer.get("priceStyle");
      if (settled !== event.to || typeof settled !== "string" || !CHART_TYPE_IDS.includes(settled)) return;
      if (host.read() !== settled) host.write(settled as ChartType);
    });
  });
  return () => { disposed = true; offChart(); offHost(); };
}
