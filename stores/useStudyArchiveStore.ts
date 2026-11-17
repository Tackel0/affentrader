"use client";
import { create } from "zustand";
import type { TradeArchiveRead } from "@/types/tradeArchive";
import type { Tick } from "@/types/trading";
import { studyTradeSource, type LoadedStudyArchive } from "@/lib/orderflow/studyTradeSource";
interface StudyArchiveState { loaded: LoadedStudyArchive[]; load(snapshot: TradeArchiveRead, live: readonly Tick[]): void; remove(symbol: string): void }
/** Metadata only; selections are explicit and do not survive reload or workspace import. */
export const useStudyArchiveStore = create<StudyArchiveState>(set => ({ loaded: [],
  load(snapshot, live) { studyTradeSource.install(snapshot, live); set({ loaded: studyTradeSource.loaded() }); },
  remove(symbol) { studyTradeSource.clear(symbol); set({ loaded: studyTradeSource.loaded() }); },
}));
