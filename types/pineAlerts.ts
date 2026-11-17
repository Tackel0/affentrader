import type { OHLCV, ChartType } from "./trading";
export interface PineAlertSnapshot {
  source: string;
  title: string;
  inputs: Record<string, string | number | boolean>;
  libraries: Record<string, string>;
  selection: { type: "calls" } | { type: "orders" } | { type: "both" } | { type: "condition"; id: string };
  history: number;
  chartType: ChartType;
  timezone: string;
}
export interface PineConditionInfo { id: string; title: string; message: string }
export interface PineInputInfo { id: string; varId?: string; title: string; type: string; defval: string | number | boolean; min?: number; max?: number; options?: (string | number | boolean)[] }
export interface PineAlertInspection { title: string; declaration: "indicator" | "strategy"; hasCalls: boolean; conditions: PineConditionInfo[]; inputs: PineInputInfo[]; fillMessage?: string }
export interface PineSeries {
  symbol: string;
  timeframe: string;
  bars: OHLCV[];
  simulated?: boolean;
  info: Record<string, string | number>;
}
export interface PineFrame { series: PineSeries; now: number; closedBar?: number; observation?: string }
export interface PineOrderFill {
  id: string;
  orderId: string;
  action: "buy" | "sell";
  contracts: number;
  price: number;
  comment: string;
  alertMessage: string;
  positionSize: number;
  previousPositionSize: number;
  leg: string;
}
export interface PineSignal { type: "alert" | "alertcondition" | "order_fill"; id: string; title?: string; message: string; freq?: string; time: number; price: number; confirmed: boolean; bar?: OHLCV; plots: Record<string, number>; fill?: PineOrderFill }
export interface PineAlertResult { inspection: PineAlertInspection; signals: PineSignal[]; lastBar: number; warnings: string[] }
export type PineSeriesLoader = (symbol: string, timeframe: string, count: number) => Promise<PineSeries>;

export interface PineJournalCursor { id: string; sequence: number; time: number; epoch: string }
export interface PineSeriesDelta {
  first: number;
  last: number;
  bars: OHLCV[];
  info?: PineSeries["info"];
  remove?: number[];
  simulated?: boolean;
}
export interface PineJournalRecord {
  sequence: number;
  now: number;
  observation?: string;
  closedBar?: number;
  primary: PineSeriesDelta;
  secondary: { symbol: string; timeframe: string; count: number; delta: PineSeriesDelta }[];
  digest: string;
}
export interface PineJournal {
  version: 1;
  id: string;
  epoch: string;
  revision: string;
  definition: string;
  symbol: string;
  timeframe: string;
  simulated: boolean;
  seed: number;
  bytes: number;
  acknowledged: number;
  records: PineJournalRecord[];
}
export interface PineDeliveryBatch {
  cursor: PineJournalCursor;
  series: PineSeries;
  result: PineAlertResult;
}
export interface PineRecoveryOptions {
  owner: string;
  epoch: string;
  expected?: PineJournalCursor;
}
export interface PineRecoveryProgress { owner: string; completed: number; total: number }
export interface DurablePineResult extends PineAlertResult { deliveries: PineDeliveryBatch[]; cursor: PineJournalCursor; restored: number }
