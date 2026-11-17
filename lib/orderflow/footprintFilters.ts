export const FOOTPRINT_FILTER_KEYS = ["minVolume", "maxVolume", "minBidVolume", "maxBidVolume", "minAskVolume", "maxAskVolume"] as const;
export type FootprintFilterKey = typeof FOOTPRINT_FILTER_KEYS[number];
export type FootprintVolumeFilters = Partial<Record<FootprintFilterKey, number>>;
export const defaultFootprintFilters = (): Required<FootprintVolumeFilters> => ({ minVolume: 0, maxVolume: 0, minBidVolume: 0, maxBidVolume: 0, minAskVolume: 0, maxAskVolume: 0 });
export const validFootprintFilter = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e15;
export const footprintFiltersActive = (filters: FootprintVolumeFilters) => FOOTPRINT_FILTER_KEYS.some(key => (filters[key] ?? 0) > 0);
/** Six inclusive independent constraints. Zero disables a bound. Contradictory
 * positive bounds deliberately match no rows rather than swapping user inputs. */
export function footprintFilterPasses(buy: number, sell: number, filters: FootprintVolumeFilters): boolean {
  const inside = (value: number, min = 0, max = 0) => (!(min > 0) || value >= min) && (!(max > 0) || value <= max);
  return inside(buy + sell, filters.minVolume, filters.maxVolume) && inside(sell, filters.minBidVolume, filters.maxBidVolume) && inside(buy, filters.minAskVolume, filters.maxAskVolume);
}
