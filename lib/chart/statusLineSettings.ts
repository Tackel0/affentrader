import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { statusLinePreferences, type StatusLinePreferences } from "./statusLine";

/** Resolve at action time so a settings dialog cannot write another chart's display. */
export function statusLineBinding(cellId: string) {
  return {
    read: () => {
      const workspace = useWorkspaceStore.getState();
      return statusLinePreferences(workspace.activeId === cellId
        ? useChartStore.getState().statusLine
        : workspace.cells.find(cell => cell.id === cellId)?.statusLine);
    },
    write: (key: keyof StatusLinePreferences, value: boolean) => {
      const workspace = useWorkspaceStore.getState();
      if (workspace.applyingCell || !workspace.cells.some(cell => cell.id === cellId)) return;
      if (workspace.activeId === cellId) {
        const chart = useChartStore.getState();
        chart.set({ statusLine: { ...statusLinePreferences(chart.statusLine), [key]: value } });
      } else {
        useWorkspaceStore.setState(state => ({ cells: state.cells.map(cell => cell.id === cellId
          ? { ...cell, statusLine: { ...statusLinePreferences(cell.statusLine), [key]: value } } : cell) }));
      }
    },
  };
}

export function statusLineSettings(cellId: string) {
  const binding = statusLineBinding(cellId);
  const toggle = (id: keyof StatusLinePreferences, label: string) => ({
    kind: "toggle", id, label,
    get: () => binding.read()[id],
    set: (value: boolean) => binding.write(id, value),
  });
  return { id: "status-line", title: "Status line", rows: [
    { kind: "heading", id: "price", label: "Price series" },
    toggle("ohlc", "OHLC values"),
    toggle("barChange", "Bar change values"),
    toggle("volume", "Volume in status line"),
    { kind: "heading", id: "indicators", label: "Indicators" },
    toggle("indicatorTitles", "Indicator titles"),
    toggle("indicatorArguments", "Indicator arguments"),
    toggle("indicatorValues", "Indicator values"),
  ] };
}
