import type { ChartType } from "@/types/trading";

export interface ChartTypeInfo {
  id: ChartType;
  label: string;
  group: "Bars & candles" | "Lines & areas" | "Price action" | "Order flow";
  description: string;
  /** True when Vela paints the style itself; false for registered styles. */
  native: boolean;
  /** Settings the style exposes (see `ChartTypeSettings`). */
  settings?: ("renko" | "range" | "kagi" | "pointfigure" | "linebreak" | "baseline")[];
}

export const CHART_TYPES: ChartTypeInfo[] = [
  { id: "bars", label: "Bars", group: "Bars & candles", description: "OHLC bars", native: true },
  { id: "candles", label: "Candles", group: "Bars & candles", description: "Japanese candlesticks", native: true },
  { id: "hollow", label: "Hollow candles", group: "Bars & candles", description: "Hollow when the close is above the open", native: false },
  { id: "volumecandles", label: "Volume candles", group: "Bars & candles", description: "Candle width follows traded volume", native: false },
  { id: "line", label: "Line", group: "Lines & areas", description: "Close-to-close line", native: true },
  { id: "linemarkers", label: "Line with markers", group: "Lines & areas", description: "Close line with a marker on every bar", native: false },
  { id: "stepline", label: "Step line", group: "Lines & areas", description: "Close as a stepped line", native: false },
  { id: "area", label: "Area", group: "Lines & areas", description: "Filled close line", native: true },
  { id: "hlcarea", label: "HLC area", group: "Lines & areas", description: "Close line with a high/low band", native: false },
  { id: "baseline", label: "Baseline", group: "Lines & areas", description: "Above and below a baseline price", native: true, settings: ["baseline"] },
  { id: "columns", label: "Columns", group: "Lines & areas", description: "Close as columns", native: false },
  { id: "highlow", label: "High-low", group: "Lines & areas", description: "Floating high-to-low bars", native: false },
  { id: "heikinashi", label: "Heikin Ashi", group: "Price action", description: "Smoothed trend candles", native: true },
  { id: "renko", label: "Renko", group: "Price action", description: "Fixed-size bricks, time ignored", native: false, settings: ["renko"] },
  { id: "linebreak", label: "Line break", group: "Price action", description: "Three-line break reversals", native: false, settings: ["linebreak"] },
  { id: "kagi", label: "Kagi", group: "Price action", description: "Reversal lines of varying thickness", native: false, settings: ["kagi"] },
  { id: "range", label: "Range bars", group: "Price action", description: "Every bar spans the same price range", native: false, settings: ["range"] },
  { id: "pointfigure", label: "Point & figure", group: "Price action", description: "Columns of X and O boxes", native: false, settings: ["pointfigure"] },
  { id: "footprint", label: "Footprint", group: "Order flow", description: "Bid × Ask, total volume or delta at each price", native: false },
  { id: "tpo", label: "TPO / Market Profile", group: "Order flow", description: "Time price opportunities", native: false },
];

export const CHART_TYPE_IDS: string[] = CHART_TYPES.map((t) => t.id);

export function chartTypeInfo(id: string): ChartTypeInfo | undefined {
  return CHART_TYPES.find((t) => t.id === id);
}

export interface ChartTypeSettings {
  renko: import("./transforms").BoxSizing;
  range: import("./transforms").BoxSizing;
  kagi: import("./transforms").BoxSizing;
  pointfigure: { sizing: import("./transforms").BoxSizing; reversal: number };
  linebreak: { lines: number };
  baseline: { levelPercent: number };
}

export const DEFAULT_CHART_TYPE_SETTINGS: ChartTypeSettings = {
  renko: { mode: "atr", length: 14 },
  range: { mode: "percent", percent: 0.25 },
  kagi: { mode: "percent", percent: 1 },
  pointfigure: { sizing: { mode: "percent", percent: 0.5 }, reversal: 3 },
  linebreak: { lines: 3 },
  baseline: { levelPercent: 50 },
};
