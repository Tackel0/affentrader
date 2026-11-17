import { DerivedTransformError } from "./transformCapacity";

const memo = new Map<string, { key: string; value?: unknown; error?: DerivedTransformError }>();
/** Identical failed input is cheap to repaint; changed input always gets a new calculation. */
export function cachedDerivedValue<T>(id: string, key: string, build: () => T): T {
  const hit = memo.get(id);
  if (hit?.key === key) { if (hit.error) throw hit.error; return hit.value as T; }
  try { const value = build(); memo.set(id, { key, value }); return value; }
  catch (error) { if (error instanceof DerivedTransformError) memo.set(id, { key, error }); throw error; }
}
export function clearDerivedCache(cellId: string) {
  for (const key of memo.keys()) if (key.endsWith(`:${cellId}`)) memo.delete(key);
}
const seriesIds = new WeakMap<object, number>();
let nextSeriesId = 0;
export function derivedBarKey(bars: readonly { time: number; high: number; low: number; close: number; open?: number; volume?: number }[]): string {
  let identity = seriesIds.get(bars); if (identity === undefined) { identity = ++nextSeriesId; seriesIds.set(bars, identity); }
  const last = bars.at(-1);
  return `${identity}:${bars.length}:${bars[0]?.time}:${last?.time}:${last?.open}:${last?.close}:${last?.high}:${last?.low}:${last?.volume}`;
}
