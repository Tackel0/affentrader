import type { ChartConfig } from "@luxalgo/vela";
import { validChartColor } from "./appearance";
import { readPluginCandles, validPluginCandles, type PluginCandlePreferences } from "./candleLayers";
import { resolveFootprintChart, validFootprint, type FootprintPreferences } from "@/lib/orderflow/footprint";
import { resolveTpo, validTpo, type TpoPreferences } from "@/lib/orderflow/tpoSettings";

export interface SeriesPreferences extends Pick<ChartConfig, "candles" | "bars" | "line" | "area" | "baseline" | "animations"> {
  spacing: number;
  animateLastPrice: boolean;
  pluginCandles?: PluginCandlePreferences;
  footprint?: FootprintPreferences;
  tpo?: TpoPreferences;
}
type Bag = Record<string, unknown>;
const bag = (value: unknown): value is Bag => !!value && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const fields = (value: unknown, colors: string[], numbers: Record<string, [number, number]> = {}, booleans: string[] = []): boolean => {
  if (!bag(value)) return false;
  const names = [...colors, ...Object.keys(numbers), ...booleans];
  return Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)) &&
    colors.every(name => validChartColor(value[name])) && Object.entries(numbers).every(([name, range]) => number(value[name], ...range)) &&
    booleans.every(name => typeof value[name] === "boolean");
};
export function validSeriesPreferences(value: unknown): value is SeriesPreferences {
  if (!bag(value) || Object.keys(value).length !== 8 + Number(Object.hasOwn(value, "pluginCandles")) + Number(Object.hasOwn(value, "footprint")) + Number(Object.hasOwn(value, "tpo")) ||
    Object.hasOwn(value, "pluginCandles") && !validPluginCandles(value.pluginCandles) || Object.hasOwn(value, "footprint") && !validFootprint(value.footprint) || Object.hasOwn(value, "tpo") && !validTpo(value.tpo)) return false;
  return fields(value.candles, ["upColor", "downColor", "borderUpColor", "borderDownColor", "wickUpColor", "wickDownColor"], {}, ["bodyVisible", "borderVisible", "wickVisible"]) &&
    fields(value.bars, ["upColor", "downColor"]) && fields(value.line, ["color"], { width: [1, 10] }) &&
    fields(value.area, ["lineColor", "topColor", "bottomColor"], { width: [1, 10] }) &&
    fields(value.baseline, ["topLineColor", "bottomLineColor", "topFillColor", "topFillColor2", "bottomFillColor", "bottomFillColor2"], { width: [1, 10], baselineLevel: [0, 100] }) &&
    fields(value.animations, [], {}, ["zoom", "pan", "autoscale", "intro"]) && number(value.spacing, 0.1, 10) && typeof value.animateLastPrice === "boolean";
}
export function readSeriesPreferences(config: unknown): SeriesPreferences | null {
  if (!bag(config) || !bag(config.series) || !bag(config.priceScale)) return null;
  const result: Bag = Object.fromEntries(["candles", "bars", "line", "area", "baseline", "animations"].map(name => [name, bag(config[name]) ? { ...config[name] } : null]));
  result.spacing = config.series.spacing; result.animateLastPrice = config.priceScale.animateLastPrice;
  if (bag(config.chartTypes)) { result.pluginCandles = readPluginCandles(config.chartTypes); result.footprint = resolveFootprintChart(config.chartTypes.footprint); result.tpo = resolveTpo(config.chartTypes.tpo); }
  return validSeriesPreferences(result) ? result : null;
}
export function nativeSeriesPreferences(value: SeriesPreferences) {
  return { ...(value.pluginCandles || value.footprint || value.tpo ? { chartTypes: { ...structuredClone(value.pluginCandles ?? {}), ...(value.footprint ? { footprint: resolveFootprintChart(value.footprint) } : {}), ...(value.tpo ? { tpo: resolveTpo(value.tpo) } : {}) } } : {}), candles: { ...value.candles }, bars: { ...value.bars }, line: { ...value.line }, area: { ...value.area }, baseline: { ...value.baseline },
    animations: { ...value.animations }, series: { spacing: value.spacing }, priceScale: { animateLastPrice: value.animateLastPrice } };
}
export const seriesPreferencesKey = (value: SeriesPreferences) => JSON.stringify(nativeSeriesPreferences(value));
