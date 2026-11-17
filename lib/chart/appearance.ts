import type { WorkspaceTheme } from "@/types/workspace";
import { chartTheme } from "./theme";

export interface ChartAppearance {
  layout: { background: string; textColor: string; fontFamily: string; fontSize: number };
  grid: { vertical: string; horizontal: string };
  crosshair: { color: string; labelBackground: string };
  borderColor: string;
  separatorColor: string;
  margins: { top: number; bottom: number; right: number };
}
export type ChartAppearancePreferences = Partial<Record<WorkspaceTheme, ChartAppearance>>;
type Bag = Record<string, unknown>;
const bag = (value: unknown): value is Bag => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Bag, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
export const validChartColor = (value: unknown): value is string => typeof value === "string" && /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|transparent)$/i.test(value) && value.length <= 96;
const color = validChartColor;
const number = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export function validChartAppearance(value: unknown): value is ChartAppearance {
  if (!bag(value) || !keys(value, ["layout", "grid", "crosshair", "borderColor", "separatorColor", "margins"])) return false;
  const { layout, grid, crosshair, margins } = value;
  return bag(layout) && keys(layout, ["background", "textColor", "fontFamily", "fontSize"]) && color(layout.background) && color(layout.textColor) &&
    typeof layout.fontFamily === "string" && layout.fontFamily.length > 0 && layout.fontFamily.length <= 256 && !/[;{}<>\r\n]|url\(/i.test(layout.fontFamily) && number(layout.fontSize, 6, 32) &&
    bag(grid) && keys(grid, ["vertical", "horizontal"]) && color(grid.vertical) && color(grid.horizontal) &&
    bag(crosshair) && keys(crosshair, ["color", "labelBackground"]) && color(crosshair.color) && color(crosshair.labelBackground) &&
    color(value.borderColor) && color(value.separatorColor) && bag(margins) && keys(margins, ["top", "bottom", "right"]) &&
    number(margins.top, 0, 40) && number(margins.bottom, 0, 40) && number(margins.right, 0, 200) && Number.isInteger(margins.right);
}
export function validAppearancePreferences(value: unknown): value is ChartAppearancePreferences {
  return bag(value) && Object.keys(value).every(key => (key === "dark" || key === "light") && validChartAppearance(value[key]));
}
export function readChartAppearance(config: unknown): ChartAppearance | null {
  if (!bag(config) || !bag(config.grid) || !bag(config.grid.vertLines) || !bag(config.grid.horzLines) || !bag(config.priceScale) || !bag(config.panes) || !bag(config.crosshair)) return null;
  const result = { layout: bag(config.layout) ? { ...config.layout } : null,
    grid: { vertical: config.grid.vertLines.color, horizontal: config.grid.horzLines.color },
    crosshair: { color: config.crosshair.color, labelBackground: config.crosshair.labelBackground },
    borderColor: config.priceScale.borderColor, separatorColor: config.panes.separatorColor,
    margins: bag(config.margins) ? { ...config.margins } : null };
  return validChartAppearance(result) ? result : null;
}
export function nativeChartAppearance(value: ChartAppearance) {
  return { layout: { ...value.layout }, grid: { vertLines: { color: value.grid.vertical }, horzLines: { color: value.grid.horizontal } },
    crosshair: { ...value.crosshair }, priceScale: { borderColor: value.borderColor }, panes: { separatorColor: value.separatorColor }, margins: { ...value.margins } };
}
export const appearanceKey = (value: ChartAppearance) => JSON.stringify(nativeChartAppearance(value));

/** Recreate factory canvas values for a new theme without inheriting the previous theme's user edits. */
export function appearanceDefaults(initial: ChartAppearance, from: WorkspaceTheme, to: WorkspaceTheme): ChartAppearance {
  const before = chartTheme(from), after = chartTheme(to), result = structuredClone(initial);
  result.layout.background = after.background!; result.layout.textColor = after.textColor!; result.layout.fontFamily = after.fontFamily!;
  result.grid.vertical = after.gridColor!; result.grid.horizontal = after.gridColor!;
  result.borderColor = after.borderColor!; result.separatorColor = after.borderColor!;
  for (const key of ["color", "labelBackground"] as const) if (result.crosshair[key] === before.textColor) result.crosshair[key] = after.textColor!;
  return result;
}
