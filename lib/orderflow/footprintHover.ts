import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import { nextBucket } from "@/lib/market/intervals";
import { footprintBarGeometry, type FootprintPlacement, type ResolvedFootprintPreferences } from "./footprint";
import { paintFootprintTooltip } from "./footprintTooltip";
import { footprintMagnifierWindow, paintFootprintMagnifier } from "./footprintMagnifier";
import type { FootprintMagnifierSurface } from "./footprintMagnifierSurface";

export interface FootprintHoverView { id: string; label: string; bars: readonly FootprintBar[]; step: number; style: ResolvedFootprintPreferences; placement?: FootprintPlacement }
export interface FootprintRowHit { view: FootprintHoverView; bar: FootprintBar; row: number; lower: number; upper: number; rect: { x: number; y: number; width: number; height: number } }
/** Inspect the complete observed price band, including display-filtered rows
 * and dense rows without labels. Missing price bands remain unknown. */
export function footprintRowAtPoint(args: RendererLayerArgs, views: readonly FootprintHoverView[], x: number, y: number, magnify = false, replay?: { timeframe: string; through: number }): FootprintRowHit | null {
  if (args.priceStyle !== "footprint" || !Number.isFinite(x) || !Number.isFinite(y) || replay && !Number.isFinite(replay.through) || x < 0 || x >= args.coords.width || y < args.bounds.top || y >= args.bounds.top + args.bounds.height) return null;
  const loaded = new Set(args.bars.map(bar => bar.time));
  for (let v = views.length - 1; v >= 0; v--) {
    const view = views[v];
    if (!(view.step > 0) || !Number.isFinite(view.step)) continue;
    for (let b = view.bars.length - 1; b >= 0; b--) {
      const bar = view.bars[b];
      if (!loaded.has(bar.time) || replay && nextBucket(replay.timeframe, bar.time) > replay.through) continue;
      const { center, half, width } = footprintBarGeometry(args, bar.time, view.placement);
      if (![width, center, half].every(Number.isFinite) || !(width > 0) || (view.placement?.opacity ?? 1) <= .01 || x < center - half || x >= center + half) continue;
      for (let r = bar.levels.length - 1; r >= 0; r--) {
        const level = bar.levels[r], upper = level.upperPrice ?? level.price + view.step;
        if (!Number.isFinite(level.price) || !Number.isFinite(upper) || upper <= level.price) continue;
        const a = args.coords.priceToY(level.price, args.scale, args.bounds), z = args.coords.priceToY(upper, args.scale, args.bounds);
        const height = Math.abs(a - z);
        if (!(height > 0) || !Number.isFinite(height)) continue;
        const paintedHeight = height, top = Math.min(a, z);
        if (y >= top && y < top + paintedHeight) return { view, bar, row: r, lower: level.price, upper, rect: { x: center - half, y: top, width, height: paintedHeight } };
      }
    }
  }
  return null;
}
const number = (n: number) => Number.isFinite(n) ? n.toLocaleString("en-US", { maximumSignificantDigits: 12 }) : "—";
export function footprintHoverLines(hit: FootprintRowHit): string[] {
  const row = hit.bar.levels[hit.row];
  return [`${hit.view.label} · [${number(hit.lower)}, ${number(hit.upper)})`,
    `Bid ${number(row.sellVolume)} × Ask ${number(row.buyVolume)}`,
    `Total ${number(row.buyVolume + row.sellVolume)} · Delta ${number(row.buyVolume - row.sellVolume)}`,
    "Partial observations · Shift: magnify"];
}
/** At most two canonical row slots on either side. Price gaps remain blank. */
export function footprintMagnifierRows(hit: FootprintRowHit) {
  const step = hit.view.step, tolerance = step * 1e-8;
  return hit.bar.levels.filter(row => row.price >= hit.lower - 2 * step - tolerance && row.price <= hit.lower + 2 * step + tolerance);
}
export function paintFootprintHover(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, views: readonly FootprintHoverView[], magnify = false, replay?: { timeframe: string; through: number }, surface?: FootprintMagnifierSurface): FootprintRowHit | null {
  surface?.clear();
  if (!args.cursor) return null;
  const hit = footprintRowAtPoint(args, views, args.cursor.x, args.cursor.y, magnify, replay); if (!hit) return null;
  if (!magnify) { ctx.save(); try { paintFootprintTooltip(ctx, args, hit); } finally { ctx.restore(); } return hit; }
  const target = surface?.acquire(args.coords.dpr) ?? ctx;
  target.save(); try { paintFootprintMagnifier(target, args, hit, footprintMagnifierWindow(args, hit, replay)); } finally { target.restore(); }
  return hit;
}

/** Shift belongs to the hovered chart only. Key transitions repaint even when
 * the mouse is stationary; leaving/blur/visibility loss clear stale modifiers. */
export function footprintHoverModifier(invalidate: () => void) {
  let shift = false, inside = false, detach = () => {};
  const update = (value: boolean) => { if (value !== shift) { shift = value; invalidate(); } };
  return { get shift() { return shift; }, mount(canvas: HTMLCanvasElement) {
    detach();
    const host = canvas.closest<HTMLElement>("[data-vela-cell]") ?? canvas.parentElement;
    if (!host) return;
    const doc = canvas.ownerDocument, win = doc.defaultView;
    const move = (event: PointerEvent) => { const target = event.target as Element | null; inside = !(target?.closest?.('input,textarea,select,button,[role="dialog"],[role="menu"],[contenteditable="true"]')); update(inside && event.shiftKey); };
    const leave = () => { inside = false; update(false); };
    const down = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"]')) { update(false); return; }
      if (event.key === "Shift" && inside) update(true);
    };
    const up = (event: KeyboardEvent) => { if (event.key === "Shift") update(inside && event.shiftKey); };
    host.addEventListener("pointermove", move); host.addEventListener("pointerleave", leave);
    doc.addEventListener("keydown", down); doc.addEventListener("keyup", up); doc.addEventListener("visibilitychange", leave); win?.addEventListener("blur", leave);
    detach = () => { host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", leave); doc.removeEventListener("keydown", down); doc.removeEventListener("keyup", up); doc.removeEventListener("visibilitychange", leave); win?.removeEventListener("blur", leave); inside = false; shift = false; };
  }, destroy() { detach(); detach = () => {}; } };
}
