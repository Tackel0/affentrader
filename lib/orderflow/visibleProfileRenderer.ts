import type { RendererLayerArgs } from "@luxalgo/vela";
import { formatVolume } from "@/lib/symbols";
import { VisibleProfileCache, visibleProfileSettings } from "./visibleProfile";
import type { CellContext } from "@/lib/chart/cellContext";
import { executionRangeSource } from "./executionRangeSource";
import type { FixedProfileResult } from "./fixedProfileModel";
import type { VisibleProfileSnapshot } from "./visibleProfileReadout";

export function paintVisibleProfile(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, cache: VisibleProfileCache, getCell?: () => CellContext | undefined, repaint?: () => void, report?: (title: string, message: string) => boolean): VisibleProfileSnapshot | undefined {
  if (!args.data) return;
  const { coords, scale, bounds, theme } = args;
  let message: string, sourceTitle = "OHLCV estimate";
  let snapshot: Omit<VisibleProfileSnapshot, "message"> = {};
  try {
    const style = visibleProfileSettings(args.data as Record<string, unknown>), range = coords.visibleLogicalRange();
    sourceTitle = style.volumeSource;
    const selected = cache.select(args.bars, range.from, range.to);
    snapshot = { style, first: selected[0]?.time, last: selected.at(-1)?.time };
    let result: FixedProfileResult | null, sourceLabel = "", notice: string | undefined;
    if (style.volumeSource === "Classified executions") {
      const select = () => executionRangeSource(getCell?.(), cache.select(args.bars, range.from, range.to)), source = select();
      snapshot.first = source.bars[0]?.time; snapshot.last = source.bars.at(-1)?.time;
      sourceLabel = source.label; const options = { rows: style.rows, valueAreaPct: style.valueAreaPct, developing: false };
      const pending = repaint && source.execution.trades.length > 10000 ? cache.background.read(source.bars, options, source.context, () => { const current = select(); return { ...current, options }; }, repaint, source.execution) : null;
      notice = pending?.notice;
      snapshot.pending = !!notice?.startsWith("Calculating");
      result = pending ? pending.result : cache.executions.read(source.bars, options, source.execution.trades, source.execution.timeframe);
    } else result = cache.read(args.bars, range.from, range.to, style);
    snapshot.result = result;
    if (!result) message = notice ? notice.startsWith("Calculating") ? notice : `Unavailable: ${notice}` : style.volumeSource === "Classified executions" ? "No observed classified executions in this view; missing history is unknown." : "No loaded OHLCV volume in this view.";
    else {
      const { profile } = result, width = Math.max(1, coords.width * style.widthPct / 100);
      const project = (price: number) => coords.priceToY(price, scale, bounds);
      profile.rows.forEach((row, index) => {
        const total = row.up + row.down; if (!(total > 0)) return;
        const a = project(profile.edges[index]), b = project(profile.edges[index + 1]), top = Math.min(a, b), height = Math.max(1, Math.abs(a - b) - 1);
        const size = total / profile.maxTotal * width, up = row.up / total * size, x = coords.width - size;
        ctx.globalAlpha = index >= profile.vaFrom && index <= profile.vaTo ? .62 : .28;
        if (up > 0) { ctx.fillStyle = style.upColor; ctx.fillRect(x, top, up, height); }
        if (size > up) { ctx.fillStyle = style.downColor; ctx.fillRect(x + up, top, size - up, height); }
      });
      if (style.showPoc) {
        const a = project(profile.edges[profile.poc]), b = project(profile.edges[profile.poc + 1]);
        ctx.globalAlpha = .9; ctx.strokeStyle = theme.textColor; ctx.lineWidth = 1;
        ctx.strokeRect(coords.width - width + .5, Math.min(a, b) + .5, Math.max(1, width - 1), Math.max(1, Math.abs(a - b) - 1));
      }
      if (profile.rows.length >= 8 && profile.nodes?.length) {
        ctx.save();
        ctx.font = "600 9px ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.setLineDash([4, 3]);
        for (const node of profile.nodes.slice(0, 6)) {
          const y = project(node.price);
          if (!Number.isFinite(y) || y < bounds.top + 8 || y > bounds.top + bounds.height - 8) continue;
          const color = node.kind === "HVN" ? "#38bdf8" : "#f59e0b";
          ctx.globalAlpha = node.kind === "HVN" ? .55 : .65;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(coords.width - width, Math.round(y) + .5);
          ctx.lineTo(coords.width, Math.round(y) + .5);
          ctx.stroke();
          ctx.globalAlpha = .9;
          ctx.fillStyle = color;
          ctx.fillText(node.kind, coords.width - 3, y - 6);
        }
        ctx.restore();
      }
      message = result.executions !== undefined ? `${sourceLabel} · ${result.executions} trades · buys ${result.buys} · sells ${result.sells} · delta ${result.delta} · volume ${result.total}` : `${result.bars} visible bars · volume ${formatVolume(result.total)}${result.rejected ? ` · ${result.rejected} invalid excluded` : ""}`;
    }
  } catch (error) { snapshot.result = null; snapshot.pending = false; message = `Unavailable: ${error instanceof Error ? error.message : "Invalid profile data."}`; }
  if (report?.(`VRVP · ${sourceTitle}`, message)) return { ...snapshot, message };
  ctx.globalAlpha = 1; ctx.font = "10px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const width = Math.max(10, coords.width - 60), lines: string[] = []; let line = "";
  for (const word of message.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  const bottom = bounds.top + bounds.height - 9, top = bottom - lines.length * 12;
  ctx.fillStyle = theme.background; ctx.fillRect(48, top - 13, Math.max(10, coords.width - 52), lines.length * 12 + 21);
  ctx.fillStyle = theme.textColor; ctx.fillText(`VRVP · ${sourceTitle}`, 52, top, width);
  lines.forEach((text, index) => ctx.fillText(text, 52, top + 12 + index * 12, width));
  return { ...snapshot, message };
}
