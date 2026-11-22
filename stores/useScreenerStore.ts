"use client";
import { accountScopedName } from "@/lib/accountScope";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ScreenerFilter, ScreenerPreset } from "@/lib/screener/technical";

interface ScreenerState {
  timeframe: string;
  limit: number;
  /** Which venue to screen: `binance`, `hyperliquid` (crypto perps) or `hyperliquid-markets` (equities, metals, indices) or `stocks:<exchange>`. */
  market: string;
  filters: ScreenerFilter[];
  columns: string[];
  presets: ScreenerPreset[];
  set: (patch: Partial<Omit<ScreenerState, "set" | "savePreset" | "removePreset">>) => void;
  savePreset: (name: string) => void;
  removePreset: (id: string) => void;
}

export const DEFAULT_SCREENER_COLUMNS = ["price", "change24h", "quoteVolume", "rsi", "adx", "rvol", "rating"];

export const useScreenerStore = create<ScreenerState>()(
  persist(
    (set) => ({
      timeframe: "1h",
      limit: 80,
      market: "binance",
      filters: [],
      columns: DEFAULT_SCREENER_COLUMNS,
      presets: [],
      set,
      savePreset: (name) =>
        set((s) => ({
          presets: [
            ...s.presets.filter((p) => p.name !== name).slice(-19),
            {
              id: crypto.randomUUID(),
              name: name.trim().slice(0, 40) || "Preset",
              timeframe: s.timeframe,
              filters: structuredClone(s.filters),
            },
          ],
        })),
      removePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
    }),
    {
      name: accountScopedName("affentrader-screener-v1"),
      partialize: (s) => ({
        timeframe: s.timeframe,
        limit: s.limit,
        market: s.market,
        filters: s.filters,
        columns: s.columns,
        presets: s.presets,
      }),
    },
  ),
);
