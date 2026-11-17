import type { RendererLayerArgs } from "@luxalgo/vela";
import type { TpoSession } from "./tpoModel";
import type { TpoPreferences } from "./tpoSettings";
import { canonicalDecimal } from "./priceGrid";
import { tpoColorRgba } from "./tpoTimeColors";
/** Compact canvas text only; model prices and data-window precision stay intact. */
export const tpoPriceText = (price: number) => price.toLocaleString("en-US", { maximumSignificantDigits: 8, useGrouping: false });
/** Native reference tags use row decimals (one extra half-step for POC), up to
 * eight decimals. Financial values in models/readouts retain their precision. */
export function tpoTagPriceText(price: number, step: number) {
  return price.toFixed(Math.min(8, Math.max(0, -canonicalDecimal(step).exponent)));
}
export function layoutTpoPriceTags<T extends { y: number }>(labels: readonly T[], top: number, height: number, gap: number): T[] {
  const result: T[] = [];
  for (const label of labels) if (Number.isFinite(label.y) && label.y >= top && label.y <= top + height && !result.some(kept => Math.abs(kept.y - label.y) < gap)) result.push(label);
  return result;
}
export function layoutTpoPriceLabels(labels: { text: string; y: number }[], top: number, height: number) {
  const gap = 13, first = top + 7, last = top + height - 7;
  const placed = labels.filter(l => l.y >= top && l.y <= top + height).sort((a, b) => a.y - b.y)
    .slice(0, Math.max(0, Math.floor((last - first) / gap) + 1)).map(l => ({ ...l, textY: Math.max(first, Math.min(last, l.y)) }));
  for (let i = 1; i < placed.length; i++) placed[i].textY = Math.max(placed[i].textY, placed[i - 1].textY + gap);
  if (placed.length && placed.at(-1)!.textY > last) {
    placed.at(-1)!.textY = last;
    for (let i = placed.length - 2; i >= 0; i--) placed[i].textY = Math.min(placed[i].textY, placed[i + 1].textY - gap);
  }
  return placed;
}
export function paintTpoMarkers(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, session: TpoSession, style: TpoPreferences, left: number, end: number) {
  if (!style.openMarkerVisible && !style.closeMarkerVisible && !style.midpointVisible && !style.pocLabelVisible && !style.vahLabelVisible && !style.valLabelVisible) return;
  const { coords, bounds, scale } = args, markers = session.markers;
  ctx.save(); try {
    if (markers) {
      if (style.midpointVisible) {
        const y = coords.priceToY(markers.midpoint, scale, bounds);
        if (y >= bounds.top && y <= bounds.top + bounds.height) {
          ctx.strokeStyle = style.midpointColor ?? "#ff9800"; ctx.lineWidth = 1; ctx.setLineDash?.([2, 3]);
          ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(end, y); ctx.stroke(); ctx.setLineDash?.([]);
        }
      }
      for (const [point, enabled, color, direction] of [[markers.open, style.openMarkerVisible, style.openMarkerColor ?? "#26a69a", 1],
        [markers.close, style.closeMarkerVisible, style.closeMarkerColor ?? "#ef5350", -1]] as const) {
        if (!enabled || point.price === null || point.time === null) continue;
        const x = coords.timeToX(point.time), y = coords.priceToY(point.price, scale, bounds);
        if (x < 0 || x > coords.width || y < bounds.top || y > bounds.top + bounds.height) continue;
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - direction * 6, y - 4); ctx.lineTo(x - direction * 6, y + 4); ctx.fill();
      }
    }
    const fontSize = Math.min(10, Math.round((end - left) / 20));
    if (fontSize < 6) return;
    const rows = session.rows, area = session.valueArea;
    const labels = [["POC", style.pocLabelVisible && style.pocVisible, rows[area.poc].grid?.center ?? rows[area.poc].price + session.step / 2, style.pocColor, session.step / 2 || session.step],
      ["VAH", style.vahLabelVisible && style.valueAreaVisible, rows[area.high].grid?.upper ?? rows[area.high].price + session.step, style.valueAreaColor, session.step],
      ["VAL", style.valLabelVisible && style.valueAreaVisible, rows[area.low].price, style.valueAreaColor, session.step]] as const;
    ctx.globalAlpha = 1; ctx.font = `${fontSize}px ${args.theme.fontFamily ?? "ui-monospace, monospace"}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const padding = Math.max(2, Math.round(fontSize * .4)), height = fontSize + 4;
    for (const label of layoutTpoPriceTags(labels.filter(l => l[1]).map(([name, , price, color, step]) => ({ text: `${name} ${tpoTagPriceText(price, step)}`, color, y: coords.priceToY(price, scale, bounds) })), bounds.top, bounds.height, height)) {
      const width = (ctx.measureText?.(label.text).width ?? label.text.length * fontSize * .6) + padding * 2, x = left - width - 2;
      const [red, green, blue] = tpoColorRgba(label.color);
      ctx.fillStyle = `rgba(${red},${green},${blue},0.95)`;
      if (typeof ctx.roundRect === "function") { ctx.beginPath(); ctx.roundRect(x, label.y - height / 2, width, height, 3); ctx.fill(); }
      else ctx.fillRect(x, label.y - height / 2, width, height);
      ctx.fillStyle = red * .2126 + green * .7152 + blue * .0722 > 140 ? "#131722" : "#ffffff";
      ctx.fillText(label.text, x + padding, label.y);
    }
  } finally { ctx.restore(); }
}
