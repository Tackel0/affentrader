"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Watchlist, WatchFlag } from "@/types/trading";
import {
  DEFAULT_COLUMNS,
  isSection,
  makeSection,
  MAX_LISTS,
  MAX_LIST_SYMBOLS,
  parseWatchlistText,
  type SortSpec,
  type WatchColumn,
} from "@/lib/watchlist";
interface WatchlistState {
  lists: Watchlist[];
  activeId: string;
  columns: WatchColumn[];
  sort: SortSpec | null;
  create: (name: string) => string;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  select: (id: string) => void;
  duplicate: (id: string) => void;
  clear: (id: string) => void;
  addSymbol: (symbol: string) => void;
  /** Add many symbols to the active list; returns how many were new. */
  addSymbols: (symbols: string[], listId?: string) => number;
  addSection: (name: string) => void;
  removeSymbol: (symbol: string) => void;
  moveSymbols: (symbols: string[], toListId: string, copy?: boolean) => void;
  reorder: (from: string, to: string) => void;
  setFlag: (symbol: string, flag: WatchFlag | null) => void;
  setColumns: (columns: WatchColumn[]) => void;
  setSort: (sort: SortSpec | null) => void;
  /** Import pasted text or CSV; returns counts for the confirmation message. */
  importText: (
    text: string,
    options: { mode: "append" | "replace" | "new"; name?: string },
  ) => { added: number; rejected: string[]; truncated: boolean };
}
const unique = (entries: string[]) => {
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (isSection(e)) return true;
    if (seen.has(e)) return false;
    seen.add(e);
    return true;
  });
};
const capped = (entries: string[]) => {
  const out: string[] = [];
  let symbols = 0;
  for (const entry of entries) {
    if (!isSection(entry)) {
      if (symbols >= MAX_LIST_SYMBOLS) continue;
      symbols++;
    }
    out.push(entry);
  }
  return out;
};
const countSymbols = (entries: readonly string[]) =>
  entries.filter((e) => !isSection(e)).length;
export const useWatchlistStore = create<WatchlistState>()(
  persist(
    (set, get) => ({
      lists: [
        {
          id: "crypto",
          name: "Crypto watchlist",
          symbols: [
            "BTCUSDT",
            "ETHUSDT",
            "SOLUSDT",
            "BNBUSDT",
            "XRPUSDT",
            "DOGEUSDT",
            "AVAXUSDT",
            "LINKUSDT",
          ],
        },
      ],
      activeId: "crypto",
      columns: DEFAULT_COLUMNS,
      sort: null,
      create: (name) => {
        const id = crypto.randomUUID();
        set((s) =>
          s.lists.length >= MAX_LISTS
            ? s
            : {
                lists: [
                  ...s.lists,
                  { id, name: name.trim() || "New watchlist", symbols: [] },
                ],
                activeId: id,
              },
        );
        return id;
      },
      rename: (id, name) =>
        set((s) => ({
          lists: s.lists.map((l) =>
            l.id === id ? { ...l, name: name.trim() || l.name } : l,
          ),
        })),
      remove: (id) =>
        set((s) => {
          if (s.lists.length === 1) return s;
          const lists = s.lists.filter((l) => l.id !== id);
          return {
            lists,
            activeId: s.activeId === id ? lists[0].id : s.activeId,
          };
        }),
      select: (id) =>
        set((s) => (s.lists.some((l) => l.id === id) ? { activeId: id } : {})),
      duplicate: (id) =>
        set((s) => {
          const source = s.lists.find((l) => l.id === id);
          if (!source || s.lists.length >= MAX_LISTS) return s;
          const copy = {
            ...structuredClone(source),
            id: crypto.randomUUID(),
            name: `${source.name} copy`.slice(0, 40),
          };
          return { lists: [...s.lists, copy], activeId: copy.id };
        }),
      clear: (id) =>
        set((s) => ({
          lists: s.lists.map((l) =>
            l.id === id ? { ...l, symbols: [], flags: {} } : l,
          ),
        })),
      addSymbol: (symbol) => {
        get().addSymbols([symbol]);
      },
      addSymbols: (symbols, listId) => {
        let added = 0;
        set((s) => ({
          lists: s.lists.map((l) => {
            if (l.id !== (listId ?? s.activeId)) return l;
            const have = new Set(l.symbols);
            const room = MAX_LIST_SYMBOLS - countSymbols(l.symbols);
            const fresh = [...new Set(symbols)]
              .filter((x) => !have.has(x))
              .slice(0, Math.max(0, room));
            added = fresh.length;
            return fresh.length ? { ...l, symbols: [...l.symbols, ...fresh] } : l;
          }),
        }));
        return added;
      },
      addSection: (name) =>
        set((s) => ({
          lists: s.lists.map((l) =>
            l.id === s.activeId ? { ...l, symbols: [...l.symbols, makeSection(name)] } : l,
          ),
        })),
      removeSymbol: (symbol) =>
        set((s) => ({
          lists: s.lists.map((l) => {
            if (l.id !== s.activeId) return l;
            const flags = { ...(l.flags ?? {}) };
            delete flags[symbol];
            return { ...l, symbols: l.symbols.filter((x) => x !== symbol), flags };
          }),
        })),
      moveSymbols: (symbols, toListId, copy = false) =>
        set((s) => {
          const moving = new Set(symbols);
          return {
            lists: s.lists.map((l) => {
              if (l.id === toListId) {
                const have = new Set(l.symbols);
                const incoming = symbols.filter((x) => !have.has(x));
                return { ...l, symbols: capped([...l.symbols, ...incoming]) };
              }
              if (!copy && l.id === s.activeId)
                return { ...l, symbols: l.symbols.filter((x) => !moving.has(x)) };
              return l;
            }),
          };
        }),
      reorder: (from, to) =>
        set((s) => ({
          lists: s.lists.map((l) => {
            if (l.id !== s.activeId) return l;
            const symbols = [...l.symbols];
            const a = symbols.indexOf(from),
              b = symbols.indexOf(to);
            if (a < 0 || b < 0) return l;
            symbols.splice(b, 0, ...symbols.splice(a, 1));
            return { ...l, symbols };
          }),
        })),
      setFlag: (symbol, flag) =>
        set((s) => ({
          lists: s.lists.map((l) => {
            if (l.id !== s.activeId) return l;
            const flags = { ...(l.flags ?? {}) };
            if (flag) flags[symbol] = flag;
            else delete flags[symbol];
            return { ...l, flags };
          }),
        })),
      setColumns: (columns) => set({ columns }),
      setSort: (sort) => set({ sort }),
      importText: (text, options) => {
        const parsed = parseWatchlistText(text);
        const all = unique(parsed.entries);
        const entries = capped(all);
        const truncated = countSymbols(all) > countSymbols(entries);
        if (options.mode === "new") {
          const id = crypto.randomUUID();
          set((s) =>
            s.lists.length >= MAX_LISTS
              ? s
              : {
                  lists: [
                    ...s.lists,
                    { id, name: (options.name ?? "Imported list").trim().slice(0, 40) || "Imported list", symbols: entries },
                  ],
                  activeId: id,
                },
          );
        } else
          set((s) => ({
            lists: s.lists.map((l) => {
              if (l.id !== s.activeId) return l;
              if (options.mode === "replace") return { ...l, symbols: entries, flags: {} };
              const have = new Set(l.symbols);
              return {
                ...l,
                symbols: capped([...l.symbols, ...entries.filter((e) => isSection(e) || !have.has(e))]),
              };
            }),
          }));
        return { added: countSymbols(entries), rejected: parsed.rejected, truncated };
      },
    }),
    { name: "affentrader-watchlists-v1" },
  ),
);
