import type { DrawingTypeKey } from "@luxalgo/vela";
import type { AlertRateFields, AlertLifecycleFields } from "./alerts";
/** Interval id such as `15m`, `45s`, `3D` or `100T`; see lib/market/intervals. */
export type Timeframe = string;
export type ChartType =
  | "candles"
  | "bars"
  | "hollow"
  | "volumecandles"
  | "line"
  | "linemarkers"
  | "stepline"
  | "area"
  | "hlcarea"
  | "baseline"
  | "columns"
  | "highlow"
  | "heikinashi"
  | "renko"
  | "linebreak"
  | "kagi"
  | "range"
  | "pointfigure"
  | "footprint"
  | "tpo";
export type FeedMode = "auto" | "simulation";
export type FeedStatus = "connecting" | "live" | "reconnecting" | "simulation";
export interface CandleRecovery {
  status: "refreshing" | "loading" | "retrying" | "unavailable";
  from: number;
  message?: string;
}
export type AssetCategory =
  | "All"
  | "Layer 1"
  | "DeFi"
  | "Meme"
  | "Infrastructure";
export interface MarketSymbol {
  symbol: string;
  base: string;
  name: string;
  category: AssetCategory;
  seedPrice: number;
  color: string;
}
export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface Tick {
  id: string;
  symbol: string;
  time: number;
  price: number;
  quantity: number;
  side: "buy" | "sell";
  simulated: boolean;
  /** Sequential trade number (exchange aggregate id, or a simulation counter). */
  seq?: number;
  /** Number of underlying exchange prints in this execution/aggregate. Missing means unknown, never one. */
  tradeCount?: number;
}
export interface TimeSalesFilters {
  maximumValue?: number;
  side: "all" | "buy" | "sell";
  minimum: number;
  unit: "quantity" | "price-times-quantity";
}
export interface TimeSalesSnapshot {
  symbol: string;
  simulated: boolean;
  capturedAt: number;
  trades: readonly Readonly<Tick>[];
  rejected: number;
  replayThrough?: number;
  coverage?: string;
}
  export type TimeSalesClusterInterval = 1000 | 60000;
  export interface TimeSalesCluster {
    readonly start: number;
    readonly end: number;
    readonly first: number;
    readonly last: number;
    readonly count: number;
    readonly buys: number;
    readonly sells: number;
    readonly buyQuantity: string;
    readonly sellQuantity: string;
    readonly delta: string;
    readonly low: number;
    readonly high: number;
    readonly weightedPrice: number | null;
    readonly underlyingTradeCount: number | null;
  }
export type QuotePeriod = "24h" | "session" | "observed" | "simulation";
export interface QuoteRange {
  high: number | null;
  low: number | null;
  period: QuotePeriod;
  from: number | null;
  to: number;
  resolution: "ticker" | "1m" | "observed";
  complete: boolean;
  bars?: number;
  expectedBars?: number;
}
export interface QuoteMetrics {
  volume: { base: number | null; quote: number | null; currency: string; period: QuotePeriod; asOf: number };
  range: QuoteRange;
}
export interface Quote {
  symbol: string;
  price: number;
  previous: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  history: number[];
  time: number;
  simulated: boolean;
  metrics?: QuoteMetrics;
  priceBasis?: "trade" | "mid" | "mark" | "simulation" | "provider";
  /** Provider's price observation time is Quote.time; metadata has its own clock. */
  referencePrice?: number | null;
  referenceTime?: number;
}
export interface DepthLevel {
  price: number;
  quantity: number;
}
export interface OrderBook {
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
  time: number;
  simulated: boolean;
}
export type FootprintVolumeMode = "bid-ask" | "bid-ask-ladder" | "total" | "delta" | "absolute-delta";
export interface FootprintLevel {
  /** Display-only volume filter. Raw quantities/counts and the row's price slot remain intact. */
  filtered?: boolean;
  /** Canonical execution-grid identity and upper boundary; absent in legacy external rows. */
  rowIndex?: number;
  upperPrice?: number;
  price: number;
  buyVolume: number;
  sellVolume: number;
  /** Explicit underlying print counts; null/absent means unavailable. */
  buyCount?: number | null;
  sellCount?: number | null;
  imbalance: "buy" | "sell" | null;
  buyImbalance?: boolean;
  sellImbalance?: boolean;
}
export interface FootprintBar {
  time: number;
  levels: FootprintLevel[];
  delta: number;
  volume: number;
  poc: number;
}
/** Prefix delta of observed executions, reset to zero at this candle's first observation. */
export interface FootprintDeltaPath {
  high: number;
  low: number;
  close: number;
  executions: number;
  first: number;
  last: number;
  ordering: "time-sequence-id";
}
export interface VolumeProfileRow {
  price: number;
  buy: number;
  sell: number;
  total: number;
}
export interface TPOLevel {
  price: number;
  periods: string[];
  count: number;
}
export type IndicatorKind = "native" | "pine" | "orderflow";
export interface IndicatorDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  category:
    | "Trend"
    | "Momentum"
    | "Volatility"
    | "Volume"
    | "Order flow"
    | "Pine Script"
    | "Derived";
  kind: IndicatorKind;
  nativeId?: string;
  script?: string;
  defaults: Record<string, number | string | boolean>;
}
export interface IndicatorInstance {
  id: string;
  definitionId: string;
  name: string;
  visible: boolean;
  inputs: Record<string, number | string | boolean>;
  /** Host legend only; native plots and Data window stay available. Defaults to true. */
  valuesInStatusLine?: boolean;
  /** Numeric plot labels on their native scale; independent of the legend and Data window. */
  valuesOnPriceScale?: boolean;
  color: string;
  lineWidth: number;
  source: "close" | "open" | "high" | "low" | "hl2" | "hlc3";
  script?: string;
  error?: string;
}
/** A second series plotted over the chart: another symbol or a formula. */
export interface CompareSeries {
  id: string;
  kind: "symbol" | "formula";
  /** Legend text, e.g. `ETHUSDT` or `BTCUSDT / ETHUSDT`. */
  label: string;
  symbol?: string;
  expression?: string;
  color: string;
  lineWidth: number;
  /** `relative` rebases to the first visible bar, `own` fits its own scale. */
  scale: "relative" | "own" | "price";
  visible: boolean;
  error?: string;
}
export type WatchFlag = "red" | "orange" | "yellow" | "green" | "blue" | "purple";
export interface Watchlist {
  id: string;
  name: string;
  /** Symbols plus optional `###Section` header entries. */
  symbols: string[];
  /** Colored flags by symbol. */
  flags?: Record<string, WatchFlag>;
}
export type AlertCondition =
  | "crossing"
  | "crossing_up"
  | "crossing_down"
  | "entering_band"
  | "exiting_band";
export type AlertStatus = "active" | "paused" | "triggered" | "expired" | "stopped";
export interface TpoAlertLevel {
  symbol: string;
  timeframe: Timeframe;
  level: "poc" | "vah" | "val";
  sessionStart: number;
  sessionEnd: number;
  price: number;
}
export interface TpoAlertCandidate extends TpoAlertLevel { epoch: number }
/** Immutable source of a price alert; never follows later profiles. */
export interface TpoAlertReference extends TpoAlertLevel { simulated: boolean }
export interface PriceAlert extends AlertRateFields,AlertLifecycleFields {
  id: string;
  name: string;
  symbol: string;
  condition: AlertCondition;
  price: number;
  upperPrice?: number;
  status: AlertStatus;
  repeat: boolean;
  trigger?: import("./alerts").AlertTrigger;
  expiresAt?: number;
  frequency: "tick" | "close";
  timeframe: Timeframe;
  sound: boolean;
  browserNotification: boolean;
  createdAt: number;
  lastTriggeredAt?: number;
  lastTriggeredBar?: number;
  simulated: boolean;
  tpoReference?: TpoAlertReference;
}
export interface AlertLog {
  id: string;
  alertId: string;
  name: string;
  symbol: string;
  price: number;
  time: number;
  simulated: boolean;
  condition: AlertCondition;
}
export interface ToastMessage {
  id: string;
  title: string;
  message: string;
  tone: "success" | "error" | "info";
  time: number;
}
export type BottomTab =
  | "overview"
  | "pine"
  | "strategy"
  | "orderflow"
  | "trading"
  | "dom"
  | "portfolio"
  | "screener"
  | "news"
  | "calendar"
  | "heatmap"
  | "terminal";
export type DrawingTool =
  | DrawingTypeKey
  | "cursor"
  | "trendline"
  | "horizontal-ray"
  | "fib-retracement"
  | "long-position"
  | "anchored-vwap"
  | "fixed-profile"
  | "fixed-tails";
export interface DrawingPreferences {
  snap: "off" | "weak" | "strong";
  stay: boolean;
  favorites: DrawingTypeKey[];
  lastTools: Record<string, DrawingTypeKey>;
  toolDefaults: Record<string, unknown>;
  toolTemplates: Record<string, unknown>;
}
export type RangeShortcut = "1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "ALL";
export interface CrosshairPoint {
  time: number;
  price: number | null;
  source: string;
  symbol?: string;
}
export interface ChartCommand {
  snapshotScope?:"chart"|"layout";
  id: number;
  kind:
    | "range"
    | "undo"
    | "redo"
    | "clear"
    | "fit"
    | "recent"
    | "settings"
    | "snapshot"
    | "csv"
    | "goto";
  value?: RangeShortcut;
  /** Target time for `goto` (epoch ms). */
  time?: number;
  /** End of an explicit custom date range for `goto`. */
  to?:number;
}
export interface AlertDraft {
  ruleCondition?: import("./alerts").Condition;
  price?: number;
  symbol?:string;
  timeframe?:Timeframe;
  source?:"market"|"simulation"|"manual"|"tpo";
  name?:string;
  tpoReference?:TpoAlertReference;
  observedAt?:number;
  upperPrice?: number;
  id?: string;
  drawingId?: string;
}

