import type { RendererLayerArgs } from "@luxalgo/vela";
import type { TpoSession } from "./tpoModel";
import type { TpoPreferences } from "./tpoSettings";
import { tpoPeriodWindow, tpoSessionLayout } from "./tpoLayout";
import type { TpoMetrics, TpoMetricValue, TpoColorBy } from "./tpoMetrics";
export interface TpoCellHit {
  sessionIndex: number; rowIndex: number; itemIndex: number; letter: string; period: number;
  lower: number; upper: number; start: number; end: number;
  sessionStatus: TpoSession["completion"]["status"];
  rect: { x: number; y: number; width: number; height: number };
}
/** Same stacking order and visible geometry as the painter, including subpixel
 * rectangles, gutters, letters-only visibility and per-session overrides. */
export function tpoCellAtPoint(args: RendererLayerArgs, sessions: readonly TpoSession[], style: TpoPreferences, x: number, y: number): TpoCellHit | null {
  if (args.priceStyle !== "tpo" || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > args.coords.width ||
    y < args.bounds.top || y > args.bounds.top + args.bounds.height || !style.histogramVisible && !style.lettersVisible) return null;
  for (let s = sessions.length - 1; s >= 0; s--) {
    const session = sessions[s], layout = tpoSessionLayout(args, session, style);
    if (layout.rail) continue;
    if (layout.end < 0 || layout.left > args.coords.width || layout.end <= layout.left) continue;
    for (let r = session.rows.length - 1; r >= 0; r--) {
      const row = session.rows[r]; if (!row.count) continue;
      const upper = row.grid?.upper ?? row.price + session.step;
      const a = args.coords.priceToY(row.price, args.scale, args.bounds), b = args.coords.priceToY(upper, args.scale, args.bounds);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const height = Math.max(1, Math.abs(a - b)), top = Math.min(a, b), paintedHeight = style.histogramVisible ? Math.max(1, height - .6) : height;
      if (y < top || y >= top + paintedHeight || !style.histogramVisible && height < 8) continue;
      for (let i = row.count - 1; i >= 0; i--) {
        const cell = layout.cellAt(i, row.periodIndices[i]); if (!cell || !style.histogramVisible && cell.width < 6) continue;
        const width = !style.histogramVisible ? cell.width : layout.split ? cell.width - Math.min(.6, cell.width * .1) : Math.max(1, cell.width - .6);
        if (x >= cell.x && x < cell.x + width) return { sessionIndex: s, rowIndex: r, itemIndex: i, letter: row.periods[i], period: row.periodIndices[i],
          lower: row.grid?.lower ?? row.price, upper, sessionStatus: session.completion.status, ...tpoPeriodWindow(session, row.periodIndices[i], Number(style.blockMinutes)),
          rect: { x: cell.x, y: top, width, height: paintedHeight } };
      }
    }
  }
  return null;
}
const utc = (time: number) => new Date(time).toISOString().replace("T", " ").replace(".000Z", " UTC");
export function tpoHoverLines(hit: TpoCellHit, metric?: { mode: TpoColorBy; value?: TpoMetricValue }): string[] {
  const lines = [`TPO ${hit.letter}`, `Price [${hit.lower}, ${hit.upper})`, `From ${utc(hit.start)}`, `Until ${utc(hit.end)} (exclusive)`, `Loaded OHLC · ${hit.sessionStatus} session`];
  if (metric && metric.mode !== "Time") {
    const value = metric.value, format = (n: number) => n.toLocaleString("en-US", { maximumSignificantDigits: 12 });
    lines.push(!value ? "No observed block executions · Time fallback" : metric.mode === "Volume" ? `Observed block volume: ${format(value.buy + value.sell)}`
      : metric.mode === "Delta" ? `Observed block delta: ${format(value.buy - value.sell)}` : `Observed block trades: ${value.count === undefined ? "unknown" : format(value.count)}`);
    lines.push("Classified observations · partial coverage");
  }
  return lines;
}
export function paintTpoHover(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, sessions: readonly TpoSession[], style: TpoPreferences, metrics?: TpoMetrics): TpoCellHit | null {
  if (style.tooltipVisible === false || !args.cursor) return null;
  const hit = tpoCellAtPoint(args, sessions, style, args.cursor.x, args.cursor.y); if (!hit) return null;
  ctx.save(); try {
    ctx.globalAlpha = 1; ctx.font = "11px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    const value = metrics?.sessions.get(sessions[hit.sessionIndex].start)?.cells[hit.rowIndex].get(hit.period);
    const lines = tpoHoverLines(hit, { mode: style.colorBy ?? "Time", value }), width = Math.min(args.coords.width - 8, Math.max(...lines.map(line => ctx.measureText(line).width)) + 16);
    const height = lines.length * 15 + 12;
    if (width < 50 || args.bounds.height < height + 8) return hit;
    const x = Math.max(4, Math.min(args.cursor.x + 14, args.coords.width - width - 4));
    const y = Math.max(args.bounds.top + 4, Math.min(args.cursor.y + 14, args.bounds.top + args.bounds.height - height - 4));
    ctx.strokeStyle = args.theme.textColor; ctx.lineWidth = 1;
    ctx.strokeRect(hit.rect.x, hit.rect.y, hit.rect.width, hit.rect.height);
    ctx.fillStyle = args.theme.background; ctx.fillRect(x, y, width, height); ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = args.theme.textColor; lines.forEach((line, i) => ctx.fillText(line, x + 8, y + 6 + i * 15, width - 16));
  } finally { ctx.restore(); }
  return hit;
}
