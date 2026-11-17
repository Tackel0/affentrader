"use client";
import type { HyperliquidAsset } from "@/lib/market/hyperliquid";
import { loadHyperliquidAssets } from "@/lib/market/hyperliquidClient";

const TTL_MS = 30_000;
let cached: { at: number; assets: HyperliquidAsset[] } | null = null;
let inflight: Promise<HyperliquidAsset[]> | null = null;

/** Every Hyperliquid perpetual, shared by the search dialog and the watchlist. */
export function hyperliquidCatalog(): Promise<HyperliquidAsset[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.assets);
  inflight ??= loadHyperliquidAssets()
    .then((assets) => {
      cached = { at: Date.now(), assets };
      return assets;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
