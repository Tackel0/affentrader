import type { Vela } from "@luxalgo/vela";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { nativePriceScale, nativeScaleNeedsNormalization, priceScaleSelection, samePriceScale, type PriceScaleSelection } from "./scaleMode";
export interface PriceScaleHost {
  read(): PriceScaleSelection;
  write(value: PriceScaleSelection): void;
  subscribe(listener: (value: PriceScaleSelection) => void): () => void;
}
export function priceScaleHost(cellId: string): PriceScaleHost {
  const read = () => {
    const workspace = useWorkspaceStore.getState(), cell = workspace.cells.find(cell => cell.id === cellId);
    const value = workspace.activeId === cellId && cell ? useChartStore.getState() : cell;
    return priceScaleSelection(value?.scaleMode, value?.logarithmic);
  };
  return { read, write: value => {
    const workspace = useWorkspaceStore.getState();
    if (workspace.applyingCell || !workspace.cells.some(cell => cell.id === cellId)) return;
    const selected = priceScaleSelection(value.mode, value.logarithmic);
    if (workspace.activeId === cellId) useChartStore.getState().set({ scaleMode: selected.mode, logarithmic: selected.logarithmic });
    else useWorkspaceStore.setState(state => ({ cells: state.cells.map(cell => cell.id === cellId ? { ...cell, scaleMode: selected.mode, logarithmic: selected.logarithmic } : cell) }));
  }, subscribe: listener => {
    let previous = read();
    const changed = () => {
      if (useWorkspaceStore.getState().applyingCell) return;
      const next = read(); if (!samePriceScale(previous, next)) { previous = next; listener(next); }
    };
    const offChart = useChartStore.subscribe(changed), offWorkspace = useWorkspaceStore.subscribe(changed);
    return () => { offChart(); offWorkspace(); };
  } };
}
/** UI-originated scale changes are sampled after the event, before the next market task. */
export function bindPriceScale(chart: Pick<Vela, "renderer">, element: Pick<HTMLElement, "addEventListener" | "removeEventListener">, host: PriceScaleHost): () => void {
  let disposed = false, applying = false, current = host.read();
  const apply = (value: PriceScaleSelection) => {
    applying = true;
    try {
      current = priceScaleSelection(value.mode, value.logarithmic);
      if (nativePriceScale(chart.renderer.getConfig?.())) chart.renderer.applyConfig({ priceScale: { mode: current.mode, log: current.logarithmic } });
      else chart.renderer.set("logScale", current.logarithmic);
    } finally { applying = false; }
  };
  apply(current);
  const readRenderer = () => {
    if (disposed || applying) return;
    const config = chart.renderer.getConfig?.();
    const value = nativePriceScale(config) ?? priceScaleSelection("price", Boolean(chart.renderer.get("logScale")));
    const changed = !samePriceScale(value, current);
    if (nativeScaleNeedsNormalization(config)) apply(value);
    if (changed) { current = value; host.write(value); }
  };
  const afterInteraction = () => queueMicrotask(readRenderer);
  const off = host.subscribe(value => {
    if (disposed || samePriceScale(value, current)) return;
    apply(value);
  });
  const offConfig = chart.renderer.onConfigChanged?.(readRenderer);
  for (const event of ["click", "change", "keydown"]) element.addEventListener(event, afterInteraction);
  const timer = setInterval(readRenderer, 250);
  return () => { disposed = true; clearInterval(timer); off(); offConfig?.(); for (const event of ["click", "change", "keydown"]) element.removeEventListener(event, afterInteraction); };
}
