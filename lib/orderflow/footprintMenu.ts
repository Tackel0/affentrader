"use client";
import { Menu, ensureUIHost, type MenuItemDescriptor } from "@luxalgo/vela/ui";
import type { RendererLayerArgs, Vela } from "@luxalgo/vela";
import { contextForCanvas } from "@/lib/chart/cellContext";
import { readSeriesPreferences, nativeSeriesPreferences } from "@/lib/chart/seriesPreferences";
import { useChartStore } from "@/stores/useChartStore";
import { rangeProfileSourceStamp } from "./executionRangeSource";
import { footprintRowAtPoint, type FootprintHoverView } from "./footprintHover";
import { resolveFootprintChart, resolveFootprintInstances, resolveVisibleFootprint } from "./footprint";

export interface FootprintMenuScope { symbol: string; timeframe: string; epoch: number; sourceStamp: string; replay: boolean; through?: number | null }
export interface FootprintMenuFrame { args: RendererLayerArgs; views: readonly FootprintHoverView[]; scope: FootprintMenuScope; visibleEnabled: boolean }
const frames = new Map<string, { token: symbol; frame: FootprintMenuFrame }>();
export function publishFootprintMenuFrame(cell: string, token: symbol, frame: FootprintMenuFrame) { frames.set(cell, { token, frame }); }
export function clearFootprintMenuFrame(cell: string, token: symbol) { if (frames.get(cell)?.token === token) frames.delete(cell); }
export function footprintMenuItems(view: FootprintHoverView, visibleEnabled: boolean): MenuItemDescriptor[] {
  return [{ id: "statistics", label: "Stat table", checked: view.style.statisticsVisible, hint: view.label },
    { id: "average", label: "Average trade size", checked: view.style.averageTradeSize, hint: view.label },
    { id: "visible", label: "Visible range profile", checked: visibleEnabled },
    { id: "settings", label: "Footprint Settings", separatorBefore: true }];
}
function targetStyle(value: unknown, id: string) {
  if (id === "vr") { const visible = resolveVisibleFootprint(value); return visible.enabled ? visible.style : undefined; }
  return resolveFootprintInstances(value).find(view => view.id === id)?.style;
}
/** Pure settings action; consumers commit through the native persistence seam. */
export function changeFootprintMenu(value: unknown, id: string, action: string) {
  const style = targetStyle(value, id); if (!style || !["statistics", "average", "visible"].includes(action)) return null;
  const next = resolveFootprintChart(value);
  if (action === "visible") next.vrEnabled = !resolveVisibleFootprint(value).enabled;
  else {
    const key = action === "statistics" ? "statisticsVisible" : "averageTradeSize";
    const prefix = id === "vr" ? "vr" : id === "fp1" ? "" : id;
    next[prefix ? `${prefix}${key[0].toUpperCase()}${key.slice(1)}` : key] = !style[key];
  }
  return next;
}
/** Live quantities may change while a menu is open. Its owner, source, Replay
 * boundary, target instance and selected controls must still match. */
export function footprintMenuCurrent(captured: FootprintMenuFrame, current: FootprintMenuFrame, scope: FootprintMenuScope | undefined, settings: unknown, id: string) {
  const same = (value: FootprintMenuScope) => !!scope && value.symbol === scope.symbol && value.timeframe === scope.timeframe && value.epoch === scope.epoch && value.sourceStamp === scope.sourceStamp && value.replay === scope.replay && (!value.replay || value.through === scope.through);
  if (!same(captured.scope) || !same(current.scope)) return false;
  const before = captured.views.find(view => view.id === id), after = current.views.find(view => view.id === id), saved = targetStyle(settings, id);
  return !!before && !!after && !!saved && JSON.stringify(before.style) === JSON.stringify(after.style) && JSON.stringify(before.style) === JSON.stringify(saved)
    && captured.visibleEnabled === current.visibleEnabled && current.visibleEnabled === resolveVisibleFootprint(settings).enabled;
}
function currentScope(canvas: HTMLCanvasElement): FootprintMenuScope | undefined {
  const cell = contextForCanvas(canvas); if (!cell) return;
  return { symbol: cell.symbol, timeframe: cell.timeframe, epoch: useChartStore.getState().marketEpochs[cell.symbol] ?? 0,
    sourceStamp: rangeProfileSourceStamp(cell.symbol, cell.timeframe), replay: cell.replay,
    ...(cell.replay ? { through: cell.replayThrough } : {}) };
}
function isFootprint(renderer: Vela["renderer"]) {
  const config = renderer.getConfig();
  if (!config || typeof config !== "object" || !("series" in config)) return false;
  const series = config.series;
  return !!series && typeof series === "object" && "style" in series && series.style === "footprint";
}
export function bindFootprintMenu(host: HTMLElement, renderer: Vela["renderer"], cell: string, readScope?: () => FootprintMenuScope | undefined): () => void {
  let menu: Menu | undefined;
  const open = (event: MouseEvent) => {
    const captured = frames.get(cell); if (!captured || !isFootprint(renderer)) return;
    if (event.target instanceof Element && event.target.closest('button,input,select,textarea,[role="dialog"],[role="menu"],[contenteditable="true"]')) return;
    const canvas = host.querySelector("canvas"), rect = canvas?.getBoundingClientRect(); if (!canvas || !rect) return;
    const frame = captured.frame, scope = () => readScope ? readScope() : currentScope(canvas);
    const hit = footprintRowAtPoint(frame.args, frame.views, event.clientX - rect.left, event.clientY - rect.top, false,
      frame.scope.replay ? { timeframe: frame.scope.timeframe, through: frame.scope.through ?? NaN } : undefined);
    const settings = readSeriesPreferences(renderer.getConfig());
    if (!hit || !settings || !footprintMenuCurrent(frame, frame, scope(), settings.footprint, hit.view.id)) return;
    event.preventDefault(); event.stopImmediatePropagation(); menu?.destroy(); ensureUIHost(host, frame.args.theme);
    menu = new Menu({ host, checkmarks: true, items: footprintMenuItems(hit.view, frame.visibleEnabled), onSelect: action => {
      const current = frames.get(cell), saved = readSeriesPreferences(renderer.getConfig());
      if (!current || current.token !== captured.token || !saved || !isFootprint(renderer) || !footprintMenuCurrent(frame, current.frame, scope(), saved.footprint, hit.view.id)) return;
      if (action === "settings") { renderer.openSettings(hit.view.id === "vr" ? "Visible range" : "Footprint"); return; }
      const next = changeFootprintMenu(saved.footprint, hit.view.id, action); if (next) renderer.applyConfig(nativeSeriesPreferences({ ...saved, footprint: next }));
    } });
    menu.openAt(event.clientX, event.clientY);
  };
  host.addEventListener("contextmenu", open, true);
  return () => { host.removeEventListener("contextmenu", open, true); menu?.destroy(); };
}
