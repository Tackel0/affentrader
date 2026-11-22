"use client";
import { accountScopedName } from "@/lib/accountScope";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mergeSetupHistory, mergeSetupRecords, type SetupRecord } from "@/lib/screener/setupJournal";
import type { TradeOpportunity } from "@/lib/screener/opportunities";

interface SetupJournal {
  records: readonly SetupRecord[];
  chartId: string | null;
  record: (items: readonly TradeOpportunity[], at: number) => void;
  importHistory: (items: readonly SetupRecord[]) => void;
  track: (id: string, tracked: boolean) => void;
  show: (id: string | null) => void;
}

export const useSetupJournal = create<SetupJournal>()(persist((set, get) => ({
  records: [],
  chartId: null,
  record(items, at) {
    const previous = get().records;
    const records = mergeSetupRecords(previous, items, at);
    if (records !== previous) set({ records });
  },
  importHistory(items) {
    const previous = get().records;
    const records = mergeSetupHistory(previous, items);
    if (previous !== records) set({ records });
  },
  track(id, tracked) {
    set(state => ({ records: state.records.map(item => item.id === id ? { ...item, tracked } : item) }));
  },
  show(chartId) { set({ chartId }); },
}), { name: accountScopedName("affentrader-setups-v1"), partialize: state => ({ records: state.records }) }));
