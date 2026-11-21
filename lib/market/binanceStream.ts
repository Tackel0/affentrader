import type { DepthLevel, Tick } from "@/types/trading";
import { aggregateTradeCount } from "./tradeCounts";
import { wireDecimal as decimal, wireObject } from "./marketWire";

export function binanceTrade(row: Record<string, unknown>, symbol: string): Tick | null {
  if (row.e !== "aggTrade" || row.s !== symbol) return null;
  return binanceAggregateTrade(row, symbol);
}

export function binanceAggregateTrade(row: Record<string, unknown>, symbol: string): Tick | null {
  const { a, T, m } = row;
  if (typeof a !== "number" || !Number.isSafeInteger(a) || a < 0 ||
    typeof T !== "number" || !Number.isSafeInteger(T) || T <= 0 || T > 8.64e15 || typeof m !== "boolean") return null;
  const price = decimal(row.p), quantity = decimal(row.q);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) return null;
  return { id: `${symbol}-${a}`, symbol, time: T, price, quantity, side: m ? "sell" : "buy", seq: a,
    simulated: false, tradeCount: aggregateTradeCount(row.f, row.l) };
}

export function binanceTicker(value: unknown) {
  const row = wireObject(value);
  if (!row || row.e !== "24hrMiniTicker" || typeof row.s !== "string" || !/^[A-Z0-9]+$/.test(row.s)) return null;
  const last = decimal(row.c), open = decimal(row.o), high = decimal(row.h), low = decimal(row.l), volume = decimal(row.v);
  if (![last, open, high, low, volume].every(Number.isFinite) || last <= 0 || open <= 0 || high < low || low <= 0 || volume < 0) return null;
  const turnover = decimal(row.q);
  return { symbol: row.s, last, open, high, low, volume, turnover: Number.isFinite(turnover) && turnover >= 0 ? turnover : null };
}

function bookSide(values: unknown, direction: 1 | -1): DepthLevel[] | null {
  if (!Array.isArray(values) || values.length > 10) return null;
  const levels: DepthLevel[] = [];
  for (const row of values) {
    if (!Array.isArray(row) || row.length !== 2) return null;
    const price = decimal(row[0]), quantity = decimal(row[1]);
    const previous = levels.at(-1);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0 ||
      (previous && (price - previous.price) * direction <= 0)) return null;
    levels.push({ price, quantity });
  }
  return levels;
}

export function binanceDepth(row: Record<string, unknown>) {
  const bids = bookSide(row.bids, -1), asks = bookSide(row.asks, 1);
  if (!bids || !asks || (bids[0] && asks[0] && bids[0].price >= asks[0].price)) return null;
  return { bids, asks };
}
