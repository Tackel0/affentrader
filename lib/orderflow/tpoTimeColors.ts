import type { TpoSession } from "./tpoModel";
import type { TpoPreferences } from "./tpoSettings";
import type { TpoMetricValue, TpoSessionMetrics } from "./tpoMetrics";

export const TPO_DELTA_THEMES = { classic: ["#089981", "#f23645"], neon: ["#00e676", "#ff1744"], arctic: ["#2962ff", "#ff9800"], orchid: ["#26c6da", "#e91e63"] } as const;
export type TpoDeltaTheme = keyof typeof TPO_DELTA_THEMES | "custom";
export const validTpoDeltaTheme = (v: unknown): v is TpoDeltaTheme => typeof v === "string" && (v === "custom" || Object.hasOwn(TPO_DELTA_THEMES, v));

export const TPO_TIME_THEMES = {
  simple: ["#4a505e", "#6b7385", "#3d6fd4", "#1e4fd6"],
  thermal: ["#2962ff", "#26c6da", "#ffb300", "#f23645"],
  spectrum: ["#440154", "#31688e", "#35b779", "#fde725"],
  ocean: ["#1e3a5f", "#2962ff", "#00acc1", "#80deea"],
  ember: ["#6a1b9a", "#e91e63", "#ff7043", "#ffd54f"],
} as const;
export type TpoTimeTheme = keyof typeof TPO_TIME_THEMES | "custom";
export const validTpoTimeTheme = (v: unknown): v is TpoTimeTheme => typeof v === "string" && (v === "custom" || Object.hasOwn(TPO_TIME_THEMES, v));
type Rgba = [number, number, number, number];
const clamp = (v: number, max = 1) => Math.max(0, Math.min(max, v));
/** CSS formats accepted by the saved chart preferences, including alpha. */
export function tpoColorRgba(color: string): Rgba {
  if (color === "transparent") return [0, 0, 0, 0];
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length <= 4) hex = [...hex].map(c => c + c).join("");
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1];
  }
  const match = /^(rgba?|hsla?)\(([^)]+)\)$/i.exec(color);
  if (!match) return [0, 0, 0, 1];
  const parts = match[2].trim().split(/[\s,]+/), values = parts.map(parseFloat);
  const alpha = parts[3] === undefined ? 1 : clamp(values[3] / (parts[3].endsWith("%") ? 100 : 1));
  if (match[1].toLowerCase().startsWith("rgb")) return [...values.slice(0, 3).map((v, i) => clamp(v * (parts[i].endsWith("%") ? 255 / 100 : 1), 255)), alpha] as Rgba;
  const hue = ((values[0] % 360) + 360) % 360 / 60, saturation = clamp(values[1] / 100), light = clamp(values[2] / 100);
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = light - chroma / 2;
  const channels = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return [...channels.map(v => (v + m) * 255), alpha] as Rgba;
}
/** Fixed session positions, never normalized against the currently revealed
 * bars. Replay and late history therefore cannot recolor earlier letters. */
export function tpoTimePalette(session: TpoSession, style: TpoPreferences) {
  const name = style.metricTheme ?? "simple";
  const stops = (name === "custom" ? [style.metricColor1 ?? "#4a505e", style.metricColor2 ?? "#6b7385", style.metricColor3 ?? "#3d6fd4", style.metricColor4 ?? "#1e4fd6"] : TPO_TIME_THEMES[name]).map(tpoColorRgba);
  const count = session.periodSpans?.reduce((n, span) => n + span.count, 0) ?? Math.ceil((session.end - session.start) / (Number(style.blockMinutes) * 60000));
  const colors = Array.from({ length: Math.max(1, count) }, (_, period) => {
    const position = 3 * clamp(period / Math.max(1, count - 1)), index = Math.min(2, Math.floor(position)), weight = position - index;
    const a = stops[index], b = stops[index + 1], c = a.map((v, i) => v + (b[i] - v) * weight);
    return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Number(c[3].toFixed(6))})`;
  });
  return { colors, alpha: (inArea: boolean) => .9 * (inArea || !style.valueAreaVisible ? 1 : (style.outsideVaOpacity ?? 45) / 100) };
}

/** Reference metric bins are quartiles of the largest row total in a profile;
 * delta uses side color and four alpha strengths, not a signed price gradient. */
export function tpoMetricInk(style: TpoPreferences, metrics: TpoSessionMetrics | undefined, row: TpoMetricValue | undefined, inArea: boolean) {
  const mode = style.colorBy ?? "Time";
  if (mode === "Time" || !metrics || !row || mode === "Trades count" && !metrics.countsKnown) return;
  const dim = inArea || !style.valueAreaVisible ? 1 : (style.outsideVaOpacity ?? 45) / 100;
  const value = mode === "Volume" ? row.buy + row.sell : mode === "Trades count" ? row.count! : Math.abs(row.buy - row.sell);
  const maximum = mode === "Volume" ? metrics.maximum.volume : mode === "Trades count" ? metrics.maximum.trades : metrics.maximum.delta;
  const bin = Math.max(0, Math.min(3, Math.floor(4 * (maximum > 0 ? value / maximum : 0))));
  if (mode === "Delta") {
    const theme = style.deltaTheme ?? "classic", colors = theme === "custom" ? [style.deltaUpColor ?? "#089981", style.deltaDownColor ?? "#f23645"] : TPO_DELTA_THEMES[theme];
    return { color: colors[row.buy - row.sell >= 0 ? 0 : 1], alpha: [.35, .55, .75, .95][bin] * dim };
  }
  const theme = style.metricTheme ?? "simple", colors = theme === "custom" ? [style.metricColor1 ?? "#4a505e", style.metricColor2 ?? "#6b7385", style.metricColor3 ?? "#3d6fd4", style.metricColor4 ?? "#1e4fd6"] : TPO_TIME_THEMES[theme];
  return { color: colors[bin], alpha: dim };
}
