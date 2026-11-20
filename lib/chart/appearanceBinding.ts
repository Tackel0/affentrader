import type { Vela } from "@luxalgo/vela";
import { resolveTheme } from "@luxalgo/vela";
import type { WorkspaceTheme } from "@/types/workspace";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { subscribeChartSettings } from "./settingsSubscription";
import { chartTheme } from "./theme";
import { appearanceDefaults, appearanceKey, nativeChartAppearance, readChartAppearance, validAppearancePreferences, type ChartAppearance, type ChartAppearancePreferences } from "./appearance";

export interface ChartAppearanceHost {
  read(): { theme: WorkspaceTheme; preferences: ChartAppearancePreferences | null } | undefined;
  write(theme: WorkspaceTheme, value: ChartAppearance): void;
  selectTheme(theme: WorkspaceTheme): void;
  subscribe(listener: () => void): () => void;
}
export function chartAppearanceHost(cellId: string): ChartAppearanceHost {
  const read = () => {
    const workspace = useWorkspaceStore.getState(), cell = workspace.cells.find(value => value.id === cellId);
    if (workspace.applyingCell || !cell) return undefined;
    return { theme: workspace.theme, preferences: workspace.activeId === cellId ? useChartStore.getState().chartAppearance : cell.chartAppearance ?? null };
  };
  return { read, selectTheme: theme => useWorkspaceStore.getState().setTheme(theme),
    write: (theme, value) => {
      const current = read(); if (!current || current.theme !== theme) return;
      const preferences = { ...current.preferences, [theme]: structuredClone(value) };
      if (useWorkspaceStore.getState().activeId === cellId) useChartStore.getState().set({ chartAppearance: preferences });
      else useWorkspaceStore.setState(state => ({ cells: state.cells.map(cell => cell.id === cellId ? { ...cell, chartAppearance: preferences } : cell) }));
    },
    subscribe: listener => {
      let previous = JSON.stringify(read());
      const changed = () => { const next = JSON.stringify(read()); if (next !== previous) { previous = next; listener(); } };
      return subscribeChartSettings("chartAppearance", changed);
    } };
}

/** Own theme application as well as canvas preferences so theme events cannot overwrite saved choices. */
export function bindChartAppearance(chart: Pick<Vela, "renderer" | "setTheme" | "on">, host: ChartAppearanceHost): () => void {
  const first = host.read(), initial = readChartAppearance(chart.renderer.getConfig());
  if (!first || !initial) return () => {};
  const initialTheme = first.theme;
  let theme = first.theme, signature = appearanceKey(initial), disposed = false, applying = false;
  const apply = (force = false) => {
    if (disposed || applying) return;
    const next = host.read(); if (!next || next.preferences !== null && !validAppearancePreferences(next.preferences)) return;
    const value = next.preferences?.[next.theme] ?? appearanceDefaults(initial, initialTheme, next.theme);
    const key = appearanceKey(value), themeChanged = theme !== next.theme;
    if (!force && !themeChanged && signature === key) return;
    applying = true;
    try {
      if (themeChanged || force) chart.setTheme(chartTheme(next.theme));
      theme = next.theme;
      chart.renderer.applyConfig(nativeChartAppearance(value));
      signature = appearanceKey(readChartAppearance(chart.renderer.getConfig()) ?? value);
    } finally { applying = false; }
  };
  apply();
  const offNative = chart.renderer.onConfigChanged(() => {
    if (disposed || applying) return;
    const owner = host.read(); if (!owner || owner.theme !== theme) return;
    const value = readChartAppearance(chart.renderer.getConfig());
    if (!value || appearanceKey(value) === signature) return;
    signature = appearanceKey(value); host.write(theme, value);
  });
  const offHost = host.subscribe(apply);
  const offTheme = chart.on("theme:changed", palette => {
    if (disposed || applying) return;
    const next = palette.background === resolveTheme("light").background ? "light" : palette.background === resolveTheme("dark").background ? "dark" : null;
    if (next) { host.selectTheme(next); apply(true); }
  });
  return () => { disposed = true; offNative(); offHost(); offTheme(); };
}
