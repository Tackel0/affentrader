import type {
  FootprintBar,
  FootprintLevel,
  OHLCV,
  Tick,
  Timeframe,
  TPOLevel,
  VolumeProfileRow,
} from "@/types/trading";
import { bucketStart, isTickInterval, parseInterval } from "@/lib/market/intervals";
import { buildTpoRows } from "./tpoMath";
import { executionPriceGrid } from "./priceGrid";
import { DerivedTransformError } from "@/lib/chart/transformCapacity";
import { addFootprintCount } from "./footprintCounts";
export function priceStep(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 1e-8;
  return Math.max(Number.MIN_VALUE, Number(`1e${Math.floor(Math.log10(price)) - 6}`));
}
export function footprints(
  trades: readonly Tick[],
  timeframe: Timeframe,
  step: number,
  imbalanceRatio = 3,
  filters: { minimumVolume?: number; ignoreZeroOpposite?: boolean } = {},
): FootprintBar[] {
  const minimum = filters.minimumVolume ?? 0;
  if (step <= 0 || !Number.isFinite(step) || !parseInterval(timeframe) || isTickInterval(timeframe) || !Number.isFinite(imbalanceRatio) || imbalanceRatio < 1 || !Number.isFinite(minimum) || minimum < 0) return [];
  const buckets = new Map<number, Map<number, FootprintLevel>>();
  const grid = executionPriceGrid(step);
  for (const trade of trades) {
    if (!Number.isFinite(trade.price) || trade.price <= 0 || !Number.isFinite(trade.quantity) || trade.quantity <= 0 || !Number.isFinite(trade.time) || trade.side !== "buy" && trade.side !== "sell") continue;
    const time = bucketStart(timeframe, trade.time);
    const index = grid.index(trade.price), { lower: price, upper: upperPrice } = grid.row(index);
    const levels = buckets.get(time) ?? new Map<number, FootprintLevel>();
    const level = levels.get(index) ?? {
      price,
      rowIndex: index,
      upperPrice,
      buyVolume: 0,
      sellVolume: 0,
      imbalance: null,
    };
    addFootprintCount(level, trade);
    if (trade.side === "buy") level.buyVolume += trade.quantity;
    else level.sellVolume += trade.quantity;
    levels.set(index, level);
    buckets.set(time, levels);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, map]) => footprintRows(time, map, imbalanceRatio, filters));
}
/** Shared finishing pass for batch and incrementally collected execution rows. */
export function footprintRows(time: number, map: ReadonlyMap<number, FootprintLevel>, imbalanceRatio: number,
  filters: { minimumVolume?: number; ignoreZeroOpposite?: boolean } = {}): FootprintBar {
      const imbalanced = (quantity: number, opposite: number) => quantity > 0 && quantity >= (filters.minimumVolume ?? 0) &&
        (opposite === 0 ? !filters.ignoreZeroOpposite : quantity >= imbalanceRatio * opposite);
      const levels = [...map.values()].sort((a, b) => a.price - b.price).map(level => ({ ...level }));
      let delta = 0,
        volume = 0,
        max = -1,
        poc = 0;
      for (const level of levels) {
        const below = map.get(level.rowIndex! - 1);
        const above = map.get(level.rowIndex! + 1);
        // A missing/hidden diagonal is unknown, not an observed zero. A present
        // row with a zero opposite side still qualifies unless explicitly excluded.
        level.buyImbalance = level.filtered !== true && below !== undefined && below.filtered !== true && imbalanced(level.buyVolume, below.sellVolume);
        level.sellImbalance = level.filtered !== true && above !== undefined && above.filtered !== true && imbalanced(level.sellVolume, above.buyVolume);
        level.imbalance = level.buyImbalance ? "buy" : level.sellImbalance ? "sell" : null;
        const total = level.buyVolume + level.sellVolume;
        volume += total;
        delta += level.buyVolume - level.sellVolume;
        if (![total, volume, delta].every(Number.isFinite)) {
          const error = new DerivedTransformError("precision"); error.message = "Footprint quantities exceed supported precision."; throw error;
        }
        if (total > max) {
          max = total;
          poc = level.price;
        }
      }
      return { time, levels, delta, volume, poc };
}
export function tradeVolumeProfile(
  trades: Tick[],
  step: number,
  from = 0,
  to = Infinity,
): VolumeProfileRow[] {
  if (!Number.isFinite(step) || step <= 0 || Number.isNaN(from) || Number.isNaN(to) || from > to) return [];
  const grid = executionPriceGrid(step);
  const rows = new Map<number, VolumeProfileRow>();
  for (const trade of trades) {
    if (!Number.isFinite(trade.price) || trade.price <= 0 || !Number.isFinite(trade.quantity) || trade.quantity <= 0 || !Number.isFinite(trade.time) || trade.side !== "buy" && trade.side !== "sell") continue;
    if (trade.time < from || trade.time > to) continue;
    const index = grid.index(trade.price), price = grid.row(index).lower;
    const row = rows.get(index) ?? { price, buy: 0, sell: 0, total: 0 };
    row[trade.side] += trade.quantity;
    row.total += trade.quantity;
    rows.set(index, row);
  }
  return [...rows.values()].sort((a, b) => a.price - b.price);
}
export function tpoProfile(
  bars: readonly Pick<OHLCV, "time" | "high" | "low">[],
  step: number,
  periodMs = 1800000,
): TPOLevel[] {
  if (!bars.length) return [];
  return buildTpoRows(bars, step, periodMs, Math.floor(bars[0].time / 86400000) * 86400000)
    .map(({ periodIndices: _indices, grid: _grid, ...row }) => row);
}
export function cumulativeDelta(
  trades: Tick[],
  timeframe: Timeframe,
): { time: number; value: number }[] {
  let value = 0;
  return footprints(trades, timeframe, priceStep(trades[0]?.price ?? 1)).map(
    (b) => ({ time: b.time, value: (value += b.delta) }),
  );
}
