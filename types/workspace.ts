import type { ChartType, IndicatorInstance, Timeframe } from "./trading";
export type LayoutId =
  | "single"
  | "two-columns"
  | "two-rows"
  | "three-columns"
  | "four"
  | "six"
  | "eight";
export type WorkspaceTheme = "light" | "dark";
export interface WorkspaceCell {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  chartType: ChartType;
  chartTypeSettings?: import("@/lib/chart/chartTypes").ChartTypeSettings;
  logarithmic?: boolean;
  scaleMode?: import("@/lib/chart/scaleMode").PriceScaleMode;
  legendCollapsed?: boolean;
  seriesPreferences?: import("@/lib/chart/seriesPreferences").SeriesPreferences | null;
  chartAppearance?: import("@/lib/chart/appearance").ChartAppearancePreferences | null;
  chartView?: import("@/lib/chart/viewPreferences").ChartViewPreferences | null;
  statusLine?: import("@/lib/chart/statusLine").StatusLinePreferences;
  indicators: IndicatorInstance[];
}
export interface ChartSync {
  symbol: boolean;
  interval: boolean;
  crosshair: boolean;
  timeRange: boolean;
}
export interface LayoutTemplate {
  id: string;
  name: string;
  layout: LayoutId;
  cells: WorkspaceCell[];
  activeId: string;
  sync: ChartSync;
  savedAt: number;
}
export interface StudyTemplate {
  id: string;
  name: string;
  indicators: IndicatorInstance[];
  savedAt: number;
}
export interface ReplayInfo {
  active: boolean;
  playing: boolean;
  cursorTime: number | null;
  remaining: number;
  intervalMs: number;
  first: number | null;
  last: number | null;
}
export interface ReplayCommand {
  id: number;
  action: "start" | "seek" | "play" | "pause" | "step" | "stop";
  from?: number;
  intervalMs?: number;
}
export interface ViewportLink {
  source: string;
  from: number;
  to: number;
}
