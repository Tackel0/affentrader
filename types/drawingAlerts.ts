export type AlertDrawingType = "trendline" | "ray" | "extendedline" | "infoline" | "trendangle" | "hline" | "hray" | "crossline" | "fibretracement" | "fibextension" | "fibextensiontrend" | "parallelchannel" | "disjointchannel" | "flattopbottom" | "box" | "anchoredvwap" | "regressionchannel";
export interface DrawingAlertGeometry {
  id: string;
  type: AlertDrawingType;
  anchors: { time: number; price: number }[];
  extendLeft: boolean;
  extendRight: boolean;
  /** Captured chart projection; log Fib construction additionally needs logLevels. */
  logarithmic: boolean;
  logLevels?: boolean;
  chartCellId?: string;
  reverse: boolean;
  levels: { ratio: number; enabled: boolean; label?: string }[];
  multiplier: number;
}
export type DrawingAlertTarget = { type: "level"; ratio?: number; series?: "mid" | "upper" | "lower" } | { type: "all_levels" } | { type: "zone"; ratios?: [number, number] };
export type DrawingAlertOperator = "crossing" | "crossing_up" | "crossing_down" | "above" | "below" | "entering" | "exiting" | "inside" | "outside";
export interface DrawingAlertCondition {
  type: "drawing";
  geometry: DrawingAlertGeometry;
  target: DrawingAlertTarget;
  operator: DrawingAlertOperator;
}
export interface NativeAlertDrawing {
  id: string;
  type: string;
  paneId?: string;
  anchors: { time: number; price: number }[];
  style?: { extendLeft?: boolean; extendRight?: boolean };
  props?: Record<string, unknown>;
}
export interface DrawingObservation { fingerprint: string; at: number; price: number; levels: number[]; low?: number; high?: number; active?: boolean; ranges?: [number,number][] }
