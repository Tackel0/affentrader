"use client";
import { accountScopedName } from "@/lib/accountScope";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { RecorderStatus } from "@/lib/orderflow/tradeRecorder";
interface TradeArchiveState { enabled: boolean; open: boolean; status: RecorderStatus; setEnabled(enabled: boolean): void }
export const useTradeArchiveStore = create<TradeArchiveState>()(persist(set => ({ enabled: false, open: false,
  status: { recording: false, writing: false, pending: 0, committed: 0, retained: null, evicted: 0, error: "", lastCommit: null },
  setEnabled(enabled) { set({ enabled }); },
}), { name: accountScopedName("affentrader-trade-recording-v1"), storage: createJSONStorage(() => localStorage), partialize: state => ({ enabled: state.enabled }),
  merge: (saved, current) => ({ ...current, enabled: (saved as { enabled?: unknown } | undefined)?.enabled === true }),
}));
