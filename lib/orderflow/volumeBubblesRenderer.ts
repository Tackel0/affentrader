import type { RendererLayerArgs } from "@luxalgo/vela";
import { formatVolume } from "@/lib/symbols";
import type { BubblesChannel } from "./volumeBubblesIndicator";
import { bubbleStep, volumeBubbles, type VolumeBubble } from "./volumeBubbles";

export interface PaintedBubble extends VolumeBubble { x: number; y: number }
export function bubbleAtPoint(bubbles: readonly PaintedBubble[], x: number, y: number): PaintedBubble | undefined {
  // Small bubbles are painted last; hit-test in the same visual stacking order.
  return [...bubbles].reverse().find(b => (x - b.x) ** 2 + (y - b.y) ** 2 <= b.radius ** 2);
}
export function paintVolumeBubbles(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, channel: BubblesChannel): PaintedBubble[] {
  if (!channel.history || !channel.style) return [];
  if (!channel.style.tickSize && !channel.priceTick) return [];
  const style = channel.style, range = args.coords.visibleTimeRange(), step = bubbleStep(args, style, channel.priceTick);
  const bars = channel.history.read({ step, ratio: 3 });
  const bubbles = volumeBubbles(bars, range.from, range.to, style, args.scale.min, args.scale.max).map(b => ({ ...b,
    x: args.coords.timeToX(b.time), y: args.coords.priceToY(b.lower + (b.upper - b.lower) / 2, args.scale, args.bounds) }));
  for (const b of bubbles) {
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    ctx.globalAlpha = b.alpha;
    if (style.mode === "Delta") {
      const split = -Math.PI / 2 + Math.PI * 2 * b.buy / b.volume;
      for (const [start, end, color] of [[-Math.PI / 2, split, style.buyColor], [split, Math.PI * 1.5, style.sellColor]] as const) {
        if (end <= start) continue;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, b.radius, start, end); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
      }
    } else {
      ctx.fillStyle = !style.colorBySide || b.buy === b.sell ? style.neutralColor : b.buy > b.sell ? style.buyColor : style.sellColor;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
    }
    if (b.highlight) { ctx.globalAlpha = style.opacity / 100; ctx.strokeStyle = style.ringColor; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 2, 0, Math.PI * 2); ctx.stroke(); }
    if (style.labels) { ctx.globalAlpha = 1; ctx.fillStyle = args.theme.textColor; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
      ctx.textBaseline = "middle"; ctx.fillText(formatVolume(b.volume), b.x, b.y); }
  }
  const hover = style.tooltip && args.cursor ? bubbleAtPoint(bubbles, args.cursor.x, args.cursor.y) : undefined;
  if (hover) {
    const lines = [new Date(hover.time).toISOString(), `Price ${hover.lower} – ${hover.upper}`,
      `Buy ${formatVolume(hover.buy)} · Sell ${formatVolume(hover.sell)}`, `Volume ${formatVolume(hover.volume)} · Δ ${hover.deltaPercent.toFixed(1)}%`];
    ctx.globalAlpha = 1; ctx.font = "11px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    const width = Math.min(args.coords.width - 8, Math.max(...lines.map(line => ctx.measureText(line).width)) + 16);
    const height = 64, x = Math.max(4, Math.min(hover.x + hover.radius + 8, args.coords.width - width - 4));
    const y = Math.max(args.bounds.top + 4, Math.min(hover.y + 8, args.bounds.top + args.bounds.height - height - 4));
    ctx.fillStyle = args.theme.background; ctx.fillRect(x, y, width, height); ctx.strokeStyle = args.theme.textColor; ctx.lineWidth = 1; ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = args.theme.textColor; lines.forEach((line, i) => ctx.fillText(line, x + 8, y + 6 + i * 13, width - 16));
  }
  ctx.globalAlpha = 1;
  return bubbles;
}
