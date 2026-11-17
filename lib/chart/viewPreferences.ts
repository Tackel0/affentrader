/** Native view controls whose values belong to a chart cell, independent of its data/style. */
export interface ChartViewPreferences {
  grid: { vertical: boolean; horizontal: boolean };
  priceScale: { invert: boolean; labelsVisible: boolean; currentPriceLine: boolean; priceLabel: boolean; countdown: boolean };
  crosshair: { style: "solid" | "dashed" | "dotted"; width: number; opacity: number };
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const keys = (value: RecordValue, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));

export function validChartView(value: unknown): value is ChartViewPreferences {
  if (!record(value) || !keys(value, ["grid", "priceScale", "crosshair"])) return false;
  const { grid, priceScale, crosshair } = value;
  return record(grid) && keys(grid, ["vertical", "horizontal"]) && Object.values(grid).every(item => typeof item === "boolean") &&
    record(priceScale) && keys(priceScale, ["invert", "labelsVisible", "currentPriceLine", "priceLabel", "countdown"]) && Object.values(priceScale).every(item => typeof item === "boolean") &&
    record(crosshair) && keys(crosshair, ["style", "width", "opacity"]) && ["solid", "dashed", "dotted"].includes(String(crosshair.style)) &&
    typeof crosshair.width === "number" && Number.isFinite(crosshair.width) && crosshair.width >= 0.5 && crosshair.width <= 8 &&
    typeof crosshair.opacity === "number" && Number.isFinite(crosshair.opacity) && crosshair.opacity >= 0 && crosshair.opacity <= 1;
}

/** Copy only the agreed controls from Vela's public config; unrelated renderer fields never enter storage. */
export function readChartView(config: unknown): ChartViewPreferences | null {
  if (!record(config) || !record(config.grid) || !record(config.priceScale) || !record(config.crosshair)) return null;
  const { grid, priceScale, crosshair } = config;
  if (!record(grid.vertLines) || !record(grid.horzLines)) return null;
  const result = { grid: { vertical: grid.vertLines.visible, horizontal: grid.horzLines.visible },
    priceScale: { invert: priceScale.invert, labelsVisible: priceScale.labelsVisible, currentPriceLine: priceScale.currentPriceLine, priceLabel: priceScale.priceLabel, countdown: priceScale.countdown },
    crosshair: { style: crosshair.style, width: crosshair.width, opacity: crosshair.opacity } };
  return validChartView(result) ? result : null;
}

export function nativeChartView(value: ChartViewPreferences) {
  return { grid: { vertLines: { visible: value.grid.vertical }, horzLines: { visible: value.grid.horizontal } },
    priceScale: { ...value.priceScale }, crosshair: { ...value.crosshair } };
}

export function chartViewKey(value: ChartViewPreferences): string {
  return JSON.stringify([value.grid.vertical, value.grid.horizontal, value.priceScale.invert, value.priceScale.labelsVisible,
    value.priceScale.currentPriceLine, value.priceScale.priceLabel, value.priceScale.countdown, value.crosshair.style, value.crosshair.width, value.crosshair.opacity]);
}
