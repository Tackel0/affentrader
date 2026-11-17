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
