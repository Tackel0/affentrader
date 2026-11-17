import { executionPriceGrid } from "./priceGrid";
import type { TpoRow } from "./tpoMath";

export interface TpoStructureRange { lower: number; upper: number; firstRow: number; lastRow: number; rows: number }
export interface TpoPoorExtreme extends TpoStructureRange { opportunities: number }
export interface TpoStructure {
  poorHigh: TpoPoorExtreme | null;
  poorLow: TpoPoorExtreme | null;
  singlePrintZones: TpoStructureRange[];
}
/** Observed grid structure only. Single-print runs must be bounded by occupied multi-block rows;
 * single-block tails and unvisited price gaps are not interior single prints. */
export function tpoStructure(rows: readonly TpoRow[], step: number): TpoStructure {
  const result: TpoStructure = { poorHigh: null, poorLow: null, singlePrintZones: [] };
  if (!rows.length) return result;
  const grid = executionPriceGrid(step);
  const range = (firstRow: number, lastRow = firstRow): TpoStructureRange => ({
    lower: (rows[firstRow].grid ?? grid.row(grid.index(rows[firstRow].price))).lower,
    upper: (rows[lastRow].grid ?? grid.row(grid.index(rows[lastRow].price))).upper,
    firstRow, lastRow, rows: lastRow - firstRow + 1,
  });
  if (rows[0].count > 1) result.poorLow = { ...range(0), opportunities: rows[0].count };
  const top = rows.length - 1;
  if (rows[top].count > 1) result.poorHigh = { ...range(top), opportunities: rows[top].count };
  for (let index = 0; index < rows.length; index++) {
    if (rows[index].count !== 1) continue;
    const first = index;
    while (index + 1 < rows.length && rows[index + 1].count === 1) index++;
    if (first > 0 && index < top && rows[first - 1].count > 1 && rows[index + 1].count > 1)
      result.singlePrintZones.push(range(first, index));
  }
  return result;
}
