import type { IPineInput } from "pinets";
import type { OHLCV, Timeframe } from "./trading";

export interface StrategySettings {
  capital: number;
  quantityType: "percent_of_equity" | "fixed" | "cash";
  quantity: number;
  commissionType: "percent" | "cash_per_order" | "cash_per_contract";
  commission: number;
  slippage: number;
  pyramiding: number;
  marginLong: number;
  marginShort: number;
  fillOnClose: boolean;
  bars: number;
  from: string;
  to: string;
  source: "exchange" | "simulation";
  /** Zero/absent uses provider rules. Overrides are recorded in every report. */
  tickSize?: number;
  quantityStep?: number;
  pointValue?: number;
  extended?: boolean;
  adjustDividends?: boolean;
  useBarMagnifier?: boolean;
  intrabarInterval?: string;
}
export interface StrategyDocument {
  name: string;
  source: string;
  inputs: Record<string, number | string | boolean>;
  settings: StrategySettings;
}
export interface StrategyMarket {
  symbol: string;
  timeframe: Timeframe;
  tickSize: number;
  quantityStep: number;
  base: string;
  currency?: string;
  provider?: "binance" | "hyperliquid" | "yahoo" | "alpaca" | "kraken";
  timezone?: string;
  type?: string;
  pointValue?: number;
  tickSource?: "exchange" | "estimated" | "user";
  quantitySource?: "exchange" | "estimated" | "user";
}
export interface StrategyDataset {
  market: StrategyMarket;
  bars: OHLCV[];
  source: StrategySettings["source"];
  warnings: string[];
  intrabars?: { timeframe: Timeframe; bars: OHLCV[] };
}
export interface StrategyMagnifierSummary {
  enabled: boolean;
  timeframe: Timeframe | null;
  sourceBars: number;
  coveredBars: number;
  fallbackBars: number;
  incompleteBars: number;
  mismatchedBars: number;
  firstCoveredTime: number | null;
  lastCoveredTime: number | null;
}
export interface StrategyRunRequest {
  id: string;
  document: StrategyDocument;
  dataset: StrategyDataset;
  libraries: Record<string, string>;
}
export interface StrategyTrade {
  id: string;
  entryId: string;
  exitId: string;
  side: "long" | "short";
  quantity: number;
  entryTime: number;
  exitTime: number | null;
  entryBar: number;
  exitBar: number | null;
  entryPrice: number;
  exitPrice: number | null;
  netProfit: number;
  commission: number;
  runup: number;
  drawdown: number;
  open: boolean;
  pointValue?: number;
}
export interface EquityPoint {
  time: number;
  equity: number;
  netProfit: number;
  openProfit: number;
  drawdown: number;
  drawdownPercent: number;
  buyHold: number;
}
export interface TradeStatistics {
  count: number;
  wins: number;
  losses: number;
  even: number;
  winRate: number | null;
  netProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  averageTrade: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  averageBars: number | null;
  commission: number;
}
export interface StrategyReport {
  id: string;
  name: string;
  market: StrategyMarket;
  source: StrategySettings["source"];
  document: StrategyDocument;
  startedAt: number;
  completedAt: number;
  firstTime: number;
  lastTime: number;
  barCount: number;
  initialCapital: number;
  equity: number;
  netProfit: number;
  openProfit: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  maxRunup: number;
  sharpe: number | null;
  sortino: number | null;
  buyHoldProfit: number;
  trades: StrategyTrade[];
  equityCurve: EquityPoint[];
  all: TradeStatistics;
  long: TradeStatistics;
  short: TradeStatistics;
  warnings: string[];
  magnifier?: StrategyMagnifierSummary;
}
export type StrategyWorkerRequest =
  | {
      type: "inspect";
      id: string;
      source: string;
      libraries: Record<string, string>;
    }
  | { type: "run"; request: StrategyRunRequest }
  | {
      type: "series";
      requestId: string;
      dataset?: StrategyDataset;
      error?: string;
    };
export type StrategyWorkerResponse =
  | { type: "inputs"; id: string; inputs: IPineInput[]; title: string }
  | { type: "progress"; id: string; completed: number; total: number }
  | { type: "result"; id: string; report: StrategyReport }
  | {
      type: "fetch";
      id: string;
      requestId: string;
      symbol: string;
      timeframe: string;
      limit: number;
      from?: number;
      to?: number;
    }
  | { type: "error"; id: string; message: string };
