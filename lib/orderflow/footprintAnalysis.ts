import type { FootprintBar } from "@/types/trading";
import { executionPriceGrid, ExecutionPriceGridError } from "./priceGrid";

export interface FootprintStack { side: "buy" | "sell"; from: number; to: number; rows: number }
/** Adjacent PRICE rows within one bar, not adjacent entries across a gap or across bars.
 * Both sides are scanned independently because a row can contain two diagonal imbalances. */
export function footprintStacks(bar: FootprintBar, step: number, minimumRows: number): FootprintStack[] {
  if (!Number.isFinite(step) || step <= 0 || !Number.isInteger(minimumRows) || minimumRows < 2 || minimumRows > 40) return [];
  const result: FootprintStack[] = [];
  const grid = executionPriceGrid(step);
  for (const side of ["buy", "sell"] as const) {
    let run: FootprintStack | undefined, previous = NaN;
    const finish = () => { if (run && run.rows >= minimumRows) result.push(run); run = undefined; };
    for (const level of bar.levels) {
      let index: number, upper: number;
      try {
        index = level.rowIndex ?? grid.index(level.price);
        if (!Number.isSafeInteger(index)) { finish(); previous = NaN; continue; }
        upper = level.upperPrice ?? grid.row(index).upper;
      } catch (error) {
        if (!(error instanceof ExecutionPriceGridError)) throw error;
        finish(); previous = NaN; continue;
      }
      const imbalanced = side === "buy" ? level.buyImbalance : level.sellImbalance;
      if (level.filtered || !imbalanced || !Number.isFinite(level.price) || !Number.isFinite(upper) || upper <= level.price) { finish(); previous = NaN; continue; }
      if (!run || index !== previous + 1) { finish(); run = { side, from: level.price, to: upper, rows: 1 }; }
      else { run.to = upper; run.rows++; }
      previous = index;
    }
    finish();
  }
  return result;
}
export function footprintDeltaPercent(bar: Pick<FootprintBar, "delta" | "volume">): number | null {
  if (!Number.isFinite(bar.delta) || !Number.isFinite(bar.volume) || bar.volume <= 0 || Math.abs(bar.delta) > bar.volume) return null;
  return bar.delta / bar.volume * 100;
}
