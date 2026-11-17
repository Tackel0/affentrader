"use client";
import { Menu, ensureUIHost } from "@luxalgo/vela/ui";
import type { RendererLayerArgs, Vela } from "@luxalgo/vela";
import type { TpoSession } from "./tpoModel";
import { resolveTpo, type TpoPreferences } from "./tpoSettings";
import { tpoCellAtPoint } from "./tpoHover";
import { tpoSessionLayout } from "./tpoLayout";
import { changeTpoOperations, scopedTpoOperations, type TpoSessionAction } from "./tpoOperations";
import { readSeriesPreferences, nativeSeriesPreferences } from "@/lib/chart/seriesPreferences";
export interface TpoMenuFrame { args: RendererLayerArgs; sessions: readonly TpoSession[]; style: TpoPreferences; symbol: string; timeframe: string }
const frames = new Map<string, { token: symbol; frame: TpoMenuFrame }>();
export function publishTpoMenuFrame(cell: string, token: symbol, frame: TpoMenuFrame) { frames.set(cell, { token, frame }); }
export function clearTpoMenuFrame(cell: string, token: symbol) { if (frames.get(cell)?.token === token) frames.delete(cell); }
export function tpoSessionHit(frame: TpoMenuFrame, x: number, y: number): number {
  for (let i = frame.sessions.length - 1; i >= 0; i--) {
    const session = frame.sessions[i], layout = tpoSessionLayout(frame.args, session, frame.style);
    if (!layout.rail) continue;
    const a = frame.args.coords.priceToY(session.rows[0].price, frame.args.scale, frame.args.bounds), b = frame.args.coords.priceToY(session.rows.at(-1)!.grid?.upper ?? session.rows.at(-1)!.price + session.step, frame.args.scale, frame.args.bounds);
    if (Math.abs(x - (layout.left + layout.end) / 2) <= Math.max(3, (layout.end - layout.left) * .3) && y >= Math.min(a, b) && y <= Math.max(a, b)) return i;
  }
  return tpoCellAtPoint(frame.args, frame.sessions, frame.style, x, y)?.sessionIndex ?? -1;
}
/** Native accessible menu; the clicked session is captured once, never re-targeted by menu pointer movement. */
export function bindTpoSessionMenu(host: HTMLElement, renderer: Vela["renderer"], cell: string): () => void {
  let menu: Menu | undefined;
  const open = (event: MouseEvent) => {
    const frame = frames.get(cell)?.frame; if (!frame) return;
    if (event.target instanceof Element && event.target.closest('button,input,select,[role="dialog"],[role="menu"]')) return;
    const canvas = host.querySelector("canvas"), rect = canvas?.getBoundingClientRect(); if (!rect) return;
    const index = tpoSessionHit(frame, event.clientX - rect.left, event.clientY - rect.top); if (index < 0) return;
    event.preventDefault(); event.stopImmediatePropagation(); menu?.destroy();
    ensureUIHost(host, frame.args.theme);
    const session = frame.sessions[index], members = (s: TpoSession) => s.members?.map(m => m.start) ?? [s.start];
    const groups = frame.sessions.map(members), split = session.expanded ?? frame.style.splitPeriods;
    const captured = frames.get(cell);
    menu = new Menu({ host, checkmarks: true, items: [
      { id: split ? "collapse" : "expand", label: split ? "Collapse TPO" : "Expand TPO" },
      { id: "previous", label: "Merge to previous TPO", disabled: index === 0 },
      { id: "following", label: "Merge to following TPO", disabled: index === frame.sessions.length - 1 },
      { id: "unmerge", label: "Unmerge TPO", disabled: members(session).length < 2 },
      { id: "unmerge-all", label: "Unmerge all TPOs", disabled: !frame.sessions.some(s => members(s).length > 1) },
      { id: "settings", label: "TPO Settings", separatorBefore: true },
    ], onSelect: action => {
      const current = frames.get(cell);
      // A repaint is allowed, but a changed market/settings/history cannot apply
      // an old menu command to a different profile.
      if (!current || current.token !== captured?.token || current.frame.symbol !== frame.symbol || current.frame.timeframe !== frame.timeframe ||
        JSON.stringify(current.frame.style) !== JSON.stringify(frame.style) || current.frame.sessions.map(s => s.start + ":" + s.end).join() !== frame.sessions.map(s => s.start + ":" + s.end).join()) return;
      if (action === "settings") { renderer.openSettings("TPO / Market Profile"); return; }
      const saved = readSeriesPreferences(renderer.getConfig()); if (!saved) return;
      const style = resolveTpo(saved.tpo);
      style.sessionOperations = changeTpoOperations(scopedTpoOperations(style, frame.timeframe, frame.symbol), groups, index, action as TpoSessionAction);
      renderer.applyConfig(nativeSeriesPreferences({ ...saved, tpo: style }));
    } });
    menu.openAt(event.clientX, event.clientY);
  };
  host.addEventListener("contextmenu", open, true);
  return () => { host.removeEventListener("contextmenu", open, true); menu?.destroy(); };
}
