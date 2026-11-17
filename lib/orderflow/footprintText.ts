import type { FootprintLevel, FootprintVolumeMode } from "@/types/trading";
import type { ResolvedFootprintPreferences } from "./footprint";
import { footprintCellText, footprintSizes, type FootprintCellValues } from "./footprintCells";
import { footprintSideCount } from "./footprintCounts";

export interface FootprintTextSlot { left: number; right: number; axis: number }
interface Token { text: string; left: number; right: number; align: "left" | "right"; side: "buy" | "sell" | null }
export const footprintValueKind = (mode: FootprintVolumeMode, value: FootprintCellValues) => value !== "auto" ? value : mode === "bid-ask" || mode === "bid-ask-ladder" ? "bid-ask" : mode === "absolute-delta" ? "delta" : mode;
export { footprintNumber } from "./footprintFormat";
const flag = (row: FootprintLevel, side: "buy" | "sell") => (side === "buy" ? row.buyImbalance : row.sellImbalance) ?? row.imbalance === side;
function tokens(row: FootprintLevel, mode: FootprintVolumeMode, value: FootprintCellValues, slot: FootprintTextSlot, align: "left" | "right"): Token[] {
  const text = footprintCellText(row, value, mode), kind = footprintValueKind(mode, value);
  if (text.center !== undefined) return [{ text: text.center, left: slot.left, right: slot.right, align, side: flag(row, "buy") ? "buy" : flag(row, "sell") ? "sell" : null }];
  const result: Token[] = [];
  const sell = kind === "bid-ask-trades" ? footprintSideCount(row, "sell") : row.sellVolume;
  const buy = kind === "bid-ask-trades" ? footprintSideCount(row, "buy") : row.buyVolume;
  // Missing count coverage remains a dash; a genuinely observed zero is blank.
  if (sell === null || sell > 0) result.push({ text: text.left!, left: slot.left, right: slot.axis, align: "right", side: flag(row, "sell") ? "sell" : null });
  if (buy === null || buy > 0) result.push({ text: text.right!, left: slot.axis, right: slot.right, align: "left", side: flag(row, "buy") ? "buy" : null });
  return result;
}
export const footprintTextTokens = tokens;
function sizeFor(style: ResolvedFootprintPreferences, height: number, width: number): number | null {
  if (!style.textAutoSize) return height >= style.textSize ? style.textSize : null;
  const size = Math.min(12, Math.floor(height - 3), Math.floor(.8 * width));
  return size >= 7 ? size : null;
}
/** Auto/no-fit uses a single measured size across every visible bar of one
 * instance. Zero suppresses all labels; null leaves sizing to each row. */
export function planFootprintText(ctx: CanvasRenderingContext2D, style: ResolvedFootprintPreferences, rows: readonly FootprintLevel[], slot: FootprintTextSlot, rowHeight: (row: FootprintLevel) => number, family: string): number | null {
  if (!style.textAutoSize || style.textFit || typeof ctx.measureText !== "function") return null;
  let height = Infinity;
  for (const row of rows) if (!row.filtered) height = Math.min(height, rowHeight(row));
  if (!Number.isFinite(height) || height < 14) return null;
  const kind = footprintValueKind(style.volumeMode, style.cellValues), sides = kind === "bid-ask" || kind === "bid-ask-trades";
  const base = sizeFor(style, height, sides ? Math.min(slot.axis - slot.left, slot.right - slot.axis) : slot.right - slot.left);
  if (base === null) return null;
  ctx.font = `${base}px ${family}`; let selected = base;
  const measured = new Map<string, number>();
  for (const row of rows) {
    if (row.filtered) continue;
    const half = kind === "delta" && style.volumeMode === "delta", negative = row.buyVolume - row.sellVolume < 0;
    const area = { ...slot, left: half && !negative ? slot.axis : slot.left, right: half && negative ? slot.axis : slot.right };
    for (const token of tokens(row, style.volumeMode, style.cellValues, area, "left")) {
      const available = token.right - token.left - 6; if (available <= 0) return 0;
      let width = measured.get(token.text); if (width === undefined) { width = ctx.measureText(token.text).width; measured.set(token.text, width); }
      if (width > available) selected = Math.min(selected, Math.floor(base * available / width));
    }
  }
  return selected >= 7 ? selected : 0;
}
function plottedSlot(row: FootprintLevel, style: ResolvedFootprintPreferences, maximum: number, slot: FootprintTextSlot): FootprintTextSlot {
  const sizes = footprintSizes(row, style.averageTradeSize), buy = sizes.buy ?? 0, sell = sizes.sell ?? 0;
  if (!(maximum > 0)) return { ...slot, right: slot.left };
  if (style.volumeMode === "total") return { ...slot, right: slot.left + (buy + sell) / maximum * (slot.right - slot.left) };
  if (style.volumeMode === "absolute-delta") return { ...slot, right: slot.left + Math.abs(buy - sell) / maximum * (slot.right - slot.left) };
  if (style.volumeMode === "delta") return buy >= sell ? { ...slot, left: slot.axis, right: slot.axis + (buy - sell) / maximum * (slot.right - slot.axis) }
    : { ...slot, left: slot.axis - (sell - buy) / maximum * (slot.axis - slot.left), right: slot.axis };
  return { ...slot, left: slot.axis - sell / maximum * (slot.axis - slot.left), right: slot.axis + buy / maximum * (slot.right - slot.axis) };
}
/** No maxWidth argument: do not horizontally distort glyphs to fake a fit. */
export function paintFootprintText(ctx: CanvasRenderingContext2D, row: FootprintLevel, style: ResolvedFootprintPreferences, slot: FootprintTextSlot, height: number, y: number, maximum: number, family: string, color: string, opacity: number, planned: number | null, override?: number): void {
  if (opacity < .6 || slot.right - slot.left < 22 || height < 14 || planned === 0 || !(maximum > 0)) return;
  const own = override === undefined ? style : { ...style, textAutoSize: false, textSize: override };
  const mode = own.volumeMode, kind = footprintValueKind(mode, own.cellValues), sides = kind === "bid-ask" || kind === "bid-ask-trades";
  const sizes = footprintSizes(row, own.averageTradeSize), delta = (sizes.buy ?? 0) - (sizes.sell ?? 0);
  let area = slot, align: "left" | "right" = "left";
  if (mode !== "bid-ask-ladder") {
    if (own.textFit) area = plottedSlot(row, own, maximum, slot);
    if (mode === "delta" && kind === "delta") {
      align = delta >= 0 ? "left" : "right";
      if (!own.textFit) area = delta >= 0 ? { ...slot, left: slot.axis } : { ...slot, right: slot.axis };
    }
  }
  const base = mode !== "bid-ask-ladder" && own.textFit ? Math.min(own.textAutoSize ? 12 : own.textSize, Math.floor(height - 2))
    : planned ?? sizeFor(own, height, sides ? Math.min(area.axis - area.left, area.right - area.axis) : area.right - area.left);
  if (base === null || base < 5) return;
  const keepMin = override !== undefined && mode !== "bid-ask-ladder" && own.textFit ? Math.max(7, Math.round(.6 * base)) : undefined;
  const plannedSize = planned !== null;
  const draw = (token: Token, size: number, fit: boolean) => {
    let actual = size; ctx.font = `${actual}px ${family}`;
    if (typeof ctx.measureText === "function" && !plannedSize) {
      const available = token.right - token.left - 6, minimum = Math.min(size, keepMin ?? 5);
      if (fit) while (actual > minimum && ctx.measureText(token.text).width > available) { actual--; ctx.font = `${actual}px ${family}`; }
      if (ctx.measureText(token.text).width > available) return false;
    }
    ctx.fillStyle = own.imbalanceRecolor && token.side === "buy" ? own.imbalanceTextAskColor : own.imbalanceRecolor && token.side === "sell" ? own.imbalanceTextBidColor : color;
    ctx.textAlign = token.align; ctx.fillText(token.text, token.align === "left" ? token.left + 3 : token.right - 3, y); return true;
  };
  const selected = tokens(row, mode, own.cellValues, area, align);
  const fallback = keepMin === undefined ? undefined : tokens(row, mode, own.cellValues, mode === "delta" && kind === "delta" ? delta >= 0 ? { ...slot, left: slot.axis } : { ...slot, right: slot.axis } : slot, align);
  selected.forEach((token, i) => { if (!draw(token, base, own.textFit) && fallback?.[i]) draw(fallback[i], Math.min(base, keepMin!), false); });
}
