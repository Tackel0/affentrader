import type { RendererLayerArgs } from "@luxalgo/vela";
import type { DepthHeatmapChannel } from "./depthHeatmapIndicator";
import { createDepthHeatmapProjection, type DepthHeatmapCell } from "./depthHeatmap";
const projections = new WeakMap<DepthHeatmapChannel, ReturnType<typeof createDepthHeatmapProjection>>();
export function paintDepthHeatmap(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, channel: DepthHeatmapChannel, report?: (message: string) => boolean, inspect?: (cells: readonly DepthHeatmapCell[]) => void) {
  let message = channel.message;
  let cells: readonly DepthHeatmapCell[] = [];
  if (channel.style && channel.columns?.length) try {
    let project = projections.get(channel);
    if (!project) { project = createDepthHeatmapProjection(); projections.set(channel, project); }
    const style = channel.style, model = project(channel.columns, channel.now, style.rowSize);
    const maxIntensity = style.logarithmic ? Math.log1p(model.max) : model.max;
    let from = NaN, to = NaN, left = 0, right = 0, visible = false;
    for (const cell of model.cells) {
      if (cell.from !== from || cell.to !== to) {
        from = cell.from; to = cell.to;
        left = args.coords.timeToX(from); right = args.coords.timeToX(to);
        visible = right > 0 && left < args.coords.width && right > left;
      }
      if (!visible) continue;
      const y1 = args.coords.priceToY(cell.lower, args.scale, args.bounds), y2 = args.coords.priceToY(cell.upper, args.scale, args.bounds);
      const top = Math.min(y1, y2), height = Math.max(1, Math.abs(y2 - y1));
      if (top > args.bounds.top + args.bounds.height || top + height < args.bounds.top) continue;
      for (const [side, quantity, color] of [["bid", cell.bid, style.bidColor], ["ask", cell.ask, style.askColor]] as const) {
        if (!(quantity > 0) || !(maxIntensity > 0)) continue;
        const ratio = (style.logarithmic ? Math.log1p(quantity) : quantity) / maxIntensity;
        ctx.globalAlpha = style.opacity / 100 * ratio; ctx.fillStyle = color;
        const mixed = cell.bid > 0 && cell.ask > 0, width = (right - left) / (mixed ? 2 : 1);
        ctx.fillRect(left + (mixed && side === "ask" ? width : 0), top, width, height);
      }
    }
    cells = model.cells;
    message += ` · price rows ${model.step}`;
  } catch (error) { message = `Depth unavailable: ${error instanceof Error ? error.message : "Invalid projection."}`; }
  else projections.delete(channel);
  inspect?.(cells);
  if (report?.(message)) return;
  ctx.globalAlpha = 1; ctx.font = "10px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
  const width = Math.max(10, args.coords.width - 12), lines: string[] = []; let line = "";
  for (const word of `Liquidity heatmap · ${message}`.split(" ")) { const next = line ? `${line} ${word}` : word; if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line);
  const top = args.bounds.top + args.bounds.height - lines.length * 12 - 55;
  ctx.fillStyle = args.theme.background; ctx.fillRect(4, top - 3, width + 4, lines.length * 12 + 6); ctx.fillStyle = args.theme.textColor;
  lines.forEach((line, index) => ctx.fillText(line, 6, top + index * 12, width));
}
