import type { Tick } from "./trading";
export interface TradeArchiveRecord { key: string; tick: Tick; recordedAt: number }
export interface TradeArchiveStats { count: number; first: number | null; last: number | null; symbols: Array<{ symbol: string; count: number; first: number; last: number }> }
export interface TradeArchiveSelection { symbol: string; from: number; to: number }
/** Decimal-string totals preserve the exact canonical spelling of the source numbers. */
export interface TradeArchiveRead { selection: TradeArchiveSelection; trades: Tick[]; buyVolume: string; sellVolume: string; delta: string; first: number | null; last: number | null; coverage: "observed-only" }
export interface TradeArchiveWrite { added: number; duplicates: number; expired: number; evicted: number; count: number }
