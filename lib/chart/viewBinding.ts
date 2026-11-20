import type { Vela } from "@luxalgo/vela";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { subscribeChartSettings } from "./settingsSubscription";
import { chartViewKey, nativeChartView, readChartView, validChartView, type ChartViewPreferences } from "./viewPreferences";

export interface ChartViewHost {
  /** Undefined means missing/applying owner; null means use this renderer's initial defaults. */
  read(): ChartViewPreferences | null | undefined;
  write(value: ChartViewPreferences): void;
  subscribe(listener: () => void): () => void;
}

export function chartViewHost(cellId: string): ChartViewHost {
  const read = () => {
    const workspace = useWorkspaceStore.getState();
    if (workspace.applyingCell || !workspace.cells.some(cell => cell.id === cellId)) return undefined;
    return workspace.activeId === cellId ? useChartStore.getState().chartView : workspace.cells.find(cell => cell.id === cellId)?.chartView ?? null;
  };
  return { read,
    write: value => {
      const workspace = useWorkspaceStore.getState();
      if (workspace.applyingCell || !workspace.cells.some(cell => cell.id === cellId)) return;
      const copy = structuredClone(value);
      if (workspace.activeId === cellId) useChartStore.getState().set({ chartView: copy });
      else useWorkspaceStore.setState(state => ({ cells: state.cells.map(cell => cell.id === cellId ? { ...cell, chartView: copy } : cell) }));
    },
    subscribe: listener => {
      let previous = JSON.stringify(read());
      const changed = () => { const next = JSON.stringify(read()); if (next !== previous) { previous = next; listener(); } };
      return subscribeChartSettings("chartView", changed);
    },
  };
}

/** Apply imported/default preferences and capture native edits without feedback or indicator restarts. */
export function bindChartView(renderer: Pick<Vela["renderer"], "getConfig" | "applyConfig" | "onConfigChanged">, host: ChartViewHost): () => void {
  const initial = readChartView(renderer.getConfig());
  if (!initial) return () => {};
  let disposed = false, applying = false, signature = chartViewKey(initial);
  const applyHost = () => {
    if (disposed || applying) return;
    const saved = host.read();
    if (saved === undefined || saved !== null && !validChartView(saved)) return;
    const value = saved ?? initial, next = chartViewKey(value);
    if (next === signature) return;
    applying = true;
    try {
      renderer.applyConfig(nativeChartView(value));
      const applied = readChartView(renderer.getConfig());
      signature = chartViewKey(applied ?? value);
    } finally { applying = false; }
  };
  applyHost();
  const offNative = renderer.onConfigChanged(() => {
    if (disposed || applying) return;
    const value = readChartView(renderer.getConfig());
    if (!value || chartViewKey(value) === signature) return;
    signature = chartViewKey(value); host.write(value);
  });
  const offHost = host.subscribe(applyHost);
  return () => { disposed = true; offNative(); offHost(); };
}
