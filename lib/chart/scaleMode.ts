export type PriceScaleMode = "price" | "percent" | "indexed";
export interface PriceScaleSelection { mode: PriceScaleMode; logarithmic: boolean }
export function validScaleMode(value: unknown): value is PriceScaleMode {
  return value === "price" || value === "percent" || value === "indexed";
}
export function priceScaleSelection(mode: unknown, logarithmic: unknown): PriceScaleSelection {
  return { mode: logarithmic === true ? "price" : validScaleMode(mode) ? mode : "price", logarithmic: logarithmic === true };
}
export function samePriceScale(a: PriceScaleSelection, b: PriceScaleSelection): boolean {
  return a.mode === b.mode && a.logarithmic === b.logarithmic;
}
/** An explicit relative mode clears log; enabling log returns to absolute-price units. */
export function priceScalePatch(patch: { scaleMode?: PriceScaleMode; logarithmic?: boolean }, previous: { scaleMode: PriceScaleMode; logarithmic: boolean }) {
  if (patch.scaleMode === undefined && patch.logarithmic === undefined) return {};
  const value = priceScaleSelection(patch.scaleMode ?? previous.scaleMode,
    patch.scaleMode !== undefined && patch.scaleMode !== "price" ? false : patch.logarithmic ?? previous.logarithmic);
  return { scaleMode: value.mode, logarithmic: value.logarithmic };
}
export function nativePriceScale(config: unknown): PriceScaleSelection | null {
  if (!config || typeof config !== "object") return null;
  const scale = (config as { priceScale?: unknown }).priceScale;
  if (!scale || typeof scale !== "object") return null;
  const value = scale as { mode?: unknown; log?: unknown };
  return validScaleMode(value.mode) && typeof value.log === "boolean" ? priceScaleSelection(value.mode, value.log) : null;
}
/** Legacy axis Log controls can flip only the flag; converge the renderer to the exclusive UI choice. */
export function nativeScaleNeedsNormalization(config: unknown): boolean {
  if (!nativePriceScale(config)) return false;
  const scale = (config as { priceScale: { mode: PriceScaleMode; log: boolean } }).priceScale;
  return scale.log && scale.mode !== "price";
}
