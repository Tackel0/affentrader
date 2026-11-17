import type { FootprintBar } from "@/types/trading";
import { executionPriceGrid } from "./priceGrid";
import { footprintSizes } from "./footprintCells";

export interface FootprintValueArea {
  low: number; high: number; pocLow: number; pocHigh: number; pocMid: number;
  lowIndex: number; highIndex: number; percent: number; selectedVolume: number; representedVolume: number;
  basis: "volume" | "average-trade-size";
}
/** Expand over observed rows, starting at the first maximum-volume row. Equal
 * adjacent quantities prefer the upper row; absent price rows carry no volume.
 * Numeric cell labels do not change this basis. Unknown average counts contribute
 * no inferred size, consistently with the displayed average-size geometry. */
export function footprintValueArea(bar: FootprintBar, step: number, percent: number, average = false, includeFiltered = false): FootprintValueArea | null {
  if (!bar.levels.length || !Number.isFinite(step) || step <= 0 || !Number.isFinite(percent) || percent < 1 || percent > 100) return null;
  const grid = executionPriceGrid(step);
  const eligible = bar.levels.map(row => includeFiltered || !row.filtered);
  const weights = bar.levels.map((row,index) => { if (!eligible[index]) return 0; const size = footprintSizes(row, average); return (size.buy ?? 0) + (size.sell ?? 0); });
  if (weights.some(weight => !Number.isFinite(weight) || weight < 0)) return null;
  const representedVolume = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(representedVolume > 0) || !Number.isFinite(representedVolume)) return null;
  let poc = eligible.findIndex(Boolean); if (poc < 0) return null;
  for (let i = poc + 1; i < weights.length; i++) if (eligible[i] && weights[i] > weights[poc]) poc = i;
  let lowIndex = poc, highIndex = poc, selectedVolume = weights[poc];
  // Scale the percentage first so even a huge finite total cannot overflow.
  const target = (percent / 100) * representedVolume;
  while (selectedVolume < target && (lowIndex > 0 || highIndex < weights.length - 1)) {
    let lo = lowIndex - 1, hi = highIndex + 1;
    while (lo >= 0 && !eligible[lo]) lo--;
    while (hi < weights.length && !eligible[hi]) hi++;
    if (lo < 0 && hi >= weights.length) break;
    const below = lo >= 0 ? weights[lo] : -1, above = hi < weights.length ? weights[hi] : -1;
    if (above >= below && hi < weights.length) { highIndex = hi; selectedVolume += above; }
    else { lowIndex = lo; selectedVolume += below; }
  }
  const upper = (index: number) => bar.levels[index].upperPrice ?? grid.row(bar.levels[index].rowIndex ?? grid.index(bar.levels[index].price)).upper;
  const low = bar.levels[lowIndex].price, high = upper(highIndex), pocLow = bar.levels[poc].price, pocHigh = upper(poc);
  if (![low, high, pocLow, pocHigh].every(Number.isFinite) || high <= low || pocHigh <= pocLow) return null;
  return { low, high, pocLow, pocHigh, pocMid: pocLow + (pocHigh - pocLow) / 2, lowIndex, highIndex, percent, selectedVolume, representedVolume,
    basis: average ? "average-trade-size" : "volume" };
}
