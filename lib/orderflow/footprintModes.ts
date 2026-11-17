import type { FootprintVolumeMode } from "@/types/trading";
import type { ResolvedFootprintPreferences } from "./footprint";
import { tpoColorRgba } from "./tpoTimeColors";
export const FOOTPRINT_MODES: readonly FootprintVolumeMode[] = ["bid-ask", "bid-ask-ladder", "total", "delta", "absolute-delta"];
export const FOOTPRINT_MODE_OPTIONS: Array<[FootprintVolumeMode, string]> = [["bid-ask", "Bid × Ask Profile"], ["bid-ask-ladder", "Bid × Ask Ladder"], ["total", "Volume Profile"], ["delta", "Delta Profile"], ["absolute-delta", "Absolute Delta"]];
export const footprintModeTitle = (mode: FootprintVolumeMode) => FOOTPRINT_MODE_OPTIONS.find(option => option[0] === mode)?.[1] ?? "Bid × Ask Profile";
export interface FootprintModeRect { x: number; width: number; color: string; alpha: number }
const css = (rgba: readonly number[]) => `rgba(${Math.round(rgba[0])},${Math.round(rgba[1])},${Math.round(rgba[2])},${rgba[3]})`;
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const light = (background: string) => { const [r, g, b] = tpoColorRgba(background); return .2126 * r + .7152 * g + .0722 * b >= 128; };
/** Intensity follows the observed maximum. Light themes tint toward white,
 * dark themes toward black; configured color alpha is preserved. */
export function footprintIntensity(color: string, ratio: number, gradient: boolean, background: string) {
  if (!gradient) return color;
  const [r, g, b, a] = tpoColorRgba(color), factor = .35 + .65 * clamp(ratio), isLight = light(background);
  return css([...[r, g, b].map(c => isLight ? 255 - (255 - c) * factor : c * factor), a]);
}
export function footprintModeRects(mode: FootprintVolumeMode, buy: number, sell: number, maximum: number, center: number, half: number,
  style: ResolvedFootprintPreferences, background: string): FootprintModeRect[] {
  if (!(maximum > 0) || !style.histogramVisible) return [];
  const left = center - half, width = half * 2, result: FootprintModeRect[] = [];
  const rect = (x: number, size: number, color: string) => { if (size > 0) result.push({ x, width: size, color, alpha: .62 }); };
  if (mode === "bid-ask-ladder" || mode === "bid-ask") {
    if (sell > 0) rect(mode === "bid-ask" ? center - half * sell / maximum : left, mode === "bid-ask" ? half * sell / maximum : half, footprintIntensity(style.bidColor, sell / maximum, style.gradientCells, background));
    if (buy > 0) rect(center, mode === "bid-ask" ? half * buy / maximum : half, footprintIntensity(style.askColor, buy / maximum, style.gradientCells, background));
  } else if (mode === "absolute-delta" || mode === "delta") {
    const delta = buy - sell, ratio = Math.abs(delta) / maximum;
    if (delta !== 0) rect(mode === "absolute-delta" ? left : delta < 0 ? center - half * ratio : center, (mode === "absolute-delta" ? width : half) * ratio, footprintIntensity(delta > 0 ? style.deltaUpColor : style.deltaDownColor, ratio, style.gradientCells, background));
  } else if (mode === "total") {
    const total = buy + sell, ratio = total / maximum, size = width * ratio;
    if (!(total > 0)) return [];
    if (style.volumeSplit) {
      const bid = size * sell / total;
      rect(left, bid, footprintIntensity(style.volumeSellColor, ratio, style.gradientCells, background));
      rect(left + bid, size - bid, footprintIntensity(style.volumeBuyColor, ratio, style.gradientCells, background));
    } else {
      const low = light(background) && style.monoLowColor === "#3a3d45" ? "#d6dae2" : style.monoLowColor;
      const high = light(background) && style.monoHighColor === "#a3a9b5" ? "#4a4e59" : style.monoHighColor;
      // The reference's mono ramp always interpolates by row volume; its
      // gradient switch applies to the side-colored modes, not this ramp.
      const a = tpoColorRgba(low), b = tpoColorRgba(high), weight = clamp(ratio);
      rect(left, size, css(a.map((v, i) => v + (b[i] - v) * weight)));
    }
  }
  return result;
}
