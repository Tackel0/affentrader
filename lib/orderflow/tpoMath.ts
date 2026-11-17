import type { OHLCV, TPOLevel } from "@/types/trading";
import { DerivedTransformError } from "@/lib/chart/transformCapacity";
import { ExecutionPriceGridError, executionPriceGrid, type ExecutionPriceRow } from "./priceGrid";

export const MAX_TPO_ROWS = 2000, MAX_TPO_CELLS = 200000, MAX_TPO_VISITS = 2000000;
export class TpoProfileError extends DerivedTransformError {
  constructor(readonly tpoReason: "capacity" | "precision" | "interval" | "session", message: string) {
    super(tpoReason === "capacity" ? "capacity" : "precision"); this.name = "TpoProfileError"; this.message = message;
  }
}
export interface TpoRow extends TPOLevel { periodIndices: number[]; grid?: ExecutionPriceRow }
export function tpoLetter(period: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", cycle = Math.floor(period / letters.length);
  return letters[period % letters.length] + (cycle ? String(cycle + 1) : "");
}
/** Complete, dense price rows. Capacity errors never return silently truncated financial data. */
export function buildTpoRows(bars: readonly Pick<OHLCV, "time" | "high" | "low">[], step: number, periodMs: number, start: number): TpoRow[] {
  try { return calculateTpoRows(bars, step, periodMs, start); }
  catch (error) { if (error instanceof ExecutionPriceGridError) throw new TpoProfileError("precision", error.message); throw error; }
}
function calculateTpoRows(bars: readonly Pick<OHLCV, "time" | "high" | "low">[], step: number, periodMs: number, start: number): TpoRow[] {
  if (!bars.length) return [];
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(periodMs) || periodMs <= 0 || !Number.isFinite(start))
    throw new TpoProfileError("precision", "Choose a finite positive TPO row size and block length.");
  const grid = executionPriceGrid(step);
  const ranges = bars.map(bar => {
    if (![bar.time, bar.low, bar.high].every(Number.isFinite) || bar.low > bar.high) throw new TpoProfileError("precision", "TPO history contains invalid OHLC prices or times.");
    const lo = grid.index(bar.low), hi = grid.index(bar.high), period = Math.floor((bar.time - start) / periodMs);
    if (!Number.isSafeInteger(period) || period < 0)
      throw new TpoProfileError("precision", "This TPO row size is below supported price precision. Increase the row size.");
    return { lo, hi, period };
  });
  const lo = Math.min(...ranges.map(range => range.lo)), hi = Math.max(...ranges.map(range => range.hi));
  if (hi - lo + 1 > MAX_TPO_ROWS || ranges.reduce((sum, range) => sum + range.hi - range.lo + 1, 0) > MAX_TPO_VISITS)
    throw new TpoProfileError("capacity", "This session exceeds 2,000 price rows or the TPO calculation limit. Increase the row size or shorten the session.");
  const rows = Array.from({ length: hi - lo + 1 }, () => new Set<number>()); let cells = 0;
  for (const range of ranges) for (let index = range.lo; index <= range.hi; index++) {
    const row = rows[index - lo]; if (row.has(range.period)) continue;
    if (++cells > MAX_TPO_CELLS) throw new TpoProfileError("capacity", "This session exceeds 200,000 TPO cells. Increase the row size or block length.");
    row.add(range.period);
  }
  const result = rows.map((periods, index) => {
    const periodIndices = [...periods].sort((a, b) => a - b);
    const row = grid.row(lo + index);
    return { price: row.lower, grid: row, periodIndices, periods: periodIndices.map(tpoLetter), count: periodIndices.length };
  });
  return result;
}
/** POC tie: closest to price-range midpoint, then lower. VA ties choose nearer to POC, then the upper row. */
export function tpoValueArea(rows: readonly TpoRow[], percent: number) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (!rows.length || !total) return null;
  const midpoint = (rows.length - 1) / 2; let poc = 0;
  for (let index = 1; index < rows.length; index++) if (rows[index].count > rows[poc].count ||
    rows[index].count === rows[poc].count && Math.abs(index - midpoint) < Math.abs(poc - midpoint)) poc = index;
  let low = poc, high = poc, count = rows[poc].count;
  const target = total * Math.max(1, Math.min(100, percent)) / 100;
  while (count < target && (low > 0 || high < rows.length - 1)) {
    const below = low > 0 ? rows[low - 1].count : -1, above = high < rows.length - 1 ? rows[high + 1].count : -1;
    const chooseAbove = high < rows.length - 1 && (low === 0 || above > below || above === below && high + 1 - poc <= poc - (low - 1));
    if (chooseAbove) count += rows[++high].count;
    else count += rows[--low].count;
  }
  return { poc, low, high, count, total };
}
