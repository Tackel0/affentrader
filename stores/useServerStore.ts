"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ServerLink = "unconfigured" | "connecting" | "connected" | "unauthorized" | "offline";

export interface RunnerHealth {
  running: boolean;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastErrors: string[];
  intervalMs: number;
  runs: number;
}

interface ServerState {
  /** Access key from the server's `.data/access-key.txt`. Never exported in backups. */
  key: string;
  link: ServerLink;
  health: RunnerHealth | null;
  /** Highest server event number already surfaced in this browser. */
  cursor: number;
  setKey: (key: string) => void;
  set: (patch: Partial<Omit<ServerState, "set" | "setKey">>) => void;
}

export const useServerStore = create<ServerState>()(
  persist(
    (set) => ({
      key: "",
      link: "unconfigured",
      health: null,
      cursor: 0,
      setKey: (key) =>
        set({ key: key.trim(), link: key.trim() ? "connecting" : "unconfigured" }),
      set,
    }),
    {
      name: "affentrader-server-v1",
      partialize: (s) => ({ key: s.key, cursor: s.cursor }),
    },
  ),
);
