import type { PersistStorage, StateStorage, StorageValue } from "zustand/middleware";

/**
 * localStorage with coalesced writes. A store that updates on every market tick
 * would otherwise serialise and write its whole persisted state, drawings and
 * script drafts included, dozens of times a second. Reads see pending writes,
 * and everything is flushed when the page is hidden or closed.
 */
export interface DebouncedStorage extends StateStorage {
  flush: () => void;
  discard: () => void;
  /** Monotonic counter invalidated on discard(), removeItem(), or flush failure (e.g. QuotaExceededError). */
  writeToken?: (name: string) => number;
}

export function createDebouncedStorage(waitMs = 400, backing: () => Storage | undefined = () => (typeof localStorage === "undefined" ? undefined : localStorage)): DebouncedStorage {
  const pending = new Map<string, string>();
  const submitted = new Map<string, string>();
  const tokens = new Map<string, number>();
  let globalEpoch = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const bump = (key: string) => tokens.set(key, (tokens.get(key) ?? 0) + 1);
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const storage = backing();
    for (const [key, value] of pending) {
      try {
        if (storage) storage.setItem(key, value);
        else {
          submitted.delete(key);
          bump(key);
        }
      } catch {
        submitted.delete(key);
        bump(key);
        /* quota or privacy mode: the next write retries */
      }
    }
    pending.clear();
  };
  const discard = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending.clear();
    submitted.clear();
    globalEpoch++;
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
  return {
    getItem: (name) => {
      const value = pending.get(name) ?? backing()?.getItem(name) ?? null;
      if (value !== null) submitted.set(name, value);
      else submitted.delete(name);
      return value;
    },
    setItem: (name, value) => {
      // Hot market fields are excluded by persist.partialize. Do not let their
      // unchanged snapshots overwrite a newer edit saved by another main tab.
      if (submitted.get(name) === value) return;
      submitted.set(name, value);
      pending.set(name, value);
      timer ??= setTimeout(flush, waitMs);
    },
    removeItem: (name) => {
      pending.delete(name);
      submitted.delete(name);
      bump(name);
      backing()?.removeItem(name);
    },
    flush,
    discard,
    writeToken: (name) => globalEpoch * 1_000_000 + (tokens.get(name) ?? 0),
  };
}

/** One shared instance for the hot stores, so a restore can drop its queued writes. */
export const hotStorage = createDebouncedStorage();

function shallowEqualRecord(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.hasOwn(b, key) || !Object.is(a[key], b[key])) {
      return false;
    }
  }
  return true;
}

/**
 * PersistStorage wrapper that skips JSON.stringify entirely when every
 * persisted slice field keeps the exact same object/primitive reference
 * (for example during high-frequency tick/quote/candle updates to non-persisted fields).
 */
export function createShallowPersistStorage<S>(
  inner: DebouncedStorage = hotStorage,
): PersistStorage<S> {
  const cache = new Map<string, { version?: number; state: Record<string, unknown>; token?: number }>();

  const parseAndCache = (name: string, raw: string | null): StorageValue<S> | null => {
    if (!raw) {
      cache.delete(name);
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as StorageValue<S>;
      if (parsed && typeof parsed.state === "object" && parsed.state !== null) {
        cache.set(name, {
          version: parsed.version,
          state: { ...(parsed.state as Record<string, unknown>) },
          token: inner.writeToken?.(name),
        });
      }
      return parsed;
    } catch {
      cache.delete(name);
      return null;
    }
  };

  return {
    getItem: (name) => {
      const raw = inner.getItem(name);
      if (raw instanceof Promise) {
        return raw.then((resolved) => parseAndCache(name, resolved));
      }
      return parseAndCache(name, raw);
    },
    setItem: (name, value) => {
      const nextState =
        value.state && typeof value.state === "object"
          ? (value.state as Record<string, unknown>)
          : null;
      const prev = cache.get(name);
      const token = inner.writeToken?.(name);
      const stillPresent =
        prev !== undefined &&
        (token !== undefined
          ? prev.token === token
          : (() => {
              const existing = inner.getItem(name);
              return existing !== null && !(existing instanceof Promise);
            })());
      if (
        prev &&
        stillPresent &&
        nextState &&
        prev.version === value.version &&
        shallowEqualRecord(prev.state, nextState)
      ) {
        return;
      }
      if (nextState) {
        cache.set(name, { version: value.version, state: { ...nextState }, token });
      } else {
        cache.delete(name);
      }
      return inner.setItem(name, JSON.stringify(value));
    },
    removeItem: (name) => {
      cache.delete(name);
      return inner.removeItem(name);
    },
  };
}
