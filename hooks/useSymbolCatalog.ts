"use client";
import { useEffect, useState } from "react";
import { SYMBOLS, getSymbol } from "@/lib/symbols";
import type { MarketSymbol } from "@/types/trading";

let loaded: MarketSymbol[] | null = null;
let inflight: Promise<MarketSymbol[]> | null = null;

/** All tradable USDT pairs on the exchange, merged over the curated list. */
export function loadSymbolCatalog(): Promise<MarketSymbol[]> {
  if (loaded) return Promise.resolve(loaded);
  inflight ??= fetch("/api/market?resource=exchangeInfo")
    .then((r) => {
      if (!r.ok) throw new Error("Unavailable");
      return r.json();
    })
    .then((data: { symbols: { symbol: string; baseAsset: string; quoteAsset: string; status: string }[] }) => {
      const known = new Set(SYMBOLS.map((s) => s.symbol));
      const extra = data.symbols
        .filter((s) => s.quoteAsset === "USDT" && s.status === "TRADING" && !known.has(s.symbol))
        .map((s) => ({ ...getSymbol(s.symbol), base: s.baseAsset }));
      loaded = [...SYMBOLS, ...extra];
      return loaded;
    })
    .catch(() => SYMBOLS)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useSymbolCatalog(enabled = true): MarketSymbol[] {
  const [catalog, setCatalog] = useState<MarketSymbol[]>(loaded ?? SYMBOLS);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadSymbolCatalog().then((list) => {
      if (!cancelled) setCatalog(list);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return catalog;
}
