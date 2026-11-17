import type { RendererLayerArgs } from "@luxalgo/vela";
import { buildVolumeTails, selectTailWindows, type TailDrawing, type TailsKind, type TailsSettings } from "./volumeTails";
import type { TailsChannel } from "./volumeTailsIndicator";

/** Renderer-owned cache: pan/zoom affects only visible tails; the snapshot identity
 * changes on archive/source/replay updates, even if candle endpoints stay fixed. */
export class TailsRenderCache {
  private trades?: TailsChannel["trades"]; private key = ""; private drawings: TailDrawing[] = [];
  read(args: RendererLayerArgs, channel: TailsChannel, kind: TailsKind): TailDrawing[] {
    if (!channel.trades || !channel.style || !channel.identity) return [];
    const visible = args.coords.visibleLogicalRange();
    const times = args.bars.map(b => b.time), key = JSON.stringify([kind, channel.style, channel.identity, channel.calendar, times, kind === "visible" ? visible : null]);
    if (this.trades === channel.trades && this.key === key) return this.drawings;
    const windows = selectTailWindows(channel.trades, args.bars, channel.identity.timeframe, kind, channel.style, channel.identity.symbol, visible,
      channel.identity.live ? undefined : channel.identity.through ?? undefined, channel.calendar);
    const drawings = windows.flatMap(window => { const tails = buildVolumeTails(window.trades, channel.style!); return tails ? [{ ...tails, start: window.start, end: window.end }] : []; });
    this.trades = channel.trades; this.key = key; this.drawings = drawings; return drawings;
  }
}

export function paintTailDrawing(ctx: CanvasRenderingContext2D, drawing: TailDrawing, style: TailsSettings,
  project: { x(time: number): number; y(price: number): number }, cursor?: { x: number; y: number } | null): string | undefined {
  const left = project.x(drawing.start), right = project.x(drawing.end);
  if (![left, right].every(Number.isFinite) || right <= left) return;
  const line = (price: number, color: string, dashed: boolean) => {
    const y = project.y(price); if (!Number.isFinite(y)) return;
    ctx.globalAlpha = .9; ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dashed ? [5, 3] : []);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.setLineDash([]);
  };
  let hover: string | undefined;
  for (const side of ["supply", "demand"] as const) {
    const tail = drawing[side]; if (!tail) continue;
    const color = style[`${side}Color`], a = project.y(tail.high), b = project.y(tail.low);
    if (![a, b].every(Number.isFinite)) continue;
    const top = Math.min(a, b), height = Math.abs(a - b);
    if (style[`${side}Area`]) { ctx.globalAlpha = .16; ctx.fillStyle = color; ctx.fillRect(left, top, right - left, Math.max(1, height)); }
    if (style[`${side}Average`]) line(tail.average, color, false);
    if (style[`${side}Weighted`]) line(tail.weighted, color, true);
    if (cursor && cursor.x >= left && cursor.x <= right && cursor.y >= top - 3 && cursor.y <= top + height + 3)
      hover = `${side === "supply" ? "Supply" : "Demand"} · ${tail.low}–${tail.high} · ${tail.volume} / ${drawing.target} target · mean ${tail.average} · weighted ${tail.weighted}${tail.reached ? "" : " · target not reached"}`;
  }
  const e = drawing.equilibrium;
  if (e) {
    if (style.equilibriumArea && drawing.demand!.high <= drawing.supply!.low) {
      const a = project.y(e.high), b = project.y(e.low);
      if ([a, b].every(Number.isFinite)) { ctx.globalAlpha = .07; ctx.fillStyle = style.equilibriumColor; ctx.fillRect(left, Math.min(a, b), right - left, Math.abs(a - b)); }
    }
    if (style.equilibriumAverage) line(e.average, style.equilibriumColor, false);
    if (style.equilibriumWeighted) line(e.weighted, style.equilibriumColor, true);
  }
  ctx.globalAlpha = 1; return hover;
}

export function paintVolumeTails(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, channel: TailsChannel, kind: TailsKind, cache: TailsRenderCache): string {
  if (!channel.style) return channel.message;
  const drawings = cache.read(args, channel, kind), project = { x: (time: number) => args.coords.timeToX(time), y: (price: number) => args.coords.priceToY(price, args.scale, args.bounds) };
  let hover: string | undefined;
  for (const drawing of drawings) if (project.x(drawing.end) >= 0 && project.x(drawing.start) <= args.coords.width)
    hover = paintTailDrawing(ctx, drawing, channel.style, project, args.cursor) ?? hover;
  if (hover && args.cursor) {
    ctx.font = "11px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    const width = Math.min(args.coords.width - 16, ctx.measureText(hover).width + 16), x = Math.max(4, Math.min(args.cursor.x + 12, args.coords.width - width - 4));
    const y = Math.max(args.bounds.top + 6, Math.min(args.cursor.y + 12, args.bounds.top + args.bounds.height - 30));
    ctx.fillStyle = args.theme.background; ctx.globalAlpha = .96; ctx.fillRect(x, y, width, 25); ctx.globalAlpha = 1;
    ctx.fillStyle = args.theme.textColor; ctx.fillText(hover, x + 6, y + 6, Math.max(1, width - 12));
  }
  const unmet = drawings.filter(d => d.supply && !d.supply.reached || d.demand && !d.demand.reached).length;
  return `${channel.message} · ${drawings.length} ranges${unmet ? ` · ${unmet} ranges have insufficient side volume for the threshold` : ""}${!drawings.length ? " · No observed executions inside this range." : ""}`;
}
