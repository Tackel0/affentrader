import type { RendererLayerArgs } from "@luxalgo/vela";
import { visibleSlice } from "@/lib/chart/canvasLayer";
import type { TpoSession } from "./tpoModel";
import type { TpoPreferences } from "./tpoSettings";
import { tpoIbExtension } from "./tpoIbExtension";
import { tpoReferenceLevels } from "./tpoReferenceLevels";
import { tpoReferenceTouches, type TpoTouches } from "./tpoReferenceTouches";
import { paintTpoMarkers } from "./tpoMarkerRenderer";
import { paintTpoHover } from "./tpoHover";
import { TpoVolumeLadderCache, paintTpoVolumeLadder } from "./tpoVolumeLadder";
import { tpoTimePalette, tpoMetricInk } from "./tpoTimeColors";
import type { TpoMetrics } from "./tpoMetrics";
const paintSamples = new WeakMap<object, number>();
const ladderCaches = new WeakMap<object, TpoVolumeLadderCache>();

import { tpoSessionLayout } from "./tpoLayout";
export { tpoSessionLayout } from "./tpoLayout";

/** Session-time blocks, POC/VA lines, range bracket and price candles. */
export function paintTpoSessions(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, sessions: readonly TpoSession[], style: TpoPreferences, observedTouches?: TpoTouches, priceBars = args.bars, metrics?: TpoMetrics) {
  const { coords, bounds, scale } = args;
  let ladderCache = ladderCaches.get(ctx); if (!ladderCache) { ladderCache = new TpoVolumeLadderCache(); ladderCaches.set(ctx, ladderCache); }
  const ladders = ladderCache.read(args.bars, sessions, style);
  const touches = style.extensionUntilTouch ? observedTouches ?? tpoReferenceTouches(args.bars, sessions) : undefined;
  const audit = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("tpo-frame-audit");
  let boxes = 0, projectedArea = 0;
  const projected: Array<{ start: number; left: number; end: number; rows: number; width: number }> = [];
  ctx.save(); try { ctx.font = "8px ui-monospace, monospace"; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  const textColor = style.textColorAuto ? args.theme.textColor : style.textColor;
  for (const session of sessions) {
    const { left, end, cellWidth, cellAt, split, rail } = tpoSessionLayout(args, session, style);
    if (end < 0 || left > coords.width || end < left || !rail && end === left) continue;
    // As in Vela, a window compressed below 14px remains a range/VA/POC rail
    // rather than disappearing or pretending that individual blocks are legible.
    if (rail) {
      const width = Math.max(1.5, (end - left) * .3), x = (left + end) / 2;
      const band = (low: number, high: number, color: string, alpha: number) => {
        const a = coords.priceToY(low, scale, bounds), b = coords.priceToY(high, scale, bounds);
        ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(x - width / 2, Math.min(a, b), width, Math.max(1, Math.abs(a - b)));
      };
      band(session.rows[0].price, session.rows.at(-1)!.grid?.upper ?? session.rows.at(-1)!.price + session.step, style.outsideColor, .35);
      if (style.valueAreaVisible) band(session.rows[session.valueArea.low].price, session.rows[session.valueArea.high].grid?.upper ?? session.rows[session.valueArea.high].price + session.step, style.valueAreaColor, .7);
      if (style.pocVisible) {
        const row = session.rows[session.valueArea.poc], price = row.grid?.center ?? row.price + session.step / 2;
        const height = style.pocWidth ?? 2;
        ctx.globalAlpha = .9; ctx.fillStyle = style.pocColor; ctx.fillRect(x - width, coords.priceToY(price, scale, bounds) - height / 2, width * 2, height);
      }
      ctx.globalAlpha = 1; continue;
    }
    if (audit) projected.push({ start: session.start, left, end, rows: session.rows.length, width: cellWidth });
    const palette = tpoTimePalette(session, style);
    const sessionMetrics = metrics?.sessions.get(session.start);
    const line = (price: number, color: string, width = 1) => {
      const y = coords.priceToY(price, scale, bounds); ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(end, y); ctx.stroke();
    };
    if (style.valueAreaVisible && style.valueAreaFill) {
      const lower = session.rows[session.valueArea.low].grid?.lower ?? session.rows[session.valueArea.low].price;
      const upper = session.rows[session.valueArea.high].grid?.upper ?? session.rows[session.valueArea.high].price + session.step;
      const a = coords.priceToY(lower, scale, bounds), b = coords.priceToY(upper, scale, bounds);
      ctx.globalAlpha = 1; ctx.fillStyle = style.valueAreaFillColor ?? "rgba(178,181,190,0.08)";
      ctx.fillRect(left, Math.min(a, b), end - left, Math.abs(a - b));
    }
    if (style.singlePrintsVisible) for (const zone of session.structure.singlePrintZones) {
      const a = coords.priceToY(zone.lower, scale, bounds), b = coords.priceToY(zone.upper, scale, bounds);
      ctx.globalAlpha = .1; ctx.fillStyle = style.singlePrintColor ?? "#e040fb";
      ctx.beginPath(); ctx.rect(left, Math.min(a, b), end - left, Math.max(1, Math.abs(a - b))); ctx.fill(); ctx.globalAlpha = 1;
    }
    session.rows.forEach((row, index) => {
      if (!row.count) return;
      const a = coords.priceToY(row.price, scale, bounds), b = coords.priceToY(row.grid?.upper ?? row.price + session.step, scale, bounds);
      const height = Math.max(1, Math.abs(a - b)), top = Math.min(a, b), y = (a + b) / 2;
      if (top > bounds.top + bounds.height || top + height < bounds.top) return;
      const inArea = index >= session.valueArea.low && index <= session.valueArea.high;
      const metricInk = tpoMetricInk(style, sessionMetrics, sessionMetrics?.rows[index], inArea);
      // Keep rows separate so overlapping subpixel-height rows retain independent alpha composition.
      if (style.histogramVisible) {
        ctx.globalAlpha = metricInk?.alpha ?? palette.alpha(inArea);
        for (let item = 0; item < row.count; item++) {
          const cell = cellAt(item, row.periodIndices[item]);
          if (!cell || cell.x + cell.width < 0 || cell.x > coords.width) continue;
          const x = cell.x, width = split ? cell.width - Math.min(.6, cell.width * .1) : Math.max(1, cell.width - .6);
          const blockHeight = Math.max(1, height - .6);
          ctx.fillStyle = metricInk?.color ?? palette.colors[row.periodIndices[item]];
          ctx.beginPath(); ctx.rect(x, top, width, blockHeight); ctx.fill();
          if (audit) { boxes++; projectedArea += width * blockHeight; }
        }
        ctx.globalAlpha = 1;
      }
      if (style.lettersVisible && height >= 8) {
        ctx.globalAlpha = palette.alpha(inArea);
        ctx.fillStyle = textColor;
        for (let item = 0; item < row.count; item++) {
          const cell = cellAt(item, row.periodIndices[item]);
          if (!cell || cell.width < 6 || cell.x + cell.width < 0 || cell.x > coords.width) continue;
          ctx.fillText(row.periods[item], cell.x + cell.width / 2, y, cell.width - 1);
        }
        ctx.globalAlpha = 1;
      }
    });
    if (style.pocVisible) line(session.rows[session.valueArea.poc].grid?.center ?? session.rows[session.valueArea.poc].price + session.step / 2, style.pocColor, style.pocWidth ?? 2);
    if (style.valueAreaVisible) {
      ctx.globalAlpha = .6; line(session.rows[session.valueArea.low].price, style.valueAreaColor);
      line(session.rows[session.valueArea.high].grid?.upper ?? session.rows[session.valueArea.high].price + session.step, style.valueAreaColor); ctx.globalAlpha = 1;
    }
    if (style.boundariesVisible) {
      const low = coords.priceToY(session.rows[0].price, scale, bounds), high = coords.priceToY(session.rows.at(-1)!.grid?.upper ?? session.rows.at(-1)!.price + session.step, scale, bounds);
      ctx.strokeStyle = style.boundaryColor; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left + 3, low); ctx.lineTo(left - 2, low); ctx.lineTo(left - 2, high); ctx.lineTo(left + 3, high); ctx.stroke();
    }
    const structuralLabel = (price: number, label: string, color: string) => {
      ctx.fillStyle = color; ctx.textAlign = "left";
      ctx.fillText(label, left + 6, coords.priceToY(price, scale, bounds) - 6, 155); ctx.textAlign = "center";
    };
    for (const [extreme, visible, label, upper] of [
      [session.structure.poorHigh, style.poorHighVisible, "Poor high", true],
      [session.structure.poorLow, style.poorLowVisible, "Poor low", false],
    ] as const) if (visible && extreme) {
      const price = upper ? extreme.upper : extreme.lower, color = style.poorColor ?? "#ff9800";
      line(price, color, 1.5); structuralLabel(price, `${label} · ${extreme.opportunities} blocks`, color);
    }
    if (style.singlePrintsVisible) for (const zone of session.structure.singlePrintZones) {
      const color = style.singlePrintColor ?? "#e040fb";
      line(zone.lower, color); line(zone.upper, color);
      structuralLabel(zone.upper, `Single print · ${zone.rows} ${zone.rows === 1 ? "row" : "rows"}`, color);
    }
    let contentRight = left + cellWidth;
    if (style.ladderVisible) for (const row of session.rows) if (row.count) {
      const cell = cellAt(row.count - 1, row.periodIndices.at(-1)!); if (cell) contentRight = Math.max(contentRight, cell.x + cell.width);
    }
    paintTpoVolumeLadder(ctx, args, ladders.get(session.start), style, left, contentRight);
    paintTpoMarkers(ctx, args, session, style, left, end);
    const ib = session.initialBalance;
    if ((style.ibVisible ?? true) && ib.high !== null && ib.low !== null) {
      const high = coords.priceToY(ib.high, scale, bounds), low = coords.priceToY(ib.low, scale, bounds), x = left + 9;
      ctx.strokeStyle = style.ibColor ?? "#00bcd4"; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
      ctx.setLineDash?.(ib.status === "complete" ? [] : [3, 3]);
      ctx.beginPath(); ctx.moveTo(x + 5, high); ctx.lineTo(x, high); ctx.lineTo(x, low); ctx.lineTo(x + 5, low); ctx.stroke();
      ctx.setLineDash?.([]); ctx.textAlign = "left";
      ctx.fillText(`IB${ib.status === "complete" ? "" : ` · ${ib.status}`}`, x + 7, Math.min(high, low) - 6, 130); ctx.textAlign = "center";
    }
    if (style.ibExtensionVisible) {
      const extension = tpoIbExtension(ib, style.ibExtensionPercent ?? 100);
      const from = Math.max(left, coords.timeToX(ib.end));
      if (extension.status === "ready" && from < end) {
        ctx.strokeStyle = style.ibColor ?? "#00bcd4"; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1;
        ctx.setLineDash?.([4, 3]); ctx.textAlign = "left";
        for (const [price, sign] of [[extension.upper!, "+"], [extension.lower!, "−"]] as const) {
          const y = coords.priceToY(price, scale, bounds);
          ctx.beginPath(); ctx.moveTo(from, y); ctx.lineTo(end, y); ctx.stroke();
          ctx.fillText(`IB ${sign}${style.ibExtensionPercent ?? 100}%`, from + 4, y - 6, 110);
        }
        ctx.setLineDash?.([]); ctx.textAlign = "center";
      }
    }
  }
  if (style.extendPoc || style.extendVah || style.extendVal) for (const session of sessions) {
    const reference = tpoReferenceLevels(session); if (!reference) continue;
    const from = Math.max(0, coords.timeToX(reference.from)), end = coords.width;
    if (from >= end) continue;
    ctx.setLineDash?.([5, 4]); ctx.lineWidth = 1; ctx.textAlign = "left";
    for (const [name, enabled, price, color] of [
      ["POC", style.extendPoc, reference.poc, style.extensionPocColor ?? "#ff9800"],
      ["VAH", style.extendVah, reference.vah, style.extensionVaColor ?? "#26a69a"],
      ["VAL", style.extendVal, reference.val, style.extensionVaColor ?? "#26a69a"],
    ] as const) if (enabled) {
      const touched = touches?.get(session.start)?.[name.toLowerCase() as "poc" | "vah" | "val"];
      const until = touched === undefined || touched === null ? end : Math.min(end, coords.timeToX(touched));
      if (until <= from) continue;
      const y = coords.priceToY(price, scale, bounds);
      if (y < bounds.top || y > bounds.top + bounds.height) continue;
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.lineWidth = name === "POC" ? style.pocWidth ?? 2 : 1;
      ctx.beginPath(); ctx.moveTo(from, y); ctx.lineTo(until, y); ctx.stroke();
      if (until - from >= 100) ctx.fillText(`${name} · ${touched === undefined || touched === null ? "completed" : "observed touch"}`, from + 4, y - 6, Math.min(150, until - from - 8));
    }
    ctx.setLineDash?.([]); ctx.textAlign = "center";
  }
  if (style.candlesVisible) {
    const range = coords.visibleTimeRange(), [from, to] = visibleSlice(priceBars, range.from, range.to), width = Math.max(1, Math.min(4, coords.pxPerBar() * .6));
    for (const bar of priceBars.slice(from, to)) {
      const x = coords.timeToX(bar.time), open = coords.priceToY(bar.open, scale, bounds), close = coords.priceToY(bar.close, scale, bounds);
      const color = bar.close >= bar.open ? args.theme.upColor : args.theme.downColor;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, coords.priceToY(bar.high, scale, bounds)); ctx.lineTo(x, coords.priceToY(bar.low, scale, bounds)); ctx.stroke();
      ctx.fillRect(x - width / 2, Math.min(open, close), width, Math.max(1, Math.abs(open - close)));
    }
  }
  paintTpoHover(ctx, args, sessions, style, metrics);
  } finally { ctx.restore(); }
  if (audit && performance.now() - (paintSamples.get(ctx) ?? -Infinity) >= 500) {
    paintSamples.set(ctx, performance.now());
    let bluePixels: number | undefined;
    if (new URLSearchParams(window.location.search).has("tpo-pixel-audit") || window.location.hash === "#tpo-pixel-audit") {
      const pixels = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data; bluePixels = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2] > 90 && pixels[i + 2] > pixels[i] * 1.5 && pixels[i + 2] > pixels[i + 1] * 1.5 && pixels[i + 3] > 30) bluePixels++;
    }
    console.debug("[tpo-frame-audit]", JSON.stringify({ bars: args.bars.length, last: args.bars.at(-1)?.time, boxes, projectedArea, bluePixels,
      histogram: style.histogramVisible, letters: style.lettersVisible, split: style.splitPeriods, color: style.valueAreaColor, bounds, scale,
      width: ctx.canvas.width, height: ctx.canvas.height, composite: ctx.globalCompositeOperation, alpha: ctx.globalAlpha, projected }));
  }
  return ladders;
}
