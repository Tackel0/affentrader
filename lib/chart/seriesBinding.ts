import type { Vela } from "@luxalgo/vela";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { subscribeChartSettings } from "./settingsSubscription";
import { nativeSeriesPreferences, readSeriesPreferences, seriesPreferencesKey, validSeriesPreferences, type SeriesPreferences } from "./seriesPreferences";

export interface SeriesPreferencesHost {
  read(): SeriesPreferences | null | undefined;
  write(value: SeriesPreferences): void;
  subscribe(listener: () => void): () => void;
}
export function seriesPreferencesHost(cellId: string): SeriesPreferencesHost {
  const read = () => {
    const workspace = useWorkspaceStore.getState(), cell = workspace.cells.find(value => value.id === cellId);
    if (workspace.applyingCell || !cell) return undefined;
    return workspace.activeId === cellId ? useChartStore.getState().seriesPreferences : cell.seriesPreferences ?? null;
  };
  return { read,
    write: value => {
      if (read() === undefined) return;
      const copy = structuredClone(value);
      if (useWorkspaceStore.getState().activeId === cellId) useChartStore.getState().set({ seriesPreferences: copy });
      else useWorkspaceStore.setState(state => ({ cells: state.cells.map(cell => cell.id === cellId ? { ...cell, seriesPreferences: copy } : cell) }));
    },
    subscribe: listener => {
      let previous = JSON.stringify(read());
      const changed = () => { const next = JSON.stringify(read()); if (next !== previous) { previous = next; listener(); } };
      return subscribeChartSettings("seriesPreferences", changed);
    } };
}

/** Series cosmetics and motion are independent of chart type, transforms, scale, market and study inputs. */
export function bindSeriesPreferences(renderer: Pick<Vela["renderer"], "getConfig" | "applyConfig" | "onConfigChanged">, host: SeriesPreferencesHost): () => void {
  const initial = readSeriesPreferences(renderer.getConfig());
  if (!initial) return () => {};
  let signature = seriesPreferencesKey(initial), disposed = false, applying = false;
  const apply = () => {
    if (disposed || applying) return;
    const saved = host.read(); if (saved === undefined || saved !== null && !validSeriesPreferences(saved)) return;
    const requested = saved ?? initial;
    const value = { ...requested, ...(initial.pluginCandles && !requested.pluginCandles ? { pluginCandles: initial.pluginCandles } : {}),
      ...(initial.footprint && !requested.footprint ? { footprint: initial.footprint } : {}),
      ...(initial.tpo && !requested.tpo ? { tpo: initial.tpo } : {}) }, next = seriesPreferencesKey(value);
    const config = renderer.getConfig() as { chartTypes?: { footprint?: Record<string, unknown> } };
    const raw = config.chartTypes?.footprint;
    // Materialize migrated palettes even when the normalized signature matches.
    // Otherwise a new candle-color edit on an empty native defaults bag could
    // be mistaken for an old shared-palette layout on its next read.
    const seedFootprint = value.footprint && config.chartTypes && (!raw || !["bidColor", "askColor", "volumeBuyColor", "volumeSellColor", "deltaUpColor", "deltaDownColor"].every(key => Object.hasOwn(raw, key)));
    if (next === signature && !seedFootprint) return;
    applying = true;
    try {
      renderer.applyConfig(nativeSeriesPreferences(value));
      signature = seriesPreferencesKey(readSeriesPreferences(renderer.getConfig()) ?? value);
    } finally { applying = false; }
  };
  apply();
  const offNative = renderer.onConfigChanged(() => {
    if (disposed || applying || host.read() === undefined) return;
    const value = readSeriesPreferences(renderer.getConfig()); if (!value || seriesPreferencesKey(value) === signature) return;
    signature = seriesPreferencesKey(value); host.write(value);
  });
  const offHost = host.subscribe(apply);
  return () => { disposed = true; offNative(); offHost(); };
}
