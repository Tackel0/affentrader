/**
 * Bounded LRU-like Map cache insertion. Re-inserts updated keys so frequently
 * accessed entries stay warm while preventing unbounded heap growth.
 */
export function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Deduplicates concurrent async loads for the same cache key so burst traffic
 * triggers only a single upstream request.
 */
export function coalesceInFlight<K, V>(
  inflight: Map<K, Promise<V>>,
  key: K,
  load: () => Promise<V>,
): Promise<V> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = load().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}
