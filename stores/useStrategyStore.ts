"use client";
import { accountScopedName } from "@/lib/accountScope";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IPineInput } from "pinets";
import type { StrategyDocument, StrategyReport } from "@/types/strategy";
import { STRATEGY_EXAMPLES } from "@/lib/strategy/scripts";
import { DEFAULT_STRATEGY_SETTINGS } from "@/lib/strategy/settings";

interface StrategyState {
  document: StrategyDocument;
  inputSchema: IPineInput[];
  report: StrategyReport | null;
  status: "idle" | "loading" | "running" | "complete" | "error";
  progress: string;
  error: string | null;
  /** Draw the finished backtest's trades on the chart. */
  showOnChart: boolean;
  focusTrade: string | null;
  set: (patch: Partial<Omit<StrategyState, "set" | "edit">>) => void;
  edit: (patch: Partial<StrategyDocument>) => void;
}
export const useStrategyStore = create<StrategyState>()(
  persist(
    (set) => ({
      document: {
        name: "EMA crossover",
        source: STRATEGY_EXAMPLES["EMA crossover"],
        inputs: {},
        settings: DEFAULT_STRATEGY_SETTINGS,
      },
      inputSchema: [],
      report: null,
      status: "idle",
      progress: "",
      error: null,
      showOnChart: true,
      focusTrade: null,
      set,
      edit: (patch) => set((s) => ({ document: { ...s.document, ...patch } })),
    }),
    {
      name: accountScopedName("affentrader-strategy-v1"),
      partialize: (s) => ({ document: s.document, showOnChart: s.showOnChart }),
    },
  ),
);
