import type { RendererLayerArgs } from "@luxalgo/vela";
import { formatVolume } from "@/lib/symbols";
import { activeBarStats, barStatLabels, barStatsCells, type BarStatCell } from "./barStats";
import type { BarStatsChannel } from "./barStatsIndicator";

export interface PaintedStat extends BarStatCell { x: number; y: number; width: number; height: number; text: boolean }
export function statAtPoint(cells: readonly PaintedStat[], x: number, y: number) {
  return cells.find(cell => x >= cell.x && x < cell.x + cell.width && y >= cell.y && y < cell.y + cell.height);
}
export function paintBarStats(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, channel: BarStatsChannel): PaintedStat[] {
  if (!channel.stats || !channel.style) return [];
  const style = channel.style, rows = activeBarStats(style);
  if (!rows.length) return [];
  const logical = args.coords.visibleLogicalRange(), first = Math.max(0, Math.floor(logical.from)), last = Math.min(args.bars.length - 1, Math.ceil(logical.to));
  const pitch = args.coords.pxPerBar(), height = args.bounds.height / rows.length;
  if (!(pitch > 0) || !(height > 0)) return [];
  const columns = new Map<number, number>();
  for (const bar of args.bars.slice(first, last + 1)) {
    const left = args.coords.timeToX(bar.time) - pitch / 2;
    if (Number.isFinite(left) && left + pitch > 0 && left < args.coords.width) columns.set(bar.time, left);
  }
  const cells = barStatsCells(channel.stats, columns, style);
  const painted: PaintedStat[] = [];
  ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const cell of cells) {
    const x = columns.get(cell.time)!, y = args.bounds.top + cell.rowIndex * height;
    ctx.globalAlpha = cell.alpha; ctx.fillStyle = cell.color;
    ctx.fillRect(x + .5, y + .5, Math.max(.5, pitch - 1), Math.max(.5, height - 1));
    const label = cell.row.endsWith("Trades") || cell.row === "trades" ? Math.abs(cell.value) >= 10000 ? formatVolume(cell.value) : String(cell.value) : formatVolume(cell.value);
    const text = style.values === "Auto" && height >= 12 && ctx.measureText(label).width + 6 <= pitch;
    if (text) { ctx.globalAlpha = 1; ctx.fillStyle = args.theme.textColor; ctx.fillText(label, x + pitch / 2, y + height / 2); }
    painted.push({ ...cell, x, y, width: pitch, height, text });
  }
  const cursor = args.cursor;
  const hover = cursor && cursor.x >= 0 && cursor.x < args.coords.width
    ? statAtPoint(painted, cursor.x, cursor.y) : undefined;
  if (hover) {
    const lines = [new Date(hover.time).toISOString(), `${barStatLabels[hover.row]}: ${hover.exact}`];
    ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.font = "11px sans-serif";
    const width = Math.min(args.coords.width - 8, Math.max(...lines.map(line => ctx.measureText(line).width)) + 14), h = 36;
    const left = Math.max(4, Math.min(hover.x + pitch + 6, args.coords.width - width - 4));
    const top = Math.max(args.bounds.top + 2, Math.min(hover.y, args.bounds.top + args.bounds.height - h - 2));
    ctx.fillStyle = args.theme.background; ctx.fillRect(left, top, width, h);
    ctx.fillStyle = args.theme.textColor; lines.forEach((line, i) => ctx.fillText(line, left + 7, top + 5 + i * 14, width - 14));
  }
  ctx.globalAlpha = 1;
  return painted;
}
