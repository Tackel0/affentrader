"use client";
import { registerRendererLayer, type RendererLayerArgs } from "@luxalgo/vela";
import { canvasLayer, visibleSlice } from "./canvasLayer";
import {
  getOverlays,
  valueAt,
  type OverlayLine,
  type OverlayMarker,
} from "./overlays";

function paintLine(
  ctx: CanvasRenderingContext2D,
  args: RendererLayerArgs,
  line: OverlayLine,
) {
  const { coords, scale, bounds, bars } = args;
  const range = coords.visibleTimeRange();
  const [from, to] = visibleSlice(line.points, range.from, range.to);
  const points = line.points.slice(from, to);
  if (points.length < 2) return;
  let map = (v: number) => coords.priceToY(v, scale, bounds);
  if (line.scale === "relative") {
    const [start] = visibleSlice(bars, range.from, range.to);
    const anchorBar = bars[start];
    const v0 = anchorBar ? valueAt(line.points, anchorBar.time) : null;
    if (anchorBar && v0) {
      const factor = anchorBar.close / v0;
      map = (v) => coords.priceToY(v * factor, scale, bounds);
    }
  } else if (line.scale === "own") {
    let min = Infinity;
    let max = -Infinity;
    for (const point of points) {
      min = Math.min(min, point.value);
      max = Math.max(max, point.value);
    }
    const pad = bounds.height * 0.08;
    const span = max - min || Math.abs(max) * 0.01 || 1;
    map = (v) =>
      bounds.top + pad + (1 - (v - min) / span) * (bounds.height - 2 * pad);
  }
  ctx.save();
  ctx.strokeStyle = line.color;
  ctx.lineWidth = line.width;
  ctx.lineJoin = "round";
  if (line.dash) ctx.setLineDash(line.dash);
  ctx.beginPath();
  let drawing = false;
  for (const point of points) {
    if (!Number.isFinite(point.value)) {
      drawing = false;
      continue;
    }
    const x = coords.timeToX(point.time);
    const y = map(point.value);
    if (drawing) ctx.lineTo(x, y);
    else {
      ctx.moveTo(x, y);
      drawing = true;
    }
  }
  ctx.stroke();
  ctx.restore();
  const last = points.at(-1);
  if (line.label && last && Number.isFinite(last.value)) {
    ctx.fillStyle = line.color;
    ctx.font = "11px sans-serif";
    const text = line.label;
    ctx.fillText(
      text,
      Math.min(coords.width - ctx.measureText(text).width - 6, coords.timeToX(last.time) + 6),
      map(last.value) - 6,
    );
  }
}

function paintMarker(
  ctx: CanvasRenderingContext2D,
  args: RendererLayerArgs,
  marker: OverlayMarker,
) {
  const { coords, scale, bounds } = args;
  const x = coords.timeToX(marker.time);
  if (x < -20 || x > coords.width + 20) return;
  const yPrice = coords.priceToY(marker.price, scale, bounds);
  const size = 6;
  const offset = marker.position === "above" ? -12 : marker.position === "below" ? 12 : 0;
  const y = yPrice + offset;
  ctx.fillStyle = marker.color;
  ctx.strokeStyle = marker.color;
  ctx.beginPath();
  switch (marker.shape) {
    case "triangleUp":
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y + size);
      ctx.lineTo(x - size, y + size);
      ctx.closePath();
      ctx.fill();
      break;
    case "triangleDown":
      ctx.moveTo(x, y + size);
      ctx.lineTo(x + size, y - size);
      ctx.lineTo(x - size, y - size);
      ctx.closePath();
      ctx.fill();
      break;
    case "diamond":
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size, y);
      ctx.closePath();
      ctx.fill();
      break;
    case "flag":
      ctx.moveTo(x, y + size);
      ctx.lineTo(x, y - size);
      ctx.lineTo(x + size + 2, y - size / 2);
      ctx.lineTo(x, y);
      ctx.stroke();
      break;
    default:
      ctx.arc(x, y, size - 1, 0, Math.PI * 2);
      ctx.fill();
  }
  if (marker.label) {
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      marker.label,
      x,
      marker.position === "below" ? y + size + 11 : y - size - 4,
    );
    ctx.textAlign = "left";
  }
}

/** Register the generic overlay layer that paints every published primitive. */
export function registerOverlayLayer() {
  registerRendererLayer({
    id: "af-overlays",
    placement: "above-data",
    create: () =>
      canvasLayer((ctx, args, cell) => {
        const { coords, scale, bounds } = args;
        // Pattern markers and compare lines are drawn per candle, which footprint and TPO replace.
        const orderflow = args.priceStyle === "footprint" || args.priceStyle === "tpo";
        for (const primitive of getOverlays(cell.id)) {
          if (orderflow && (primitive.kind === "marker" || primitive.kind === "line")) continue;
          switch (primitive.kind) {
            case "line":
              paintLine(ctx, args, primitive);
              break;
            case "marker":
              paintMarker(ctx, args, primitive);
              break;
            case "hline": {
              if(primitive.orderId)break;
              const y = coords.priceToY(primitive.price, scale, bounds);
              ctx.save();
              ctx.strokeStyle = primitive.color;
              ctx.lineWidth = primitive.width ?? 1;
              ctx.setLineDash(primitive.dash ?? [6, 4]);
              ctx.beginPath();
              ctx.moveTo(0, y);
              ctx.lineTo(coords.width, y);
              ctx.stroke();
              ctx.restore();
              if (primitive.label) {
                ctx.save();
                ctx.font = "600 10.5px system-ui, -apple-system, sans-serif";
                const textWidth = ctx.measureText(primitive.label).width;
                const padX = 5;
                const boxW = textWidth + padX * 2;
                const boxH = 16;
                const boxX = Math.max(4, coords.width - boxW - 6);
                const boxY = y - boxH - 2;
                ctx.fillStyle = "rgba(8, 10, 15, 0.84)";
                ctx.beginPath();
                if (typeof ctx.roundRect === "function") {
                  ctx.roundRect(boxX, boxY, boxW, boxH, 4);
                } else {
                  ctx.rect(boxX, boxY, boxW, boxH);
                }
                ctx.fill();
                ctx.strokeStyle = primitive.color;
                ctx.lineWidth = 0.75;
                ctx.stroke();
                ctx.fillStyle = primitive.color;
                ctx.fillText(primitive.label, boxX + padX, boxY + 11.5);
                ctx.restore();
              }
              break;
            }
            case "box": {
              const x1 = coords.timeToX(primitive.time1);
              const x2 = Number.isFinite(primitive.time2) ? coords.timeToX(primitive.time2) : coords.width;
              const y1 = coords.priceToY(primitive.price1, scale, bounds);
              const y2 = coords.priceToY(primitive.price2, scale, bounds);
              const left = Math.min(x1, x2);
              const top = Math.min(y1, y2);
              const w = Math.max(4, Math.abs(x2 - x1));
              const h = Math.max(2, Math.abs(y2 - y1));
              ctx.save();
              ctx.fillStyle = primitive.fill;
              ctx.fillRect(left, top, w, h);
              ctx.strokeStyle = primitive.stroke;
              ctx.lineWidth = 1;
              ctx.strokeRect(left, top, w, h);
              if (primitive.label) {
                ctx.font = "600 10px system-ui, -apple-system, sans-serif";
                const textWidth = ctx.measureText(primitive.label).width;
                const labelX = Math.max(left + 4, Math.min(left + 4, coords.width - textWidth - 8));
                const labelY = top + 12;
                ctx.fillStyle = "rgba(8, 10, 15, 0.72)";
                ctx.fillRect(labelX - 3, top + 2, textWidth + 6, 13);
                ctx.fillStyle = primitive.stroke;
                ctx.fillText(primitive.label, labelX, labelY);
              }
              ctx.restore();
              break;
            }
            case "segment": {
              const x1 = coords.timeToX(primitive.from.time);
              const x2 = Number.isFinite(primitive.to.time) ? coords.timeToX(primitive.to.time) : coords.width;
              const y1 = coords.priceToY(primitive.from.price, scale, bounds);
              const y2 = coords.priceToY(primitive.to.price, scale, bounds);
              ctx.save();
              ctx.strokeStyle = primitive.color;
              ctx.lineWidth = primitive.width;
              ctx.setLineDash(primitive.dash ?? []);
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.stroke();
              if (primitive.label) {
                ctx.setLineDash([]);
                ctx.font = "600 10px system-ui, -apple-system, sans-serif";
                const textWidth = ctx.measureText(primitive.label).width;
                const midX = Number.isFinite(primitive.to.time) ? (x1 + x2) / 2 - textWidth / 2 : coords.width - textWidth - 8;
                const midY = (y1 + y2) / 2 - 5;
                ctx.fillStyle = "rgba(8, 10, 15, 0.8)";
                ctx.fillRect(midX - 3, midY - 10, textWidth + 6, 13);
                ctx.fillStyle = primitive.color;
                ctx.fillText(primitive.label, midX, midY);
              }
              ctx.restore();
              break;
            }
          }
        }
      }, (_args, cell) => getOverlays(cell.id).length > 0),
  });
}
