import type { InputSchema, RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import { validChartColor } from "@/lib/chart/appearance";
import { executionPriceGrid } from "./priceGrid";

export interface BubbleSettings {
  mode: "Total" | "Delta"; rows: "Auto" | "Manual"; ticksPerRow: number; tickSize: number;
  volumeMin: number; volumeMax: number; hideBelow: number; minDelta: number; maxVisible: number;
  minRadius: number; maxRadius: number; opacity: number; gradient: boolean; tooltip: boolean;
  colorBySide: boolean; highlightLargest: boolean; highlightPercent: number; labels: boolean;
  buyColor: string; sellColor: string; neutralColor: string; ringColor: string;
}
export const defaultBubbles = (): BubbleSettings => ({ mode: "Total", rows: "Auto", ticksPerRow: 8, tickSize: 0,
  volumeMin: 0, volumeMax: 0, hideBelow: 50, minDelta: 0, maxVisible: 500,
  minRadius: 5, maxRadius: 25, opacity: 70, gradient: true, tooltip: true, colorBySide: true,
  highlightLargest: true, highlightPercent: 80, labels: false,
  buyColor: "#089981", sellColor: "#f23645", neutralColor: "#787b86", ringColor: "#ffcc80" });
const numbers = { ticksPerRow: [1, 100000], tickSize: [0, 1e12], volumeMin: [0, 1e20], volumeMax: [0, 1e20],
  hideBelow: [0, 100], minDelta: [0, 100], maxVisible: [1, 500], minRadius: [1, 50], maxRadius: [1, 100],
  opacity: [1, 100], highlightPercent: [0, 100] } as const;
const flags = ["gradient", "tooltip", "colorBySide", "highlightLargest", "labels"] as const;
const colors = ["buyColor", "sellColor", "neutralColor", "ringColor"] as const;
export function resolveBubbles(values: Record<string, unknown>): BubbleSettings {
  const result = defaultBubbles();
  for (const key of Object.keys(numbers) as Array<keyof typeof numbers>) {
    const value = values[key]; if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < numbers[key][0] || value > numbers[key][1]
      || ["ticksPerRow", "maxVisible"].includes(key) && !Number.isInteger(value)) throw new Error(`Invalid bubble ${key}.`);
    result[key] = value;
  }
  for (const key of flags) if (values[key] !== undefined) {
    if (typeof values[key] !== "boolean") throw new Error(`Invalid bubble ${key}.`);
    result[key] = values[key];
  }
  for (const key of colors) if (values[key] !== undefined) {
    if (!validChartColor(values[key])) throw new Error(`Invalid bubble ${key}.`);
    result[key] = values[key];
  }
  for (const key of ["mode", "rows"] as const) if (values[key] !== undefined) {
    const choices = key === "mode" ? ["Total", "Delta"] : ["Auto", "Manual"];
    if (typeof values[key] !== "string" || !choices.includes(values[key])) throw new Error(`Invalid bubble ${key}.`);
    Object.assign(result, { [key]: values[key] });
  }
  if (result.minRadius > result.maxRadius || result.volumeMax > 0 && result.volumeMax < result.volumeMin)
    throw new Error("Bubble minimum must not exceed its maximum.");
  return result;
}
export function bubbleInputs(): InputSchema[] {
  const defaults = defaultBubbles();
  const labels: Record<keyof BubbleSettings, string> = {
    mode: "Mode", rows: "Rows", ticksPerRow: "Ticks per row", tickSize: "Price tick override (0 = market)",
    volumeMin: "Volume Min (0 = off)", volumeMax: "Volume Max (0 = off)", hideBelow: "Hide below (%)",
    minDelta: "Min delta (%)", maxVisible: "Max visible", minRadius: "Minimum radius (px)", maxRadius: "Maximum radius (px)",
    opacity: "Opacity (%)", gradient: "Gradient", tooltip: "Hover tooltip", colorBySide: "Color by dominant side",
    highlightLargest: "Highlight largest", highlightPercent: "Highlight at or above (%)", labels: "Volume labels",
    buyColor: "Buy", sellColor: "Sell", neutralColor: "Neutral", ringColor: "Highlight ring",
  };
  return (Object.keys(defaults) as Array<keyof BubbleSettings>).map(key => ({ key, title: labels[key], defval: defaults[key],
    type: colors.includes(key as typeof colors[number]) ? "color" : typeof defaults[key] === "boolean" ? "bool" : typeof defaults[key] === "number" ? "float" : "string",
    ...(["ticksPerRow", "maxVisible"].includes(key) ? { type: "int" as const } : {}),
    ...(Object.hasOwn(numbers, key) ? { min: numbers[key as keyof typeof numbers][0], max: numbers[key as keyof typeof numbers][1] } : {}),
    ...(key === "mode" ? { options: ["Total", "Delta"] } : key === "rows" ? { options: ["Auto", "Manual"] } : {}),
    group: ["volumeMin", "volumeMax", "hideBelow", "minDelta", "maxVisible"].includes(key) ? "Filters" : "Display",
  }));
}
export function bubbleStep(args: RendererLayerArgs, style: BubbleSettings, marketTick?: number): number {
  const base = style.tickSize || marketTick;
  if (!(base && base > 0 && Number.isFinite(base))) throw new Error("Market price precision is unavailable. Set a price tick override or wait for venue metadata.");
  if (style.rows === "Manual") {
    const step = executionPriceGrid(base).row(style.ticksPerRow).lower;
    executionPriceGrid(step); return step;
  }
  const price = args.bars.at(-1)?.close;
  if (!(price && price > 0)) throw new Error("Waiting for a price range.");
  const rows = Math.max(4, Math.floor(args.bounds.height / 18));
  return executionPriceGrid(base).row(Math.max(1, Math.ceil((args.scale.max - args.scale.min) / base / rows))).lower;
}
export interface VolumeBubble {
  time: number; lower: number; upper: number; buy: number; sell: number; volume: number; deltaPercent: number;
  radius: number; alpha: number; highlight: boolean;
}
/** Relative filters and sizing use the unfiltered visible maximum, then top-N.
 * Absent execution rows remain absent; candle volume never manufactures clusters. */
export function volumeBubbles(bars: readonly FootprintBar[], from: number, to: number, style: BubbleSettings,
  priceMin = -Infinity, priceMax = Infinity): VolumeBubble[] {
  const candidates: Array<Omit<VolumeBubble, "radius" | "alpha" | "highlight">> = [];
  let max = 0;
  for (const bar of bars) if (bar.time >= from && bar.time <= to) for (const level of bar.levels) {
    const volume = level.buyVolume + level.sellVolume, upper = level.upperPrice;
    if (!Number.isFinite(volume) || volume <= 0 || upper === undefined || upper < priceMin || level.price > priceMax) continue;
    max = Math.max(max, volume);
    candidates.push({ time: bar.time, lower: level.price, upper, buy: level.buyVolume, sell: level.sellVolume, volume,
      deltaPercent: (level.buyVolume - level.sellVolume) / volume * 100 });
  }
  return candidates.filter(b => b.volume >= style.volumeMin && (!style.volumeMax || b.volume <= style.volumeMax)
    && b.volume / max * 100 >= style.hideBelow && Math.abs(b.deltaPercent) >= style.minDelta)
    .sort((a, b) => b.volume - a.volume || a.time - b.time || a.lower - b.lower).slice(0, style.maxVisible)
    .map(b => { const ratio = b.volume / max; return { ...b,
      radius: style.minRadius + (style.maxRadius - style.minRadius) * Math.sqrt(ratio),
      alpha: style.opacity / 100 * (style.gradient ? Math.max(.1, ratio) : 1),
      highlight: style.highlightLargest && ratio * 100 >= style.highlightPercent }; });
}
