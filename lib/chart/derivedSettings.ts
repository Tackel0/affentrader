import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { subscribeChartSettings } from "./settingsSubscription";
import { DEFAULT_CHART_TYPE_SETTINGS, type ChartTypeSettings } from "./chartTypes";
import { invalidateCanvasLayers } from "./canvasLayer";
import type { BoxSizing } from "./transforms";

type Bag = Record<string, unknown>;
const bag = (value: unknown): value is Bag => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Bag, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const number = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const integer = (value: unknown, min: number, max: number) => number(value, min, max) && Number.isInteger(value);
export function validBoxSizing(value: unknown): value is BoxSizing {
  if (!bag(value)) return false;
  return value.mode === "atr" && exact(value, ["mode", "length"]) && integer(value.length, 1, 200) ||
    value.mode === "fixed" && exact(value, ["mode", "size"]) && number(value.size, 1e-9, 1e12) ||
    value.mode === "percent" && exact(value, ["mode", "percent"]) && number(value.percent, 0.001, 1e6);
}
export function validChartTypeSettings(value: unknown): value is ChartTypeSettings {
  if (!bag(value) || !exact(value, ["renko", "range", "kagi", "pointfigure", "linebreak", "baseline"])) return false;
  return validBoxSizing(value.renko) && validBoxSizing(value.range) && validBoxSizing(value.kagi) &&
    bag(value.pointfigure) && exact(value.pointfigure, ["sizing", "reversal"]) && validBoxSizing(value.pointfigure.sizing) && integer(value.pointfigure.reversal, 1, 10) &&
    bag(value.linebreak) && exact(value.linebreak, ["lines"]) && integer(value.linebreak.lines, 1, 10) &&
    bag(value.baseline) && exact(value.baseline, ["levelPercent"]) && number(value.baseline.levelPercent, 0, 100);
}
export function derivedSettingsForCell(cellId: string): ChartTypeSettings | undefined {
  const workspace = useWorkspaceStore.getState();
  if (workspace.applyingCell) return undefined;
  const id = cellId === "primary" ? workspace.activeId : cellId, cell = workspace.cells.find(value => value.id === id);
  if (!cell) return undefined;
  const value = workspace.activeId === id ? useChartStore.getState().chartTypeSettings : cell.chartTypeSettings;
  return validChartTypeSettings(value) ? value : DEFAULT_CHART_TYPE_SETTINGS;
}
export function updateDerivedSettings(cellId: string, patch: Partial<ChartTypeSettings>): boolean {
  const current = derivedSettingsForCell(cellId); if (!current) return false;
  const next = { ...current, ...patch }; if (!validChartTypeSettings(next)) return false;
  const workspace = useWorkspaceStore.getState(), id = cellId === "primary" ? workspace.activeId : cellId, copy = structuredClone(next);
  if (workspace.activeId === id) useChartStore.getState().set({ chartTypeSettings: copy });
  else useWorkspaceStore.setState(state => ({ cells: state.cells.map(cell => cell.id === id ? { ...cell, chartTypeSettings: copy } : cell) }));
  return true;
}
export function resetDerivedSetting(cellId: string, type: keyof ChartTypeSettings): boolean {
  return updateDerivedSettings(cellId, { [type]: structuredClone(DEFAULT_CHART_TYPE_SETTINGS[type]) });
}

/** Edits repaint only this cell's host layers, including when its market is idle or Replay is paused. */
export function bindDerivedSettingsPaint(cellId: string, invalidate = invalidateCanvasLayers): () => void {
  let previous = JSON.stringify(derivedSettingsForCell(cellId));
  const changed = () => {
    const value = derivedSettingsForCell(cellId); if (!value) return;
    const next = JSON.stringify(value); if (next === previous) return;
    previous = next; invalidate(cellId);
  };
  return subscribeChartSettings("chartTypeSettings", changed);
}
