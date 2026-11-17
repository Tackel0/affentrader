"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Lot, Portfolio } from "@/lib/portfolio";

interface PortfolioState {
  portfolios: Portfolio[];
  activeId: string;
  create: (name: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  select: (id: string) => void;
  addLot: (lot: Omit<Lot, "id">) => void;
  addLots: (lots: Lot[]) => void;
  removeLot: (id: string) => void;
}

const MAX_PORTFOLIOS = 25;
const MAX_LOTS = 5000;

export const usePortfolioStore = create<PortfolioState>()(
  persist(
    (set) => ({
      portfolios: [{ id: "main", name: "My portfolio", lots: [] }],
      activeId: "main",
      create: (name) =>
        set((s) => {
          if (s.portfolios.length >= MAX_PORTFOLIOS) return s;
          const id = crypto.randomUUID();
          return {
            portfolios: [...s.portfolios, { id, name: name.trim().slice(0, 40) || "Portfolio", lots: [] }],
            activeId: id,
          };
        }),
      rename: (id, name) =>
        set((s) => ({
          portfolios: s.portfolios.map((p) =>
            p.id === id ? { ...p, name: name.trim().slice(0, 40) || p.name } : p,
          ),
        })),
      remove: (id) =>
        set((s) => {
          if (s.portfolios.length < 2) return s;
          const portfolios = s.portfolios.filter((p) => p.id !== id);
          return { portfolios, activeId: s.activeId === id ? portfolios[0].id : s.activeId };
        }),
      select: (id) => set((s) => (s.portfolios.some((p) => p.id === id) ? { activeId: id } : s)),
      addLot: (lot) =>
        set((s) => ({
          portfolios: s.portfolios.map((p) =>
            p.id === s.activeId && p.lots.length < MAX_LOTS
              ? { ...p, lots: [...p.lots, { ...lot, id: crypto.randomUUID() }] }
              : p,
          ),
        })),
      addLots: (lots) =>
        set((s) => ({
          portfolios: s.portfolios.map((p) =>
            p.id === s.activeId ? { ...p, lots: [...p.lots, ...lots].slice(0, MAX_LOTS) } : p,
          ),
        })),
      removeLot: (id) =>
        set((s) => ({
          portfolios: s.portfolios.map((p) =>
            p.id === s.activeId ? { ...p, lots: p.lots.filter((l) => l.id !== id) } : p,
          ),
        })),
    }),
    { name: "affentrader-portfolio-v1" },
  ),
);
