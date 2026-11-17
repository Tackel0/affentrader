import type { ChartTypeSettingsSection, RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar, FootprintVolumeMode, OHLCV } from "@/types/trading";
import { validChartColor } from "@/lib/chart/appearance";
import { visibleSlice } from "@/lib/chart/canvasLayer";
import { executionPriceGrid } from "./priceGrid";
import { FOOTPRINT_CELL_VALUES, footprintSizes, type FootprintCellValues } from "./footprintCells";
import { FOOTPRINT_MODES, FOOTPRINT_MODE_OPTIONS, footprintModeTitle, footprintModeRects } from "./footprintModes";
import { tpoColorRgba } from "./tpoTimeColors";
import { FOOTPRINT_STAT_TOGGLES, defaultFootprintStatistics, paintFootprintStatistics, type FootprintStatPreferences } from "./footprintStatistics";
import { FOOTPRINT_FILTER_KEYS, defaultFootprintFilters, type FootprintVolumeFilters } from "./footprintFilters";
import { footprintBodyModulation, footprintCandleHalfWidth, footprintRawSpacing, footprintRevealTarget } from "./footprintReveal";
import { FOOTPRINT_PALETTE_MIGRATIONS } from "./footprintInputMigration";
import { paintFootprintText, planFootprintText } from "./footprintText";
import { paintFootprintStructure } from "./footprintStructure";
import { footprintTextColor } from "./footprintTheme";

export interface FootprintPreferences extends FootprintStatPreferences, FootprintVolumeFilters {
  position?: "left" | "right" | "within";
  rowHeight: number;
  rowSize: number;
  rowMode?: "auto" | "manual";
  rowTicks?: number;
  imbalanceRatio: number;
  /** Native percent control; old layouts store only the ratio multiplier. */
  imbalancePercent?: number;
  histogramVisible: boolean;
  candleVisible: boolean;
  pocVisible: boolean;
  imbalanceVisible: boolean;
  imbalanceRecolor?: boolean;
  imbalanceWidth?: number;
  imbalanceAskColor?: string; imbalanceBidColor?: string;
  imbalanceTextAskColor?: string; imbalanceTextBidColor?: string;
  textColorAuto: boolean;
  textAutoSize?: boolean; textSize?: number; textFit?: boolean;
  areaBackground?: boolean; areaBackgroundColor?: string;
  buyColor: string;
  sellColor: string;
  bidColor?: string; askColor?: string;
  volumeBuyColor?: string; volumeSellColor?: string;
  deltaUpColor?: string; deltaDownColor?: string;
  textColor: string;
  pocColor: string;
  stackedVisible?: boolean;
  stackedRows?: number;
  stackedBuyColor?: string; stackedSellColor?: string;
  imbalanceMinVolume?: number;
  ignoreZeroOpposite?: boolean;
  statisticsVisible?: boolean;
  volumeMode?: FootprintVolumeMode;
  cellValues?: FootprintCellValues; averageTradeSize?: boolean;
  volumeSplit?: boolean; gradientCells?: boolean; monoLowColor?: string; monoHighColor?: string;
  unfinishedVisible?: boolean; unfinishedMinVolume?: number; unfinishedWidth?: number; unfinishedExtend?: boolean;
  unfinishedHighColor?: string; unfinishedLowColor?: string;
  valueAreaVisible?: boolean; valueAreaPercent?: number; valueAreaColor?: string; valueAreaBackground?: string; valueAreaWidth?: number;
  pocExtend?: boolean; pocWidth?: number;
  absorptionVisible?: boolean; exhaustionVisible?: boolean; absorptionColor?: string; exhaustionColor?: string;
}
export type ResolvedFootprintPreferences = Required<FootprintPreferences>;
export const defaultFootprint = (): ResolvedFootprintPreferences => ({ rowHeight: 16, rowSize: 0, rowMode: "auto", rowTicks: 4, imbalanceRatio: 3, imbalancePercent: 300,
  histogramVisible: true, candleVisible: true, pocVisible: true, imbalanceVisible: false, imbalanceRecolor: false, textColorAuto: false,
  textAutoSize: true, textSize: 11, textFit: false,
  areaBackground: false, areaBackgroundColor: "rgba(178,181,190,0.06)",
  imbalanceWidth: 2, imbalanceAskColor: "#089981", imbalanceBidColor: "#f23645", imbalanceTextAskColor: "#089981", imbalanceTextBidColor: "#f23645",
  buyColor: "#089981", sellColor: "#f23645", textColor: "#d1d4dc", pocColor: "#ffffff",
  bidColor: "#f23645", askColor: "#089981", volumeBuyColor: "#089981", volumeSellColor: "#f23645", deltaUpColor: "#089981", deltaDownColor: "#f23645",
  stackedVisible: false, stackedRows: 3, stackedBuyColor: "rgba(8,153,129,0.28)", stackedSellColor: "rgba(242,54,69,0.28)", imbalanceMinVolume: 0, ignoreZeroOpposite: false, statisticsVisible: false, volumeMode: "bid-ask", cellValues: "auto", averageTradeSize: false,
  volumeSplit: true, gradientCells: true, monoLowColor: "#3a3d45", monoHighColor: "#a3a9b5",
  unfinishedVisible: false, unfinishedMinVolume: 0, unfinishedWidth: 1, unfinishedExtend: true, unfinishedHighColor: "#f23645", unfinishedLowColor: "#089981", position: "right",
  valueAreaVisible: true, valueAreaPercent: 70, valueAreaColor: "#b2b5be", valueAreaBackground: "rgba(178,181,190,0)", valueAreaWidth: 1, pocExtend: false, pocWidth: 1,
  absorptionVisible: false, exhaustionVisible: false, absorptionColor: "#f59e0b", exhaustionColor: "#a855f7",
  ...defaultFootprintStatistics(), ...defaultFootprintFilters() });
const numbers = { rowHeight: [12, 40], rowSize: [0, 1e9], imbalanceRatio: [1, 100], imbalancePercent: [100, 10000], imbalanceWidth: [1, 10], textSize: [6, 40], stackedRows: [2, 40], imbalanceMinVolume: [0, 1e15], unfinishedMinVolume: [0, 1e9], unfinishedWidth: [1, 10], valueAreaPercent: [1, 100], valueAreaWidth: [1, 10], pocWidth: [1, 10], statisticsSize: [6, 24], minVolume: [0, 1e15], maxVolume: [0, 1e15], minBidVolume: [0, 1e15], maxBidVolume: [0, 1e15], minAskVolume: [0, 1e15], maxAskVolume: [0, 1e15] } as const;
const toggles = ["histogramVisible", "candleVisible", "pocVisible", "imbalanceVisible", "textColorAuto"] as const;
const modeColors = ["bidColor", "askColor", "volumeBuyColor", "volumeSellColor", "deltaUpColor", "deltaDownColor"] as const;
const optional = [...modeColors, "areaBackground", "areaBackgroundColor", "textAutoSize", "textSize", "textFit", "imbalanceRecolor", "imbalancePercent", "imbalanceWidth", "imbalanceAskColor", "imbalanceBidColor", "imbalanceTextAskColor", "imbalanceTextBidColor", "stackedVisible", "stackedRows", "stackedBuyColor", "stackedSellColor", "imbalanceMinVolume", "ignoreZeroOpposite", "statisticsVisible", "volumeMode", "unfinishedVisible", "unfinishedMinVolume", "unfinishedWidth", "unfinishedExtend", "unfinishedHighColor", "unfinishedLowColor", "cellValues", "averageTradeSize", "volumeSplit", "gradientCells", "monoLowColor", "monoHighColor", "valueAreaVisible", "valueAreaPercent", "valueAreaColor", "valueAreaBackground", "valueAreaWidth", "pocExtend", "pocWidth", "absorptionVisible", "exhaustionVisible", "absorptionColor", "exhaustionColor", ...FOOTPRINT_STAT_TOGGLES, "statisticsPosition", "statisticsSize", "statisticsColor", "statisticsBackground", ...FOOTPRINT_FILTER_KEYS] as const;
const extraToggles = ["areaBackground","textAutoSize", "textFit","imbalanceRecolor", "stackedVisible", "ignoreZeroOpposite", "statisticsVisible", "unfinishedVisible", "unfinishedExtend", "averageTradeSize", "volumeSplit", "gradientCells", "valueAreaVisible", "pocExtend", "absorptionVisible", "exhaustionVisible", ...FOOTPRINT_STAT_TOGGLES] as const;
const colors = ["buyColor", "sellColor", "textColor", "pocColor"] as const;
const extraColors = [...modeColors, "areaBackgroundColor", "imbalanceAskColor", "imbalanceBidColor", "imbalanceTextAskColor", "imbalanceTextBidColor", "unfinishedHighColor", "unfinishedLowColor", "monoLowColor", "monoHighColor", "valueAreaColor", "valueAreaBackground", "statisticsColor", "statisticsBackground", "stackedBuyColor", "stackedSellColor", "absorptionColor", "exhaustionColor"] as const;
const bag = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const validMode = (value: unknown): value is FootprintVolumeMode => FOOTPRINT_MODES.includes(value as FootprintVolumeMode);
export const footprintModeLabel = footprintModeTitle;
const validNumber = (key: keyof typeof numbers, value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= numbers[key][0] && value <= numbers[key][1] && (!["rowHeight", "textSize", "imbalanceWidth", "stackedRows", "unfinishedWidth", "valueAreaWidth", "pocWidth", "statisticsSize"].includes(key) || Number.isInteger(value));
function validSingleFootprint(value: unknown): value is FootprintPreferences {
  return bag(value) && Object.keys(value).length === 12 + [...optional, "rowMode", "rowTicks"].filter(key => Object.hasOwn(value, key)).length + Number(Object.hasOwn(value, "position")) &&
    (!Object.hasOwn(value, "rowMode") || ["auto", "manual"].includes(value.rowMode as string)) &&
    (!Object.hasOwn(value, "rowTicks") || typeof value.rowTicks === "number" && Number.isInteger(value.rowTicks) && value.rowTicks >= 1 && value.rowTicks <= 64) &&
    (!Object.hasOwn(value, "position") || ["left", "right", "within"].includes(value.position as string)) &&
    (!Object.hasOwn(value, "statisticsPosition") || ["above", "below"].includes(value.statisticsPosition as string)) &&
    Object.keys(numbers).every(key => optional.includes(key as typeof optional[number]) && !Object.hasOwn(value, key) || validNumber(key as keyof typeof numbers, value[key])) &&
    extraToggles.every(key => !Object.hasOwn(value, key) || typeof value[key] === "boolean") &&
    extraColors.every(key => !Object.hasOwn(value, key) || validChartColor(value[key])) &&
    (!Object.hasOwn(value, "volumeMode") || validMode(value.volumeMode)) &&
    (!Object.hasOwn(value, "cellValues") || FOOTPRINT_CELL_VALUES.includes(value.cellValues as FootprintCellValues)) &&
    toggles.every(key => typeof value[key] === "boolean") && colors.every(key => validChartColor(value[key]));
}
export function resolveFootprint(value: unknown): ResolvedFootprintPreferences {
  const result = defaultFootprint(); if (!bag(value)) return result;
  if (["auto", "manual"].includes(value.rowMode as string)) result.rowMode = value.rowMode as "auto" | "manual";
  if (typeof value.rowTicks === "number" && Number.isFinite(value.rowTicks)) result.rowTicks = Math.max(1, Math.min(64, Math.round(value.rowTicks)));
  // Previously saved total profiles were mono, before this option existed.
  if (value.volumeMode === "total" && !Object.hasOwn(value, "volumeSplit")) result.volumeSplit = false;
  for (const key of Object.keys(numbers) as Array<keyof typeof numbers>) if (validNumber(key, value[key])) result[key] = value[key];
  if (typeof value.textSize === "number" && Number.isFinite(value.textSize)) result.textSize = Math.round(Math.max(6, Math.min(40, value.textSize)));
  if (validNumber("imbalancePercent", value.imbalancePercent)) result.imbalanceRatio = result.imbalancePercent / 100;
  else result.imbalancePercent = result.imbalanceRatio * 100;
  for (const key of [...toggles, ...extraToggles]) if (typeof value[key] === "boolean") result[key] = value[key];
  // Older layouts used a single switch for both outlines and side-value tinting.
  if (!Object.hasOwn(value, "imbalanceRecolor")) result.imbalanceRecolor = result.imbalanceVisible;
  for (const key of [...colors, ...extraColors]) if (validChartColor(value[key])) result[key] = value[key];
  // Before independent palettes, both flags and side-value tints used the
  // histogram colors. Preserve explicitly saved colors in those old layouts.
  for (const [key, old] of FOOTPRINT_PALETTE_MIGRATIONS)
    if (!Object.hasOwn(value, key) && validChartColor(value[old])) result[key] = value[old];
  if (validMode(value.volumeMode)) result.volumeMode = value.volumeMode;
  if (FOOTPRINT_CELL_VALUES.includes(value.cellValues as FootprintCellValues)) result.cellValues = value.cellValues as FootprintCellValues;
  if (["left", "right", "within"].includes(value.position as string)) result.position = value.position as ResolvedFootprintPreferences["position"];
  if (["above", "below"].includes(value.statisticsPosition as string)) result.statisticsPosition = value.statisticsPosition as ResolvedFootprintPreferences["statisticsPosition"];
  return result;
}
export interface FootprintInstance { id: string; label: string; style: ResolvedFootprintPreferences }
const instanceDefaults: Array<Pick<ResolvedFootprintPreferences, "volumeMode" | "position">> = [
  { volumeMode: "bid-ask", position: "right" }, { volumeMode: "bid-ask-ladder", position: "left" },
  { volumeMode: "total", position: "within" }, { volumeMode: "delta", position: "right" },
  { volumeMode: "absolute-delta", position: "left" },
];
const instanceKey = (index: number, key: string) => index === 0 ? key : `fp${index + 1}${key[0].toUpperCase()}${key.slice(1)}`;
function instanceBag(value: Record<string, unknown>, index: number) {
  return Object.fromEntries(Object.keys(defaultFootprint()).flatMap(key => Object.hasOwn(value, instanceKey(index, key)) ? [[key, value[instanceKey(index, key)]]] : []));
}
const visibleExcluded = new Set(["position", "candleVisible", "pocExtend", "stackedVisible", "stackedRows", "stackedBuyColor", "stackedSellColor", "unfinishedVisible", "unfinishedMinVolume", "unfinishedWidth", "unfinishedExtend", "unfinishedHighColor", "unfinishedLowColor"]);
const visibleKeys = () => Object.keys(defaultFootprint()).filter(key => !visibleExcluded.has(key));
const visibleKey = (key: string) => `vr${key[0].toUpperCase()}${key.slice(1)}`;
function visibleBag(value: Record<string, unknown>) {
  return Object.fromEntries(visibleKeys().flatMap(key => Object.hasOwn(value, visibleKey(key)) ? [[key, value[visibleKey(key)]]] : []));
}
export function resolveVisibleFootprint(value: unknown) {
  const source = bag(value) ? value : {};
  return { enabled: source.vrEnabled === true, widthPercent: typeof source.vrWidthPercent === "number" && Number.isFinite(source.vrWidthPercent) && source.vrWidthPercent >= 5 && source.vrWidthPercent <= 90 ? source.vrWidthPercent : 30,
    style: { ...resolveFootprint(visibleBag(source)), position: "right" as const, candleVisible: false, pocExtend: false, stackedVisible: false, unfinishedVisible: false } };
}
/** Strict backup validation, including disabled instances. Unknown keys stay invalid. */
export function validFootprint(value: unknown): value is FootprintPreferences {
  if (!bag(value)) return false;
  const root = { ...value };
  if (Object.hasOwn(value, "vrEnabled") && typeof value.vrEnabled !== "boolean") return false;
  if (Object.hasOwn(value, "vrWidthPercent") && (typeof value.vrWidthPercent !== "number" || !Number.isFinite(value.vrWidthPercent) || value.vrWidthPercent < 5 || value.vrWidthPercent > 90)) return false;
  delete root.vrEnabled; delete root.vrWidthPercent;
  const visible = visibleBag(value);
  if (!validSingleFootprint({ ...defaultFootprint(), ...visible })) return false;
  for (const key of Object.keys(visible)) delete root[visibleKey(key)];
  if (Object.hasOwn(value, "readoutInstance") && !["1", "2", "3", "4", "5"].includes(value.readoutInstance as string)) return false;
  delete root.readoutInstance;
  for (let i = 1; i < 5; i++) {
    const enabled = `fp${i + 1}Enabled`;
    if (Object.hasOwn(value, enabled) && typeof value[enabled] !== "boolean") return false;
    delete root[enabled];
    const own = instanceBag(value, i);
    if (!validSingleFootprint({ ...defaultFootprint(), ...own })) return false;
    for (const key of Object.keys(own)) delete root[instanceKey(i, key)];
  }
  return validSingleFootprint(root);
}
/** Capture every stored instance, including disabled ones, without retaining unknown data. */
export function resolveFootprintChart(value: unknown): FootprintPreferences & Record<string, unknown> {
  const result: FootprintPreferences & Record<string, unknown> = { ...resolveFootprint(value) };
  if (!bag(value)) return result;
  const visible = resolveVisibleFootprint(value);
  if (typeof value.vrEnabled === "boolean") result.vrEnabled = value.vrEnabled;
  if (Object.hasOwn(value, "vrWidthPercent")) result.vrWidthPercent = visible.widthPercent;
  if (Object.keys(visibleBag(value)).length) for (const key of visibleKeys()) result[visibleKey(key)] = visible.style[key as keyof ResolvedFootprintPreferences];
  if (["1", "2", "3", "4", "5"].includes(value.readoutInstance as string)) result.readoutInstance = value.readoutInstance;
  for (let i = 1; i < 5; i++) {
    const enabled = `fp${i + 1}Enabled`;
    if (typeof value[enabled] === "boolean") result[enabled] = value[enabled];
    const own = instanceBag(value, i), resolved = resolveFootprint({ ...instanceDefaults[i], ...own });
    if (Object.keys(own).length) for (const key of Object.keys(resolved)) result[instanceKey(i, key)] = resolved[key as keyof ResolvedFootprintPreferences];
  }
  return result;
}
export function resolveFootprintInstances(value: unknown): FootprintInstance[] {
  const source = bag(value) ? value : {}, instances: FootprintInstance[] = [];
  let within = false;
  for (let i = 0; i < 5; i++) {
    if (i && source[`fp${i + 1}Enabled`] !== true) continue;
    const own = instanceBag(source, i), style = resolveFootprint({ ...instanceDefaults[i], ...own });
    if (style.position === "within") { if (within) style.position = "right"; within = true; }
    instances.push({ id: `fp${i + 1}`, label: `Footprint ${i + 1}`, style });
  }
  return instances;
}
function singleFootprintSettings(): ChartTypeSettingsSection {
  const defaults = defaultFootprint();
  return { title: "Footprint", placement: "after-symbol", visibility: "active", rows: [
    { kind: "select", key: "position", label: "Position", defval: "right", options: [["right", "Right"], ["left", "Left"], ["within", "Within"]] },
    { kind: "select", key: "volumeMode", label: "Display mode", defval: "bid-ask", options: FOOTPRINT_MODE_OPTIONS },
    { kind: "select", key: "cellValues", label: "Cell values", defval: "auto", options: [["auto", "Auto"], ["bid-ask", "Bid × Ask"], ["total", "Total"], ["delta", "Delta"], ["trades", "Trades"], ["bid-ask-trades", "Bid × Ask Trades"]] },
    { kind: "toggle", key: "averageTradeSize", label: "Average trade size", defval: false },
    { kind: "toggle", key: "volumeSplit", label: "Volume: buy/sell split", defval: true, when: { key: "volumeMode", equals: "total" } },
    { kind: "toggle", key: "gradientCells", label: "Gradient cells", defval: true },
    { kind: "color", key: "askColor", label: "Ask histogram", defval: defaults.askColor, when: { key: "volumeMode", anyOf: ["bid-ask", "bid-ask-ladder"] } },
    { kind: "color", key: "bidColor", label: "Bid histogram", defval: defaults.bidColor, when: { key: "volumeMode", anyOf: ["bid-ask", "bid-ask-ladder"] } },
    { kind: "color", key: "volumeBuyColor", label: "Volume buy", defval: defaults.volumeBuyColor, when: [{ key: "volumeMode", equals: "total" }, { key: "volumeSplit", equals: true }] },
    { kind: "color", key: "volumeSellColor", label: "Volume sell", defval: defaults.volumeSellColor, when: [{ key: "volumeMode", equals: "total" }, { key: "volumeSplit", equals: true }] },
    { kind: "color", key: "deltaUpColor", label: "Delta up", defval: defaults.deltaUpColor, when: { key: "volumeMode", anyOf: ["delta", "absolute-delta"] } },
    { kind: "color", key: "deltaDownColor", label: "Delta down", defval: defaults.deltaDownColor, when: { key: "volumeMode", anyOf: ["delta", "absolute-delta"] } },
    { kind: "color", key: "monoLowColor", label: "Volume mono low", defval: defaults.monoLowColor, when: [{ key: "volumeMode", equals: "total" }, { key: "volumeSplit", equals: false }] },
    { kind: "color", key: "monoHighColor", label: "Volume mono high", defval: defaults.monoHighColor, when: [{ key: "volumeMode", equals: "total" }, { key: "volumeSplit", equals: false }] },
    { kind: "toggle", key: "areaBackground", label: "Area background", defval: false,
      colors: [{ key: "areaBackgroundColor", label: "Area background color", defval: defaults.areaBackgroundColor }] },
    { kind: "heading", label: "Values" },
    { kind: "toggle", key: "textAutoSize", label: "Auto text size", defval: true },
    { kind: "number", key: "textSize", label: "Text size (px)", defval: 11, min: 6, max: 40, step: 1, when: { key: "textAutoSize", equals: false } },
    { kind: "toggle", key: "textColorAuto", label: "Use theme text color", defval: false },
    { kind: "color", key: "textColor", label: "Text color", defval: defaults.textColor, when: { key: "textColorAuto", equals: false } },
    { kind: "toggle", key: "textFit", label: "Shrink numbers to fit", defval: false },
    { kind: "row", label: "Calculation", controls: [{ kind: "hint", text: "Mean shapes; raw labels." }] },
    { kind: "heading", label: "Price levels" },
    { kind: "select", key: "rowMode", label: "Rows", defval: "auto", options: [["auto", "Auto"], ["manual", "Manual"]] },
    { kind: "number", key: "rowTicks", label: "Ticks per row", defval: 4, min: 1, max: 64, step: 1, when: { key: "rowMode", equals: "manual" } },
    { kind: "number", key: "rowSize", label: "Price row override (0 = venue grid)", defval: 0, min: 0, max: 1e9, step: .01 },
    { kind: "heading", label: "Imbalances" },
    { kind: "toggle", key: "imbalanceVisible", label: "Highlight imbalances", defval: false, colors: [
      { key: "imbalanceAskColor", label: "Ask highlight", defval: defaults.imbalanceAskColor }, { key: "imbalanceBidColor", label: "Bid highlight", defval: defaults.imbalanceBidColor }] },
    { kind: "number", key: "imbalancePercent", label: "Ratio (%)", defval: 300, min: 100, max: 10000, step: 50 },
    { kind: "number", key: "imbalanceWidth", label: "Highlight width", defval: 2, min: 1, max: 10, step: 1, when: { key: "imbalanceVisible", equals: true } },
    { kind: "toggle", key: "imbalanceRecolor", label: "Recolor imbalance values", defval: false, colors: [
      { key: "imbalanceTextAskColor", label: "Ask value color", defval: defaults.imbalanceTextAskColor }, { key: "imbalanceTextBidColor", label: "Bid value color", defval: defaults.imbalanceTextBidColor }] },
    { kind: "number", key: "imbalanceMinVolume", label: "Min imbalance volume", defval: 0, min: 0, max: 1e15, step: .001 },
    { kind: "toggle", key: "ignoreZeroOpposite", label: "Require nonzero opposite volume", defval: false },
    { kind: "toggle", key: "stackedVisible", label: "Stacked imbalance zones", defval: false, colors: [
      { key: "stackedBuyColor", label: "Buy stack fill", defval: defaults.stackedBuyColor }, { key: "stackedSellColor", label: "Sell stack fill", defval: defaults.stackedSellColor }] },
    { kind: "number", key: "stackedRows", label: "Stacked row count", defval: 3, min: 2, max: 40, step: 1 },
    { kind: "heading", label: "Value area and POC" },
    { kind: "toggle", key: "valueAreaVisible", label: "Value area", defval: true, colors: [{ key: "valueAreaColor", label: "Value area lines", defval: defaults.valueAreaColor }] },
    { kind: "number", key: "valueAreaPercent", label: "Value area (%)", defval: 70, min: 1, max: 100, step: 1 },
    { kind: "color", key: "valueAreaBackground", label: "Value area background", defval: defaults.valueAreaBackground },
    { kind: "number", key: "valueAreaWidth", label: "Value area line width", defval: 1, min: 1, max: 10, step: 1 },
    { kind: "toggle", key: "pocVisible", label: "Point of control", defval: true,
      colors: [{ key: "pocColor", label: "Point of control color", defval: defaults.pocColor }] },
    { kind: "toggle", key: "pocExtend", label: "Extend POC until broken", defval: false },
    { kind: "number", key: "pocWidth", label: "POC line width", defval: 1, min: 1, max: 10, step: 1 },
    { kind: "heading", label: "Stat table" },
    { kind: "toggle", key: "statisticsVisible", label: "Stat table", defval: false },
    { kind: "select", key: "statisticsPosition", label: "Table position", defval: "below", options: [["below", "Below"], ["above", "Above"]] },
    { kind: "number", key: "statisticsSize", label: "Text size", defval: 8, min: 6, max: 24, step: 1 },
    { kind: "color", key: "statisticsColor", label: "Table text", defval: defaults.statisticsColor },
    { kind: "color", key: "statisticsBackground", label: "Table background", defval: defaults.statisticsBackground },
    ...FOOTPRINT_STAT_TOGGLES.map((key,index) => ({ kind: "toggle" as const, key, label: ["Total volume", "Buy volume", "Sell volume", "Buy %", "Sell %", "Delta", "Delta %", "Trade count", "Bid count", "Ask count"][index], defval: defaults[key] })),
    { kind: "heading", label: "Filters" },
    ...FOOTPRINT_FILTER_KEYS.map((key,index) => ({ kind: "number" as const, key, label: ["Min volume", "Max volume", "Min bid volume", "Max bid volume", "Min ask volume", "Max ask volume"][index], defval: 0, min: 0, max: 1e15, step: .001 })),
    { kind: "row", label: "Zero", controls: [{ kind: "hint", text: "Off; row slots stay fixed." }] },
    { kind: "heading", label: "Unfinished auctions" },
    { kind: "toggle", key: "unfinishedVisible", label: "Unfinished auctions", defval: false, colors: [
      { key: "unfinishedHighColor", label: "Unfinished high color", defval: defaults.unfinishedHighColor },
      { key: "unfinishedLowColor", label: "Unfinished low color", defval: defaults.unfinishedLowColor }] },
    { kind: "number", key: "unfinishedMinVolume", label: "Min volume per side", defval: 0, min: 0, max: 1e9, step: 1 },
    { kind: "number", key: "unfinishedWidth", label: "Unfinished line width", defval: 1, min: 1, max: 10, step: 1 },
    { kind: "toggle", key: "unfinishedExtend", label: "Extend until revisited", defval: true },
    { kind: "heading", label: "Orderflow signals" },
    { kind: "toggle", key: "absorptionVisible", label: "Absorption at High/Low", defval: false,
      colors: [{ key: "absorptionColor", label: "Absorption highlight", defval: defaults.absorptionColor }] },
    { kind: "toggle", key: "exhaustionVisible", label: "Exhaustion prints", defval: false,
      colors: [{ key: "exhaustionColor", label: "Exhaustion highlight", defval: defaults.exhaustionColor }] },
    { kind: "heading", label: "Display" },
    { kind: "toggle", key: "histogramVisible", label: "Volume histogram", defval: true },
    { kind: "toggle", key: "candleVisible", label: "Side candle", defval: true,
      colors: [{ key: "buyColor", label: "Candle up", defval: defaults.buyColor }, { key: "sellColor", label: "Candle down", defval: defaults.sellColor }] },
  ] };
}

export function footprintSettings(): ChartTypeSettingsSection {
  const single = singleFootprintSettings(), rows = single.rows!;
  const remap = (value: unknown, index: number): unknown => {
    if (Array.isArray(value)) return value.map(item => remap(item, index));
    if (!bag(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "key" && typeof item === "string" ? instanceKey(index, item) : remap(item, index)]));
  };
  const visibleRows = rows.filter(row => !("key" in row && visibleExcluded.has(row.key)) && !(row.kind === "heading" && row.label === "Unfinished auctions"));
  const remapVisible = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(remapVisible);
    if (!bag(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "key" && typeof item === "string" ? visibleKey(item) : remapVisible(item)]));
  };
  return { ...single, subsections: [{ title: "Visible range", enableKey: "vrEnabled", rows: [
    { kind: "toggle", key: "vrEnabled", label: "Visible range profile", defval: false },
    { kind: "number", key: "vrWidthPercent", label: "Profile width (%)", defval: 30, min: 5, max: 90, step: 1 },
    ...visibleRows.map(row => remapVisible(row) as typeof row),
  ] }], instances: instanceDefaults.map((defaults, index) => ({ label: `Footprint ${index + 1}`,
    ...(index ? { enableKey: `fp${index + 1}Enabled` } : {}),
    rows: [{ kind: "select" as const, key: "readoutInstance", label: "Data window / inspection", defval: "1",
      options: [["1", "Footprint 1"], ["2", "Footprint 2"], ["3", "Footprint 3"], ["4", "Footprint 4"], ["5", "Footprint 5"]] as [string, string][] }, ...rows.map(row => {
      const mapped = remap(row, index) as typeof row;
      if ("key" in row && (row.key === "volumeMode" || row.key === "position")) return { ...mapped, defval: defaults[row.key] } as typeof row;
      return mapped;
    })],
  })) };
}

export interface FootprintPlacement { width: number; offset: number; within: boolean; opacity?: number }
/** Side-only groups may use the gap up to the next candle; two-sided groups
 * share the inter-candle gap at its midpoint. Within retains the candle axis. */
export function footprintPlacements(args: RendererLayerArgs, instances: readonly FootprintInstance[], opacity = 1): Map<string, FootprintPlacement> {
  const pitch = Math.max(0, args.coords.pxPerBar()), gap = Math.min(6, .12 * pitch);
  const modulation = footprintBodyModulation(opacity, instances.map(instance => instance.style.position));
  const half = footprintCandleHalfWidth(args, modulation.candleBodyScale);
  const left = instances.filter(instance => instance.style.position === "left"), right = instances.filter(instance => instance.style.position === "right");
  const placements = new Map<string, FootprintPlacement>();
  const pack = (group: readonly FootprintInstance[], start: number, end: number) => {
    const available = Math.max(0, end - start), between = group.length > 1 ? Math.min(gap, available / (3 * group.length - 1)) : 0;
    const width = group.length ? Math.max(0, (available - between * (group.length - 1)) / group.length) : 0;
    group.forEach((instance, index) => placements.set(instance.id, { width, offset: start + width / 2 + index * (width + between), within: false, opacity }));
  };
  pack(left, right.length ? -pitch / 2 : -pitch + half + gap, -half - gap);
  pack(right, half + gap, left.length ? pitch / 2 : pitch - half - gap);
  for (const instance of instances) if (instance.style.position === "within") placements.set(instance.id, { width: half * 2, offset: 0, within: true, opacity });
  return placements;
}

/** Each instance owns its price grid. Explicit row size is independent of zoom. */
export function footprintStep(args: RendererLayerArgs, style: FootprintPreferences, lastPrice: number, priceTick?: number): number {
  if (style.rowSize > 0) return style.rowSize;
  if (!(priceTick && priceTick > 0 && Number.isFinite(priceTick))) throw new Error("Waiting for verified venue price-grid metadata. Set an explicit price row override if needed.");
  let multiple = style.rowMode === "manual" ? Math.max(1, Math.min(64, Math.round(Number.isFinite(style.rowTicks) ? style.rowTicks! : 4))) : 1;
  if (style.rowMode !== "manual") {
    const mid = (args.scale.min + args.scale.max) / 2;
    const height = Math.abs(args.coords.priceToY(mid + priceTick, args.scale, args.bounds) - args.coords.priceToY(mid, args.scale, args.bounds));
    if (height > 0 && Number.isFinite(height)) while (height * multiple < 16 && multiple < 4096) multiple *= 2;
  }
  return executionPriceGrid(priceTick).row(multiple).lower;
}

export function paintFootprintCandles(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, style: FootprintPreferences) {
  if (!style.candleVisible) return;
  const range = args.coords.visibleTimeRange(), [from, to] = visibleSlice(args.bars, range.from, range.to);
  for (const candle of args.bars.slice(from, to)) paintFootprintBar(ctx, args,
    { time: candle.time, levels: [], delta: 0, volume: 0, poc: NaN }, candle, 1, style);
}

/** Measure all drawable bars together so one instance uses a uniform Auto size. */
export function footprintTextPlan(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, bars: readonly FootprintBar[], step: number, style: FootprintPreferences, placement?: FootprintPlacement): number | null {
  const visible = bars.filter(bar => { const g = footprintBarGeometry(args, bar.time, placement); return g.center + g.half >= 0 && g.center - g.half <= args.coords.width; });
  if (!visible.length) return null;
  const g = footprintBarGeometry(args, visible[0].time, placement);
  return planFootprintText(ctx, resolveFootprint(style), visible.flatMap(bar => bar.levels), { left: g.center - g.half, right: g.center + g.half, axis: g.center },
    row => Math.max(1, Math.abs(args.coords.priceToY(row.upperPrice ?? row.price + step, args.scale, args.bounds) - args.coords.priceToY(row.price, args.scale, args.bounds)) - 1), args.theme.fontFamily ?? "Arial");
}
/** Side candle, classified volume cells and a total-volume POC box in every mode. */
export function paintFootprintBar(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, bar: FootprintBar, candle: Pick<OHLCV, "open" | "high" | "low" | "close"> | undefined, step: number, style: FootprintPreferences, placement?: FootprintPlacement, normalizationMaximum?: number, cellFontSize?: number, plannedTextSize?: number | null) {
  const { coords, scale, bounds } = args, slot = coords.pxPerBar(), { width, x, center, half } = footprintBarGeometry(args, bar.time, placement), candleX = placement ? x : center - half - 7;
  if (placement ? center + half < 0 || center - half > coords.width : x < -width || x > coords.width + width) return;
  if (!placement && footprintRevealTarget(footprintRawSpacing(args), true) <= .01) {
    if (style.candleVisible && candle) { ctx.save(); paintSideCandle(ctx, args, candle, style, x, footprintCandleHalfWidth(args) * 2); ctx.restore(); }
    return;
  }
  const opacity = placement?.opacity ?? 1;
  if (!(width > 0) || opacity <= .01) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  const settings = resolveFootprint(style);
  if (settings.areaBackground && bar.levels.length) {
    const first = bar.levels[0], last = bar.levels[bar.levels.length - 1];
    const a = coords.priceToY(first.price, scale, bounds), b = coords.priceToY(last.upperPrice ?? last.price + step, scale, bounds);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const [r, g, blue] = tpoColorRgba(args.theme.background ?? "#131722");
      ctx.fillStyle = settings.areaBackgroundColor === "rgba(178,181,190,0.06)" && .2126 * r + .7152 * g + .0722 * blue >= 128 ? "rgba(19,23,34,0.06)" : settings.areaBackgroundColor;
      ctx.fillRect(center - half, Math.min(a, b), half * 2, Math.abs(a - b));
    }
  }
  if (style.candleVisible && candle) {
    paintSideCandle(ctx, args, candle, style, candleX, 4);
  }
  const mode = settings.volumeMode;
  const shapes = bar.levels.map(level => level.filtered ? { buy: 0, sell: 0 } : footprintSizes(level, settings.averageTradeSize));
  const maximum = normalizationMaximum ?? shapes.reduce((max, value) => Math.max(max, mode === "total" ? (value.sell ?? 0) + (value.buy ?? 0) :
    mode === "delta" || mode === "absolute-delta" ? Math.abs((value.buy ?? 0) - (value.sell ?? 0)) : Math.max(value.sell ?? 0, value.buy ?? 0)), 0);
  const textColor = footprintTextColor(settings, args.theme);
  const textPlan = cellFontSize !== undefined ? null : plannedTextSize === undefined ? footprintTextPlan(ctx, args, [bar], step, settings, placement) : plannedTextSize;
  if (settings.histogramVisible && maximum > 0 && (mode === "bid-ask" || mode === "delta") && (center + half) - (center - half) >= 10 && bar.levels.length) {
    const first = bar.levels[0], last = bar.levels[bar.levels.length - 1];
    const a = coords.priceToY(last.upperPrice ?? last.price + step, scale, bounds), b = coords.priceToY(first.price, scale, bounds);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      ctx.globalAlpha = .5 * opacity; ctx.strokeStyle = args.theme.textColor; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(center, a); ctx.lineTo(center, b); ctx.stroke();
    }
    ctx.globalAlpha = opacity;
  }
  ctx.textBaseline = "middle";
  for (const [index, level] of bar.levels.entries()) {
    if (level.filtered) continue;
    const shape = shapes[index], bid = shape.sell ?? 0, ask = shape.buy ?? 0;
    const top = coords.priceToY(level.upperPrice ?? level.price + step, scale, bounds), bottom = coords.priceToY(level.price, scale, bounds);
    const height = Math.abs(bottom - top), y = (top + bottom) / 2, rowTop = Math.min(top, bottom), h = Math.max(1, height - 1);
    if (!(height > 0) || !Number.isFinite(height) || rowTop + h < bounds.top || rowTop > bounds.top + bounds.height) continue;
    const sellFlag = level.sellImbalance ?? level.imbalance === "sell";
    const buyFlag = level.buyImbalance ?? level.imbalance === "buy";
    const sellImbalance = settings.imbalanceVisible && sellFlag;
    const buyImbalance = settings.imbalanceVisible && buyFlag;
    for (const rect of footprintModeRects(mode, ask, bid, maximum, center, half, settings, args.theme.background ?? "#131722")) {
      ctx.fillStyle = rect.color; ctx.globalAlpha = opacity * rect.alpha; ctx.fillRect(rect.x, rowTop, rect.width, h);
    }
    ctx.globalAlpha = opacity;
    if (width >= 10 && maximum > 0 && h > settings.imbalanceWidth) {
      const stroke = settings.imbalanceWidth, inset = stroke / 2;
      const outlineWidth = half - (mode === "bid-ask-ladder" ? stroke : inset);
      ctx.lineWidth = stroke;
      // Ladder uses Canvas's signed rectangle width even when the insets cross
      // in a narrow slot; other modes suppress nonpositive half-slot widths.
      if (mode === "bid-ask-ladder" || outlineWidth > 0) {
        if (sellImbalance) { ctx.strokeStyle = settings.imbalanceBidColor; ctx.strokeRect(center - half + inset, rowTop + inset, outlineWidth, h - stroke); }
        if (buyImbalance) { ctx.strokeStyle = settings.imbalanceAskColor; ctx.strokeRect(mode === "bid-ask-ladder" ? center + inset : center, rowTop + inset, outlineWidth, h - stroke); }
      }
    }
    paintFootprintText(ctx, level, settings, { left: center - half, right: center + half, axis: center }, h, y, maximum, args.theme.fontFamily ?? "Arial", textColor, opacity, textPlan, cellFontSize);
  }
  paintFootprintStructure(ctx,args,bar,step,settings,center-half,center+half,opacity,candle);
  paintFootprintStatistics(ctx,args,bar,step,settings,center,half*2,opacity);
  ctx.restore();
}
export function footprintBarGeometry(args: RendererLayerArgs, time: number, placement?: FootprintPlacement) {
  const width = Math.min(180, args.coords.pxPerBar() * .88), x = args.coords.timeToX(time);
  if (placement) return { width: placement.width, x, center: x + placement.offset, half: placement.width / 2 };
  return { width, x, center: x + 4, half: Math.max(1, (width - 14) / 2) };
}

export function paintFootprintInstanceCandles(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, instances: readonly FootprintInstance[], placements: ReadonlyMap<string, FootprintPlacement>, opacity = 1) {
  const owner = instances.find(instance => instance.style.candleVisible); if (!owner) return;
  const modulation = footprintBodyModulation(opacity, instances.map(instance => instance.style.position));
  const width = footprintCandleHalfWidth(args, modulation.candleBodyScale) * 2;
  const range = args.coords.visibleTimeRange(), [from, to] = visibleSlice(args.bars, range.from, range.to);
  ctx.save();
  for (const candle of args.bars.slice(from, to)) paintSideCandle(ctx, args, candle, owner.style, args.coords.timeToX(candle.time), width, modulation.candleBodyAlpha);
  ctx.restore();
}

function paintSideCandle(ctx: CanvasRenderingContext2D, { coords, scale, bounds }: RendererLayerArgs,
  candle: Pick<OHLCV, "open" | "high" | "low" | "close">, style: FootprintPreferences, x: number, width: number, bodyAlpha = 1) {
  const color = candle.close >= candle.open ? style.buyColor : style.sellColor;
  const open = coords.priceToY(candle.open, scale, bounds), close = coords.priceToY(candle.close, scale, bounds);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, coords.priceToY(candle.high, scale, bounds));
  ctx.lineTo(x, coords.priceToY(candle.low, scale, bounds)); ctx.stroke();
  ctx.globalAlpha = bodyAlpha;
  ctx.fillRect(x - width / 2, Math.min(open, close), width, Math.max(1, Math.abs(open - close)));
  ctx.globalAlpha = 1;
}

