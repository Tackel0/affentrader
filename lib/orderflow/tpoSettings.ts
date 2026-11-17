import type { ChartTypeSettingsSection } from "@luxalgo/vela";
import { validChartColor } from "@/lib/chart/appearance";
import { isValidZone, TIMEZONES } from "@/lib/timezones";
import { validSessionPeriod, type SessionPeriod } from "./sessionPeriods";
import { emptyTpoOperations, validTpoOperations, type TpoOperations } from "./tpoOperations";
import { TPO_TRADING_HOURS, validHHMM, validTpoTradingHours, type TpoTradingHours } from "./tpoTradingHours";
import { TPO_TIME_THEMES, TPO_DELTA_THEMES, validTpoTimeTheme, validTpoDeltaTheme, type TpoTimeTheme, type TpoDeltaTheme } from "./tpoTimeColors";
import { TPO_COLOR_MODES, validTpoColorBy, type TpoColorBy } from "./tpoMetrics";

export interface TpoPreferences {
  valueAreaFill?: boolean; valueAreaFillColor?: string; pocWidth?: number;
  colorBy?: TpoColorBy;
  deltaTheme?: TpoDeltaTheme; deltaUpColor?: string; deltaDownColor?: string;
  metricTheme?: TpoTimeTheme;
  metricColor1?: string; metricColor2?: string; metricColor3?: string; metricColor4?: string;
  outsideVaOpacity?: number;
  tradingHours?: TpoTradingHours;
  customStart?: number;
  customEnd?: number;
  sessionOperations?: TpoOperations;
  rowSize: number;
  targetRows: number;
  blockMinutes: "5" | "15" | "30" | "60" | "240";
  sessionPeriod?: SessionPeriod;
  sessionZone: string;
  sessionStartMinutes: number;
  sessionMinutes: number;
  weekdaysOnly: boolean;
  valueAreaPercent: number;
  lettersVisible: boolean;
  histogramVisible: boolean;
  candlesVisible: boolean;
  pocVisible: boolean;
  valueAreaVisible: boolean;
  boundariesVisible: boolean;
  splitPeriods: boolean;
  textColorAuto: boolean;
  valueAreaColor: string;
  outsideColor: string;
  pocColor: string;
  boundaryColor: string;
  textColor: string;
  ibBlocks?: number;
  ibMinutes?: number;
  ibVisible?: boolean;
  ibColor?: string;
  ibExtensionVisible?: boolean;
  ibExtensionPercent?: number;
  poorHighVisible?: boolean;
  poorLowVisible?: boolean;
  singlePrintsVisible?: boolean;
  poorColor?: string;
  singlePrintColor?: string;
  extendPoc?: boolean;
  extendVah?: boolean;
  extendVal?: boolean;
  extensionPocColor?: string;
  extensionVaColor?: string;
  extensionUntilTouch?: boolean;
  openMarkerVisible?: boolean;
  closeMarkerVisible?: boolean;
  midpointVisible?: boolean;
  openMarkerColor?: string;
  closeMarkerColor?: string;
  midpointColor?: string;
  pocLabelVisible?: boolean;
  vahLabelVisible?: boolean;
  valLabelVisible?: boolean;
  tooltipVisible?: boolean;
  ladderVisible?: boolean; ladderPosition?: "Left" | "Right"; ladderRows?: number; ladderWidthPercent?: number; ladderValueAreaPercent?: number;
  ladderPocVisible?: boolean; ladderVaVisible?: boolean; ladderLabelsVisible?: boolean;
  ladderColor?: string; ladderOutsideColor?: string; ladderPocColor?: string; ladderVaColor?: string;
}
export const defaultTpo = (): TpoPreferences => ({ tradingHours: "Full day", customStart: 0, customEnd: 0, sessionOperations: emptyTpoOperations(), rowSize: 0, targetRows: 80, blockMinutes: "30", sessionPeriod: "Day", sessionZone: "UTC",
  sessionStartMinutes: 0, sessionMinutes: 1440, weekdaysOnly: false, valueAreaPercent: 70, lettersVisible: true,
  histogramVisible: true, candlesVisible: true, pocVisible: true, valueAreaVisible: true, boundariesVisible: true,
  valueAreaFill: false, valueAreaFillColor: "rgba(178,181,190,0.08)", pocWidth: 2,
  colorBy: "Time", deltaTheme: "classic", deltaUpColor: "#089981", deltaDownColor: "#f23645",
  metricTheme: "simple", metricColor1: "#4a505e", metricColor2: "#6b7385", metricColor3: "#3d6fd4", metricColor4: "#1e4fd6", outsideVaOpacity: 45,
  splitPeriods: false, textColorAuto: true, valueAreaColor: "#2962ff", outsideColor: "#787b86", pocColor: "#b2b5be",
  boundaryColor: "#ff9800", textColor: "#d1d4dc", ibBlocks: 2, ibMinutes: 60, ibVisible: true, ibColor: "#00bcd4", ibExtensionVisible: false, ibExtensionPercent: 100,
  poorHighVisible: false, poorLowVisible: false, singlePrintsVisible: false, poorColor: "#ff9800", singlePrintColor: "#e040fb",
  extendPoc: false, extendVah: false, extendVal: false, extensionPocColor: "#ff9800", extensionVaColor: "#26a69a", extensionUntilTouch: false,
  openMarkerVisible: false, closeMarkerVisible: false, midpointVisible: false, openMarkerColor: "#26a69a", closeMarkerColor: "#ef5350", midpointColor: "#ff9800",
  pocLabelVisible: false, vahLabelVisible: false, valLabelVisible: false, tooltipVisible: true,
  ladderVisible: false, ladderPosition: "Right", ladderRows: 24, ladderWidthPercent: 30, ladderValueAreaPercent: 70,
  ladderPocVisible: true, ladderVaVisible: true, ladderLabelsVisible: false, ladderColor: "#2962ff", ladderOutsideColor: "#787b86", ladderPocColor: "#ff9800", ladderVaColor: "#9598a1" });
const ladderNumbers = { ladderRows: [1, 500], ladderWidthPercent: [1, 100], ladderValueAreaPercent: [1, 100] } as const;
const timeColors = ["metricColor1", "metricColor2", "metricColor3", "metricColor4"] as const;
const validOutsideOpacity = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
const validPocWidth = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
const ladderToggles = ["ladderVisible", "ladderPocVisible", "ladderVaVisible", "ladderLabelsVisible"] as const;
const ladderColors = ["ladderColor", "ladderOutsideColor", "ladderPocColor", "ladderVaColor"] as const;
const ladderNumber = (key: keyof typeof ladderNumbers, v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= ladderNumbers[key][0] && v <= ladderNumbers[key][1];
const markerToggles = ["openMarkerVisible", "closeMarkerVisible", "midpointVisible", "pocLabelVisible", "vahLabelVisible", "valLabelVisible", "tooltipVisible"] as const;
const markerColors = ["openMarkerColor", "closeMarkerColor", "midpointColor"] as const;
const extensionToggles = ["extendPoc", "extendVah", "extendVal", "extensionUntilTouch"] as const;
const extensionColors = ["extensionPocColor", "extensionVaColor"] as const;
const structureToggles = ["poorHighVisible", "poorLowVisible", "singlePrintsVisible"] as const;
const structureColors = ["poorColor", "singlePrintColor"] as const;
const numbers = { rowSize: [0, 1e9], targetRows: [20, 500], sessionStartMinutes: [0, 1439], sessionMinutes: [5, 1440], valueAreaPercent: [1, 100] } as const;
const toggles = ["weekdaysOnly", "lettersVisible", "histogramVisible", "candlesVisible", "pocVisible", "valueAreaVisible", "boundariesVisible", "splitPeriods", "textColorAuto"] as const;
const colors = ["valueAreaColor", "outsideColor", "pocColor", "boundaryColor", "textColor"] as const;
const bag = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const validNumber = (key: keyof typeof numbers, value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= numbers[key][0] && value <= numbers[key][1] && (key === "rowSize" || Number.isInteger(value));
const validIbMinutes = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 11520;
const validIbBlocks = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 48;
/** Migrate saved block-count settings once; new minute settings do not follow block edits. */
export function tpoIbMinutes(value: Pick<TpoPreferences, "ibMinutes" | "ibBlocks" | "blockMinutes">): number {
  if (validIbMinutes(value.ibMinutes)) return value.ibMinutes;
  return (validIbBlocks(value.ibBlocks) ? value.ibBlocks : 2) * Number(value.blockMinutes);
}
export function validTpo(value: unknown): value is TpoPreferences {
  const optional = ["tradingHours", "customStart", "customEnd", "sessionOperations", "sessionPeriod", "ibBlocks", "ibMinutes", "ibVisible", "ibColor", "ibExtensionVisible", "ibExtensionPercent", ...structureToggles, ...structureColors, ...extensionToggles, ...extensionColors, ...markerToggles, ...markerColors, "ladderPosition", ...Object.keys(ladderNumbers), ...ladderToggles, ...ladderColors];
  optional.push("metricTheme", "outsideVaOpacity", ...timeColors, "colorBy", "deltaTheme", "deltaUpColor", "deltaDownColor", "valueAreaFill", "valueAreaFillColor", "pocWidth");
  return bag(value) && Object.keys(value).length === Object.keys(defaultTpo()).length - optional.length + optional.filter(key => Object.hasOwn(value, key)).length &&
    (!Object.hasOwn(value, "valueAreaFill") || typeof value.valueAreaFill === "boolean") &&
    (!Object.hasOwn(value, "valueAreaFillColor") || validChartColor(value.valueAreaFillColor)) &&
    (!Object.hasOwn(value, "pocWidth") || validPocWidth(value.pocWidth)) &&
    (!Object.hasOwn(value, "colorBy") || validTpoColorBy(value.colorBy)) &&
    (!Object.hasOwn(value, "deltaTheme") || validTpoDeltaTheme(value.deltaTheme)) &&
    ["deltaUpColor", "deltaDownColor"].every(key => !Object.hasOwn(value, key) || validChartColor(value[key])) &&
    (!Object.hasOwn(value, "metricTheme") || validTpoTimeTheme(value.metricTheme)) &&
    (!Object.hasOwn(value, "outsideVaOpacity") || validOutsideOpacity(value.outsideVaOpacity)) &&
    timeColors.every(key => !Object.hasOwn(value, key) || validChartColor(value[key])) &&
    Object.keys(value).every(key => Object.hasOwn(defaultTpo(), key)) &&
    (!Object.hasOwn(value, "tradingHours") || validTpoTradingHours(value.tradingHours)) &&
    ["customStart", "customEnd"].every(key => !Object.hasOwn(value, key) || validHHMM(value[key])) &&
    (!Object.hasOwn(value, "sessionPeriod") || validSessionPeriod(value.sessionPeriod)) &&
    (!Object.hasOwn(value, "sessionOperations") || validTpoOperations(value.sessionOperations)) &&
    (!Object.hasOwn(value, "ibBlocks") || typeof value.ibBlocks === "number" && Number.isInteger(value.ibBlocks) && value.ibBlocks >= 1 && value.ibBlocks <= 48) &&
    (!Object.hasOwn(value, "ibMinutes") || validIbMinutes(value.ibMinutes)) &&
    (!Object.hasOwn(value, "ibVisible") || typeof value.ibVisible === "boolean") && (!Object.hasOwn(value, "ibColor") || validChartColor(value.ibColor)) &&
    (!Object.hasOwn(value, "ibExtensionVisible") || typeof value.ibExtensionVisible === "boolean") &&
    (!Object.hasOwn(value, "ibExtensionPercent") || typeof value.ibExtensionPercent === "number" && Number.isInteger(value.ibExtensionPercent) && value.ibExtensionPercent >= 1 && value.ibExtensionPercent <= 500) &&
    structureToggles.every(key => !Object.hasOwn(value, key) || typeof value[key] === "boolean") &&
    structureColors.every(key => !Object.hasOwn(value, key) || validChartColor(value[key])) &&
    extensionToggles.every(key => !Object.hasOwn(value, key) || typeof value[key] === "boolean") &&
    extensionColors.every(key => !Object.hasOwn(value, key) || validChartColor(value[key])) &&
    markerToggles.every(key => !Object.hasOwn(value, key) || typeof value[key] === "boolean") &&
    markerColors.every(key => !Object.hasOwn(value, key) || validChartColor(value[key])) &&
    (!Object.hasOwn(value, "ladderPosition") || value.ladderPosition === "Left" || value.ladderPosition === "Right") &&
    (Object.keys(ladderNumbers) as Array<keyof typeof ladderNumbers>).every(key => !Object.hasOwn(value, key) || ladderNumber(key, value[key])) &&
    ladderToggles.every(key => !Object.hasOwn(value, key) || typeof value[key] === "boolean") && ladderColors.every(key => !Object.hasOwn(value, key) || validChartColor(value[key])) &&
    Object.keys(numbers).every(key => validNumber(key as keyof typeof numbers, value[key])) &&
    toggles.every(key => typeof value[key] === "boolean") && colors.every(key => validChartColor(value[key])) &&
    ["5", "15", "30", "60", "240"].includes(String(value.blockMinutes)) && typeof value.blockMinutes === "string" &&
    typeof value.sessionZone === "string" && value.sessionZone.length <= 64 && isValidZone(value.sessionZone);
}
export function resolveTpo(value: unknown): TpoPreferences {
  const result = defaultTpo(); if (!bag(value)) return result;
  if (typeof value.valueAreaFill === "boolean") result.valueAreaFill = value.valueAreaFill;
  if (validChartColor(value.valueAreaFillColor)) result.valueAreaFillColor = value.valueAreaFillColor;
  if (validPocWidth(value.pocWidth)) result.pocWidth = value.pocWidth;
  if (validTpoColorBy(value.colorBy)) result.colorBy = value.colorBy;
  if (validTpoDeltaTheme(value.deltaTheme)) result.deltaTheme = value.deltaTheme;
  if (validChartColor(value.deltaUpColor)) result.deltaUpColor = value.deltaUpColor;
  if (validChartColor(value.deltaDownColor)) result.deltaDownColor = value.deltaDownColor;
  if (validTpoTimeTheme(value.metricTheme)) result.metricTheme = value.metricTheme;
  if (validOutsideOpacity(value.outsideVaOpacity)) result.outsideVaOpacity = value.outsideVaOpacity;
  for (const key of timeColors) if (validChartColor(value[key])) result[key] = value[key];
  if (validTpoTradingHours(value.tradingHours)) result.tradingHours = value.tradingHours;
  // Preserve numeric edits until the calendar validates HHMM. Silently changing
  // 1260 to midnight would paint a different session from the entered window.
  if (typeof value.customStart === "number") result.customStart = value.customStart;
  if (typeof value.customEnd === "number") result.customEnd = value.customEnd;
  for (const key of Object.keys(ladderNumbers) as Array<keyof typeof ladderNumbers>) if (ladderNumber(key, value[key])) result[key] = value[key];
  for (const key of ladderToggles) if (typeof value[key] === "boolean") result[key] = value[key];
  for (const key of ladderColors) if (validChartColor(value[key])) result[key] = value[key];
  if (value.ladderPosition === "Left" || value.ladderPosition === "Right") result.ladderPosition = value.ladderPosition;
  if (validTpoOperations(value.sessionOperations)) result.sessionOperations = structuredClone(value.sessionOperations);
  if (validSessionPeriod(value.sessionPeriod)) result.sessionPeriod = value.sessionPeriod;
  for (const key of Object.keys(numbers) as Array<keyof typeof numbers>) if (validNumber(key, value[key])) result[key] = value[key];
  for (const key of toggles) if (typeof value[key] === "boolean") result[key] = value[key];
  for (const key of colors) if (validChartColor(value[key])) result[key] = value[key];
  for (const key of structureToggles) if (typeof value[key] === "boolean") result[key] = value[key];
  for (const key of structureColors) if (validChartColor(value[key])) result[key] = value[key];
  for (const key of extensionToggles) if (typeof value[key] === "boolean") result[key] = value[key];
  for (const key of extensionColors) if (validChartColor(value[key])) result[key] = value[key];
  for (const key of markerToggles) if (typeof value[key] === "boolean") result[key] = value[key];
  for (const key of markerColors) if (validChartColor(value[key])) result[key] = value[key];
  if (typeof value.blockMinutes === "string" && ["5", "15", "30", "60", "240"].includes(value.blockMinutes)) result.blockMinutes = value.blockMinutes as TpoPreferences["blockMinutes"];
  if (typeof value.sessionZone === "string" && value.sessionZone.length <= 64 && isValidZone(value.sessionZone)) result.sessionZone = value.sessionZone;
  if (typeof value.ibBlocks === "number" && Number.isInteger(value.ibBlocks) && value.ibBlocks >= 1 && value.ibBlocks <= 48) result.ibBlocks = value.ibBlocks;
  result.ibMinutes = validIbMinutes(value.ibMinutes) ? value.ibMinutes : Object.hasOwn(value, "ibMinutes") ? 60
    : validTpo(value) || validIbBlocks(value.ibBlocks) ? tpoIbMinutes({ blockMinutes: result.blockMinutes, ibBlocks: result.ibBlocks }) : 60;
  if (typeof value.ibVisible === "boolean") result.ibVisible = value.ibVisible;
  if (validChartColor(value.ibColor)) result.ibColor = value.ibColor;
  if (typeof value.ibExtensionVisible === "boolean") result.ibExtensionVisible = value.ibExtensionVisible;
  if (typeof value.ibExtensionPercent === "number" && Number.isInteger(value.ibExtensionPercent) && value.ibExtensionPercent >= 1 && value.ibExtensionPercent <= 500) result.ibExtensionPercent = value.ibExtensionPercent;
  return result;
}
export function tpoSettings(): ChartTypeSettingsSection {
  const d = defaultTpo();
  return { title: "TPO / Market Profile", placement: "after-symbol", visibility: "active", rows: [
    { kind: "heading", label: "Session" },
    { kind: "select", key: "sessionPeriod", label: "Session period", defval: "Day", options: ["Day", "Week", "Month"] },
    { kind: "select", key: "tradingHours", label: "Trading hours", defval: d.tradingHours!, options: [...TPO_TRADING_HOURS], when: { key: "sessionPeriod", equals: "Day" } },
    { kind: "number", key: "customStart", label: "Custom start (UTC HHMM)", defval: 0, min: 0, max: 2400, step: 1, when: [{ key: "sessionPeriod", equals: "Day" }, { key: "tradingHours", equals: "Custom" }] },
    { kind: "number", key: "customEnd", label: "Custom end (UTC HHMM)", defval: 0, min: 0, max: 2400, step: 1, when: [{ key: "sessionPeriod", equals: "Day" }, { key: "tradingHours", equals: "Custom" }] },
    { kind: "row", label: "Hours basis", controls: [{ kind: "hint", text: "Full day inherits the chart session. Explicit Yahoo windows load their own regular/extended session candles. RTH/ETH use source calendar windows when available; named/Custom windows use fixed UTC. Other venues retain loaded candles and the configured clock fallback. Missing source hours remain unavailable." }] },
    { kind: "select", key: "sessionZone", label: "Day session time zone", defval: d.sessionZone, when: [{ key: "sessionPeriod", equals: "Day" }, { key: "tradingHours", anyOf: ["Full day", "Regular hours (RTH)", "Extended hours (ETH)"] }],
      options: [["exchange", "Exchange"], ["local", "Computer"], ...TIMEZONES.map(zone => [zone.id, zone.label] as const)] },
    { kind: "number", key: "sessionStartMinutes", label: "Start (minutes after midnight)", defval: 0, min: 0, max: 1439, step: 15, when: [{ key: "sessionPeriod", equals: "Day" }, { key: "tradingHours", anyOf: ["Full day", "Regular hours (RTH)", "Extended hours (ETH)"] }] },
    { kind: "number", key: "sessionMinutes", label: "Session length (minutes)", defval: 1440, min: 5, max: 1440, step: 5, when: [{ key: "sessionPeriod", equals: "Day" }, { key: "tradingHours", anyOf: ["Full day", "Regular hours (RTH)", "Extended hours (ETH)"] }] },
    { kind: "toggle", key: "weekdaysOnly", label: "Weekdays only", defval: false, when: [{ key: "sessionPeriod", equals: "Day" }, { key: "tradingHours", anyOf: ["Full day", "Regular hours (RTH)", "Extended hours (ETH)"] }] },
    { kind: "select", key: "blockMinutes", label: "TPO block (minutes)", defval: "30", options: ["5", "15", "30", "60", "240"] },
    { kind: "row", label: "Period basis", controls: [{ kind: "hint", text: "Week/month use UTC calendar periods. Day time zone, hours and weekdays apply only to Day." }] },
    { kind: "row", label: "Data basis", controls: [{ kind: "hint", text: "Loaded OHLC only." }] },
    { kind: "heading", label: "Initial balance" },
    { kind: "toggle", key: "ibVisible", label: "Initial balance range", defval: true,
      colors: [{ key: "ibColor", label: "Initial balance color", defval: "#00bcd4" }] },
    { kind: "number", key: "ibMinutes", label: "Initial balance (minutes)", defval: 60, min: 1, max: 11520, step: 1 },
    { kind: "row", label: "Initial balance basis", controls: [{ kind: "hint", text: "Opening minutes, independent of TPO blocks. Only whole loaded candles inside this window contribute; choose a finer chart interval for unaligned boundaries." }] },
    { kind: "toggle", key: "ibExtensionVisible", label: "Initial balance extensions", defval: false },
    { kind: "number", key: "ibExtensionPercent", label: "Extension beyond IB (%)", defval: 100, min: 1, max: 500, step: 1 },
    { kind: "row", label: "Extension basis", controls: [{ kind: "hint", text: "Completed IB only: high + range × %, low − range × %." }] },
    { kind: "heading", label: "Price levels" },
    { kind: "number", key: "rowSize", label: "Price row size (0 = auto)", defval: 0, min: 0, max: 1e9, step: .01 },
    { kind: "number", key: "targetRows", label: "Auto rows per session", defval: 80, min: 20, max: 500, step: 1 },
    { kind: "number", key: "valueAreaPercent", label: "Value area (%)", defval: 70, min: 1, max: 100, step: 1 },
    { kind: "heading", label: "Completed profile extensions" },
    { kind: "toggle", key: "extendPoc", label: "Extend completed POC", defval: false,
      colors: [{ key: "extensionPocColor", label: "Extended POC color", defval: "#ff9800" }] },
    { kind: "toggle", key: "extendVah", label: "Extend completed VAH", defval: false,
      colors: [{ key: "extensionVaColor", label: "Extended value area color", defval: "#26a69a" }] },
    { kind: "toggle", key: "extendVal", label: "Extend completed VAL", defval: false },
    { kind: "toggle", key: "extensionUntilTouch", label: "Stop extensions at first observed touch", defval: false },
    { kind: "row", label: "Touch basis", controls: [{ kind: "hint", text: "Inclusive loaded OHLC ranges after session end. Missing candles and price gaps do not prove a touch or an untouched history." }] },
    { kind: "row", label: "Extension coverage", controls: [{ kind: "hint", text: "Fully loaded completed sessions only. Continue right from session end; developing and incomplete profiles are excluded." }] },
    { kind: "heading", label: "Profile structure" },
    { kind: "toggle", key: "poorHighVisible", label: "Poor high", defval: false,
      colors: [{ key: "poorColor", label: "Poor extreme color", defval: "#ff9800" }] },
    { kind: "toggle", key: "poorLowVisible", label: "Poor low", defval: false },
    { kind: "toggle", key: "singlePrintsVisible", label: "Interior single-print zones", defval: false,
      colors: [{ key: "singlePrintColor", label: "Single-print color", defval: "#e040fb" }] },
    { kind: "row", label: "Structure basis", controls: [{ kind: "hint", text: "Loaded OHLC rows. Interior single-block runs exclude tails and empty price gaps; developing profiles can change." }] },
    { kind: "heading", label: "Display" },
    { kind: "select", key: "colorBy", label: "Color row by", defval: "Time", options: TPO_COLOR_MODES },
    { kind: "select", key: "deltaTheme", label: "Delta theme", defval: "classic", options: [...Object.keys(TPO_DELTA_THEMES).map(key => [key, key[0].toUpperCase() + key.slice(1)] as [string, string]), ["custom", "Custom"]], when: { key: "colorBy", equals: "Delta" } },
    { kind: "color", key: "deltaUpColor", label: "Delta buy color", defval: "#089981", when: [{ key: "colorBy", equals: "Delta" }, { key: "deltaTheme", equals: "custom" }] },
    { kind: "color", key: "deltaDownColor", label: "Delta sell color", defval: "#f23645", when: [{ key: "colorBy", equals: "Delta" }, { key: "deltaTheme", equals: "custom" }] },
    { kind: "row", label: "Metric coverage", controls: [{ kind: "hint", text: "Volume/count/delta use classified executions only. Missing rows or unknown print counts fall back to Time coloring; observed history remains partial." }] },
    { kind: "select", key: "metricTheme", label: "Metric color theme", defval: "simple", options: [...Object.keys(TPO_TIME_THEMES).map(key => [key, key[0].toUpperCase() + key.slice(1)] as [string, string]), ["custom", "Custom"]], when: { key: "colorBy", anyOf: ["Time", "Volume", "Trades count"] } },
    ...timeColors.map((key, i) => ({ kind: "color" as const, key, label: ["Low / session open color", "Medium-low / early color", "Medium-high / late color", "High / session close color"][i], defval: d[key]!, when: [{ key: "metricTheme", equals: "custom" }, { key: "colorBy", anyOf: ["Time", "Volume", "Trades count"] }] })),
    { kind: "number", key: "outsideVaOpacity", label: "Outside VA opacity (%)", defval: 45, min: 0, max: 100, step: 5 },
    { kind: "heading", label: "Volume profile ladder" },
    { kind: "toggle", key: "ladderVisible", label: "Volume profile ladder", defval: false },
    { kind: "select", key: "ladderPosition", label: "Volume ladder position", defval: "Right", options: ["Left", "Right"] },
    { kind: "number", key: "ladderRows", label: "Volume ladder rows", defval: 24, min: 1, max: 500, step: 1 },
    { kind: "number", key: "ladderWidthPercent", label: "Volume ladder width (%)", defval: 30, min: 1, max: 100, step: 1 },
    { kind: "number", key: "ladderValueAreaPercent", label: "Volume ladder value area (%)", defval: 70, min: 1, max: 100, step: 1 },
    { kind: "toggle", key: "ladderPocVisible", label: "Volume ladder POC", defval: true, colors: [{ key: "ladderPocColor", label: "Volume ladder POC color", defval: "#ff9800" }] },
    { kind: "toggle", key: "ladderVaVisible", label: "Volume ladder value area", defval: true, colors: [{ key: "ladderVaColor", label: "Volume ladder VA color", defval: "#9598a1" }] },
    { kind: "toggle", key: "ladderLabelsVisible", label: "Volume ladder price labels", defval: false },
    { kind: "color", key: "ladderColor", label: "Volume ladder color", defval: "#2962ff" },
    { kind: "color", key: "ladderOutsideColor", label: "Volume ladder outside VA", defval: "#787b86" },
    { kind: "row", label: "Volume ladder basis", controls: [{ kind: "hint", text: "OHLCV estimate: candle volume is distributed over its high/low range. No buy/sell aggressor classification." }] },
    { kind: "toggle", key: "tooltipVisible", label: "Block tooltip", defval: true },
    { kind: "toggle", key: "pocLabelVisible", label: "POC price label", defval: false, when: { key: "pocVisible", equals: true } },
    { kind: "toggle", key: "vahLabelVisible", label: "VAH price label", defval: false, when: { key: "valueAreaVisible", equals: true } },
    { kind: "toggle", key: "valLabelVisible", label: "VAL price label", defval: false, when: { key: "valueAreaVisible", equals: true } },
    { kind: "heading", label: "Markers" },
    { kind: "toggle", key: "openMarkerVisible", label: "Session open marker", defval: false,
      colors: [{ key: "openMarkerColor", label: "Open marker color", defval: d.openMarkerColor! }] },
    { kind: "toggle", key: "closeMarkerVisible", label: "Session close marker", defval: false,
      colors: [{ key: "closeMarkerColor", label: "Close marker color", defval: d.closeMarkerColor! }] },
    { kind: "toggle", key: "midpointVisible", label: "Session midpoint", defval: false,
      colors: [{ key: "midpointColor", label: "Midpoint color", defval: d.midpointColor! }] },
    { kind: "row", label: "Marker basis", controls: [{ kind: "hint", text: "Loaded OHLC prices. An unknown opening is omitted; the last loaded close and range midpoint develop with revealed history." }] },
    { kind: "toggle", key: "splitPeriods", label: "Split periods", defval: false },
    { kind: "row", label: "Split placement", when: { key: "splitPeriods", equals: true }, controls: [{ kind: "hint", text: "Each block occupies its actual chart time window above the candles that produced it. Empty periods remain gaps." }] },
    { kind: "toggle", key: "histogramVisible", label: "Profile blocks", defval: true,
      colors: [{ key: "outsideColor", label: "Outside value area", defval: d.outsideColor }] },
    { kind: "toggle", key: "lettersVisible", label: "TPO letters", defval: true },
    { kind: "toggle", key: "candlesVisible", label: "Price candles", defval: true },
    { kind: "toggle", key: "valueAreaVisible", label: "Value area", defval: true,
      colors: [{ key: "valueAreaColor", label: "Value area color", defval: d.valueAreaColor }] },
    { kind: "toggle", key: "valueAreaFill", label: "VA fill", defval: false,
      colors: [{ key: "valueAreaFillColor", label: "VA fill color", defval: d.valueAreaFillColor! }], when: { key: "valueAreaVisible", equals: true } },
    { kind: "toggle", key: "pocVisible", label: "Point of control", defval: true,
      colors: [{ key: "pocColor", label: "Point of control color", defval: d.pocColor }] },
    { kind: "number", key: "pocWidth", label: "POC line width", defval: 2, min: 1, max: 5, step: 1, when: { key: "pocVisible", equals: true } },
    { kind: "toggle", key: "boundariesVisible", label: "Session range", defval: true,
      colors: [{ key: "boundaryColor", label: "Session range color", defval: d.boundaryColor }] },
    { kind: "toggle", key: "textColorAuto", label: "Use theme text color", defval: true },
    { kind: "color", key: "textColor", label: "TPO text", defval: d.textColor },
  ] };
}
