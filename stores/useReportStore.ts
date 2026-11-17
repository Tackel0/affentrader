"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MAX_SAVED_REPORTS, type SavedReport } from "@/lib/strategy/analysis";

interface ReportState {
  saved: SavedReport[];
  /** Ids ticked for the side-by-side comparison. */
  selected: string[];
  save: (report: SavedReport) => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  toggle: (id: string) => void;
}

export const MAX_COMPARED = 4;

export const useReportStore = create<ReportState>()(
  persist(
    (set) => ({
      saved: [],
      selected: [],
      save: (report) =>
        set((s) => ({
          saved: [...s.saved, report].slice(-MAX_SAVED_REPORTS),
          selected: [...s.selected, report.id].slice(-MAX_COMPARED),
        })),
      remove: (id) =>
        set((s) => ({
          saved: s.saved.filter((r) => r.id !== id),
          selected: s.selected.filter((x) => x !== id),
        })),
      rename: (id, name) =>
        set((s) => ({
          saved: s.saved.map((r) => (r.id === id ? { ...r, name: name.trim().slice(0, 60) || r.name } : r)),
        })),
      toggle: (id) =>
        set((s) => ({
          selected: s.selected.includes(id)
            ? s.selected.filter((x) => x !== id)
            : [...s.selected, id].slice(-MAX_COMPARED),
        })),
    }),
    { name: "affentrader-strategy-reports-v1" },
  ),
);
