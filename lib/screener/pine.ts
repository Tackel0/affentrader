import { PineTS, type Kline } from "pinets";
import type { OHLCV } from "@/types/trading";
import { intervalMs } from "@/lib/market/intervals";

export type PineValues = Record<string, number | null>;

export interface PineScreenRow {
  symbol: string;
  values: PineValues;
  error?: string;
  price?: number;
}

function toKlines(bars: readonly OHLCV[], timeframe: string): Kline[] {
  const step = intervalMs(timeframe);
  return bars.map((b) => ({
    openTime: b.time,
    closeTime: b.time + step - 1,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    quoteAssetVolume: Number.NaN,
    numberOfTrades: Number.NaN,
    takerBuyBaseAssetVolume: Number.NaN,
    takerBuyQuoteAssetVolume: Number.NaN,
    ignore: 0,
  }));
}

/**
 * Execute an indicator script over candles and return the latest value of
 * every `plot()`. Plot titles become the screener's columns.
 */
export async function runPineOnBars(
  source: string,
  bars: readonly OHLCV[],
  timeframe: string,
  libraries: Record<string, string> = {},
): Promise<PineValues> {
  if (bars.length < 2) throw new Error("Not enough candles for this symbol.");
  const runtime = new PineTS(toKlines(bars, timeframe));
  runtime.setMaxLoops(100_000);
  runtime.setImportResolver((path: string) => libraries[path] ?? null);
  const context = await runtime.run(source);
  const values: PineValues = {};
  for (const [title, plot] of Object.entries(context.plots ?? {})) {
    // Names starting with "__" are PineTS internals (drawings, tables).
    if (title.startsWith("__")) continue;
    const data = (plot as { data?: { value: unknown }[] }).data ?? [];
    let latest: number | null = null;
    for (let i = data.length - 1; i >= 0; i--) {
      const v = data[i]?.value;
      if (typeof v === "number" && Number.isFinite(v)) {
        latest = v;
        break;
      }
      if (typeof v === "boolean") {
        latest = v ? 1 : 0;
        break;
      }
    }
    values[title] = latest;
  }
  return values;
}

export type PineFilter = { column: string; op: ">" | "<" | ">=" | "<=" | "="; value: number };

export function passesPineFilters(row: PineScreenRow, filters: readonly PineFilter[]): boolean {
  return filters.every((f) => {
    const v = row.values[f.column];
    if (v === null || v === undefined) return false;
    switch (f.op) {
      case ">":
        return v > f.value;
      case "<":
        return v < f.value;
      case ">=":
        return v >= f.value;
      case "<=":
        return v <= f.value;
      default:
        return v === f.value;
    }
  });
}
