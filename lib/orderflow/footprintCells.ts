import type { FootprintBar, FootprintLevel, FootprintVolumeMode } from "@/types/trading";
import { footprintSideCount } from "./footprintCounts";
import { footprintNumber as formatVolume } from "./footprintFormat";
import { executionPriceGrid } from "./priceGrid";
import { footprintRows } from "./math";
import { footprintFilterPasses, footprintFiltersActive, type FootprintVolumeFilters } from "./footprintFilters";
export const FOOTPRINT_CELL_VALUES = ["auto", "bid-ask", "total", "delta", "trades", "bid-ask-trades"] as const;
export type FootprintCellValues = typeof FOOTPRINT_CELL_VALUES[number];
export function footprintSizes(level: FootprintLevel, average: boolean) {
  const size = (side: "buy" | "sell") => {
    const volume = side === "buy" ? level.buyVolume : level.sellVolume;
    if (!average) return volume;
    const count = footprintSideCount(level, side); return count === null ? null : count > 0 ? volume / count : 0;
  };
  return { buy: size("buy"), sell: size("sell") };
}
export function footprintCellText(level: FootprintLevel, setting: FootprintCellValues, mode: FootprintVolumeMode) {
  const selected = setting === "auto" ? mode === "bid-ask-ladder" ? "bid-ask" : mode === "absolute-delta" ? "delta" : mode : setting;
  const count = (value: number | null) => value === null ? "—" : formatVolume(value);
  if (selected === "bid-ask") return { left: formatVolume(level.sellVolume), right: formatVolume(level.buyVolume), sign: 0 };
  const buy = footprintSideCount(level, "buy"), sell = footprintSideCount(level, "sell");
  if (selected === "bid-ask-trades") return { left: count(sell), right: count(buy), sign: 0 };
  if (selected === "trades") return { center: count(buy === null || sell === null || !Number.isSafeInteger(buy + sell) ? null : buy + sell), sign: 0 };
  const value = selected === "delta" ? level.buyVolume - level.sellVolume : level.buyVolume + level.sellVolume;
  return { center: `${selected === "delta" && value > 0 ? "+" : ""}${formatVolume(value)}`, sign: selected === "delta" ? Math.sign(value) : 0 };
}
/** Average mode changes plotted geometry, POC and diagonals, while retaining
 * raw volume/count fields for labels, auction checks and captured inspection. */
export function footprintDisplayBar(bar: FootprintBar, step: number, options: FootprintVolumeFilters & { averageTradeSize?: boolean; imbalanceRatio: number; imbalanceMinVolume?: number; ignoreZeroOpposite?: boolean }): FootprintBar {
  const active = footprintFiltersActive(options), annotated = bar.levels.some(level => level.filtered !== undefined);
  if (!options.averageTradeSize && !active && !annotated) return bar;
  const grid = executionPriceGrid(step), map = new Map<number, FootprintLevel>(), hidden = new Map<number, boolean>();
  for (const level of bar.levels) {
    const sizes = footprintSizes(level, options.averageTradeSize === true), index = level.rowIndex ?? grid.index(level.price);
    const filtered = !footprintFilterPasses(sizes.buy ?? 0, sizes.sell ?? 0, options); hidden.set(index, filtered);
    if (!filtered) map.set(index, { ...level, rowIndex: index, buyVolume: sizes.buy ?? 0, sellVolume: sizes.sell ?? 0 });
  }
  const plotted = footprintRows(bar.time, map, options.imbalanceRatio, { minimumVolume: options.imbalanceMinVolume, ignoreZeroOpposite: options.ignoreZeroOpposite });
  const flags = new Map(plotted.levels.map(row => [row.rowIndex!, row]));
  return { ...bar, poc: plotted.volume > 0 ? plotted.poc : NaN, levels: bar.levels.map(level => {
    const index = level.rowIndex ?? grid.index(level.price), row = flags.get(index);
    // An explicitly filtered neighbor cannot serve as a zero-volume diagonal.
    const buyImbalance = row?.buyImbalance === true && hidden.get(index - 1) !== true;
    const sellImbalance = row?.sellImbalance === true && hidden.get(index + 1) !== true;
    return { ...level, ...(active || annotated ? { filtered: hidden.get(index) === true } : {}), buyImbalance, sellImbalance,
      imbalance: buyImbalance ? "buy" : sellImbalance ? "sell" : null };
  }) };
}
