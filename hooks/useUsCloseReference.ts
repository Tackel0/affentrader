"use client";
import { useEffect, useState } from "react";
import { lastUsMarketCloseMs } from "@/lib/market/usMarketClose";
import { wireObject } from "@/lib/market/marketWire";

const MAX_BATCH = 60;

interface CacheState {
  closeMs: number;
  prices: Map<string, number>;
  attempted: Set<string>;
}

const cache: CacheState = {
  closeMs: 0,
  prices: new Map(),
  attempted: new Set(),
};

function ensureEpoch(now = Date.now()): CacheState {
  const closeMs = lastUsMarketCloseMs(now);
  if (cache.closeMs !== closeMs) {
    cache.closeMs = closeMs;
    cache.prices.clear();
    cache.attempted.clear();
  }
  return cache;
}

export function clearUsCloseClientCache(): void {
  cache.closeMs = 0;
  cache.prices.clear();
  cache.attempted.clear();
}

export async function fetchUsCloseBatch(
  symbols: readonly string[],
  signal?: AbortSignal,
): Promise<{ closeMs: number; prices: Record<string, number> }> {
  const state = ensureEpoch();
  const unique = [...new Set(symbols.filter(Boolean))];
  const missing = unique.filter((s) => !state.prices.has(s) && !state.attempted.has(s));

  for (let i = 0; i < missing.length; i += MAX_BATCH) {
    if (signal?.aborted) break;
    const chunk = missing.slice(i, i + MAX_BATCH);
    for (const sym of chunk) state.attempted.add(sym);
    try {
      const response = await fetch(`/api/us-close?symbols=${encodeURIComponent(chunk.join(","))}`, {
        signal,
      });
      if (!response.ok) {
        // Allow retry on transient error.
        for (const sym of chunk) state.attempted.delete(sym);
        continue;
      }
      const body = wireObject(await response.json().catch(() => null));
      const payloadPrices = wireObject(body?.prices);
      const serverCloseMs = typeof body?.closeMs === "number" && Number.isFinite(body.closeMs) ? body.closeMs : state.closeMs;
      if (serverCloseMs !== state.closeMs) {
        state.closeMs = serverCloseMs;
        state.prices.clear();
        state.attempted.clear();
      }
      if (payloadPrices) {
        for (const [sym, raw] of Object.entries(payloadPrices)) {
          if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
            state.prices.set(sym, raw);
          }
        }
      }
    } catch {
      for (const sym of chunk) state.attempted.delete(sym);
    }
  }

  const out: Record<string, number> = {};
  for (const sym of unique) {
    const p = state.prices.get(sym);
    if (p !== undefined) out[sym] = p;
  }
  return { closeMs: state.closeMs, prices: out };
}

/**
 * Fetches and caches US-Close (16:00 ET) reference prices for the provided symbols.
 * Live ticks read from the returned immutable map with zero extra network calls.
 */
export function useUsCloseReference(symbols: readonly string[], enabled = true): {
  closeMs: number;
  prices: Record<string, number>;
  loading: boolean;
} {
  const key = enabled ? [...new Set(symbols.filter(Boolean))].sort().join(",") : "";
  const [state, setState] = useState<{ closeMs: number; prices: Record<string, number>; loading: boolean }>(() => ({
    closeMs: lastUsMarketCloseMs(),
    prices: {},
    loading: false,
  }));

  useEffect(() => {
    if (!enabled || !key) return;
    const list = key.split(",");
    const current = ensureEpoch();
    const initial: Record<string, number> = {};
    let needsFetch = false;
    for (const sym of list) {
      const hit = current.prices.get(sym);
      if (hit !== undefined) initial[sym] = hit;
      else if (!current.attempted.has(sym)) needsFetch = true;
    }
    setState({ closeMs: current.closeMs, prices: initial, loading: needsFetch });
    if (!needsFetch) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchUsCloseBatch(list, controller.signal).then((result) => {
        if (!controller.signal.aborted) {
          setState({ closeMs: result.closeMs, prices: result.prices, loading: false });
        }
      });
    }, 100);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, enabled]);

  return state;
}
