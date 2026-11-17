/** Binance aggregate messages span an inclusive range of underlying trade IDs.
 * Reject imprecise/missing IDs rather than treating one aggregate as one print. */
export function aggregateTradeCount(first: unknown, last: unknown): number | undefined {
  if (typeof first !== "number" || typeof last !== "number" || !Number.isSafeInteger(first) || !Number.isSafeInteger(last)
    || first < 0 || last < first) return;
  const count = last - first + 1;
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}
export function validTradeCount(count: unknown): count is number {
  return typeof count === "number" && Number.isSafeInteger(count) && count > 0;
}
