import type { ChartConfig, ChartTypeSettingsSection, RendererLayerArgs } from "@luxalgo/vela";
import type { OHLCV } from "@/types/trading";
import { validChartColor } from "./appearance";
import { visibleSlice } from "./canvasLayer";

export type CandleLayerId = "hollow" | "volumecandles";
export type CandlePaint = ChartConfig["candles"];
export interface PluginCandlePreferences {
  hollow: CandlePaint;
  volumecandles: CandlePaint & { colorBasedOnPreviousClose: boolean };
}
const paint = (): CandlePaint => ({ upColor: "#089981", downColor: "#f23645", bodyVisible: true, borderVisible: false,
  borderUpColor: "#089981", borderDownColor: "#f23645", wickVisible: true, wickUpColor: "#089981", wickDownColor: "#f23645" });
export const defaultPluginCandles = (): PluginCandlePreferences => ({ hollow: paint(), volumecandles: { ...paint(), colorBasedOnPreviousClose: false } });
const colors = ["upColor", "downColor", "borderUpColor", "borderDownColor", "wickUpColor", "wickDownColor"] as const;
const booleans = ["bodyVisible", "borderVisible", "wickVisible"] as const;
type Bag = Record<string, unknown>;
const bag = (value: unknown): value is Bag => !!value && typeof value === "object" && !Array.isArray(value);
export function validPluginCandles(value: unknown): value is PluginCandlePreferences {
  if (!bag(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, "hollow") || !Object.hasOwn(value, "volumecandles")) return false;
  return (["hollow", "volumecandles"] as const).every(id => {
    const style = value[id];
    return bag(style) && Object.keys(style).length === (id === "hollow" ? 9 : 10) && colors.every(key => validChartColor(style[key])) &&
      booleans.every(key => typeof style[key] === "boolean") && (id !== "volumecandles" || typeof style.colorBasedOnPreviousClose === "boolean");
  });
}
/** SDK bags may contain only edited keys; defaults and false booleans resolve without mutating the renderer. */
export function resolvePluginCandle(id: CandleLayerId, value: unknown): PluginCandlePreferences["volumecandles"] {
  const defaults = { ...defaultPluginCandles()[id], colorBasedOnPreviousClose: false }, source = bag(value) ? value : {};
  for (const key of colors) if (validChartColor(source[key])) defaults[key] = source[key];
  for (const key of booleans) if (typeof source[key] === "boolean") defaults[key] = source[key];
  if (id === "volumecandles" && typeof source.colorBasedOnPreviousClose === "boolean") defaults.colorBasedOnPreviousClose = source.colorBasedOnPreviousClose;
  return defaults;
}
export function readPluginCandles(value: unknown): PluginCandlePreferences {
  const source = bag(value) ? value : {}, { colorBasedOnPreviousClose: _unused, ...hollow } = resolvePluginCandle("hollow", source.hollow);
  return { hollow, volumecandles: resolvePluginCandle("volumecandles", source.volumecandles) };
}
export function candleLayerSettings(id: CandleLayerId): ChartTypeSettingsSection {
  const defaults = defaultPluginCandles()[id];
  return { title: id === "hollow" ? "Hollow candles" : "Volume candles", placement: "after-symbol", visibility: "active", rows: [
    ...(id === "volumecandles" ? [{ kind: "toggle" as const, key: "colorBasedOnPreviousClose", label: "Color based on previous close", defval: false }] : []),
    { kind: "toggle", key: "bodyVisible", label: "Body", defval: defaults.bodyVisible,
      colors: [{ key: "upColor", label: "Bullish body", defval: defaults.upColor }, { key: "downColor", label: "Bearish body", defval: defaults.downColor }] },
    { kind: "toggle", key: "borderVisible", label: "Borders", defval: defaults.borderVisible,
      colors: [{ key: "borderUpColor", label: "Bullish border", defval: defaults.borderUpColor }, { key: "borderDownColor", label: "Bearish border", defval: defaults.borderDownColor }] },
    { kind: "toggle", key: "wickVisible", label: "Wick", defval: defaults.wickVisible,
      colors: [{ key: "wickUpColor", label: "Bullish wick", defval: defaults.wickUpColor }, { key: "wickDownColor", label: "Bearish wick", defval: defaults.wickDownColor }] },
  ] };
}
export function candleClassification(bar: OHLCV, previous: OHLCV | undefined, id: CandleLayerId, previousClose: boolean) {
  const reference = id === "hollow" || previousClose ? previous?.close ?? bar.open : bar.open;
  return { up: bar.close >= reference, hollow: id === "hollow" && bar.close > bar.open };
}
export function paintPluginCandle(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, id: CandleLayerId, bar: OHLCV, previous: OHLCV | undefined, maxVolume: number, resolved?: PluginCandlePreferences["volumecandles"]) {
  const style = resolved ?? resolvePluginCandle(id, args.settings), { up, hollow } = candleClassification(bar, previous, id, style.colorBasedOnPreviousClose);
  const { coords, scale, bounds } = args, x = coords.timeToX(bar.time), open = coords.priceToY(bar.open, scale, bounds), close = coords.priceToY(bar.close, scale, bounds);
  const base = Math.max(1, coords.bodySpacing() * 0.78), full = Math.max(base, coords.pxPerBar() * 0.95);
  const volume = Number.isFinite(bar.volume) ? Math.max(0, bar.volume) : 0;
  const width = id === "volumecandles" ? Math.max(1.5, full * (0.2 + 0.8 * Math.min(1, volume / Math.max(maxVolume, 1e-12)))) : base;
  ctx.lineWidth = 1;
  if (style.wickVisible) {
    ctx.strokeStyle = up ? style.wickUpColor : style.wickDownColor;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, coords.priceToY(bar.high, scale, bounds));
    ctx.lineTo(Math.round(x) + 0.5, coords.priceToY(bar.low, scale, bounds)); ctx.stroke();
  }
  const top = Math.min(open, close), height = Math.max(1, Math.abs(open - close));
  const outline = () => ctx.strokeRect(x - width / 2 + 0.5, top + 0.5, Math.max(0.5, width - 1), Math.max(0, height - 1));
  if (style.bodyVisible) {
    ctx.fillStyle = up ? style.upColor : style.downColor; ctx.strokeStyle = ctx.fillStyle;
    if (hollow) outline(); else ctx.fillRect(x - width / 2, top, width, height);
  }
  if (style.borderVisible) { ctx.strokeStyle = up ? style.borderUpColor : style.borderDownColor; outline(); }
}
export function paintPluginCandles(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, id: CandleLayerId) {
  const range = args.coords.visibleTimeRange(), [from, to] = visibleSlice(args.bars, range.from, range.to), bars = args.bars.slice(from, to);
  if (!bars.length) return;
  const style = resolvePluginCandle(id, args.settings);
  const maxVolume = Math.max(...bars.map(bar => typeof bar.volume === "number" && Number.isFinite(bar.volume) ? Math.max(0, bar.volume) : 0), 1e-12);
  bars.forEach((bar, index) => paintPluginCandle(ctx, args, id, bar as OHLCV, args.bars[from + index - 1] as OHLCV | undefined, maxVolume, style));
}
