import { validChartColor } from "@/lib/chart/appearance";
export const FOOTPRINT_PALETTE_MIGRATIONS = [["imbalanceAskColor", "buyColor"], ["imbalanceBidColor", "sellColor"], ["imbalanceTextAskColor", "buyColor"], ["imbalanceTextBidColor", "sellColor"],
  ["askColor", "buyColor"], ["bidColor", "sellColor"], ["volumeBuyColor", "buyColor"], ["volumeSellColor", "sellColor"], ["deltaUpColor", "buyColor"], ["deltaDownColor", "sellColor"]] as const;
/** Run before SDK defaults are merged, so new percent/palette defaults cannot
 * conceal explicitly saved legacy multipliers, colors or coupled switches. */
export function migrateFootprintInputs<T extends Record<string, unknown>>(values: T): T & Record<string, unknown> {
  const result: Record<string, unknown> = { ...values };
  if (!Object.hasOwn(values, "imbalancePercent") && typeof values.imbalanceRatio === "number" && Number.isFinite(values.imbalanceRatio) && values.imbalanceRatio >= 1 && values.imbalanceRatio <= 100)
    result.imbalancePercent = values.imbalanceRatio * 100;
  if (!Object.hasOwn(values, "imbalanceRecolor") && typeof values.imbalanceVisible === "boolean") result.imbalanceRecolor = values.imbalanceVisible;
  for (const [key, old] of FOOTPRINT_PALETTE_MIGRATIONS)
    if (!Object.hasOwn(values, key) && validChartColor(values[old])) result[key] = values[old];
  return result as T & Record<string, unknown>;
}
