"use client";
import { create } from "zustand";
import { validAlpacaCredentials, type AlpacaCredentials } from "@/lib/market/alpaca";
export type AlpacaStatus = "disconnected" | "connecting" | "authenticated" | "reconnecting" | "error";
// Credentials deliberately live outside Zustand state, persistence, workspace exports and window sync.
let credentials: AlpacaCredentials | null = null;
interface AlpacaState { epoch: number; enabled: boolean; open: boolean; status: AlpacaStatus; message: string; symbols: string[]; omitted: string[];
  connect(value: AlpacaCredentials): void; disconnect(): void; reconnect(): void;
}
export const useAlpacaStore = create<AlpacaState>((set, get) => ({
  epoch: 0, enabled: false, open: false, status: "disconnected", message: "", symbols: [], omitted: [],
  connect(value) {
    if (!validAlpacaCredentials(value)) throw new Error("Enter a valid Alpaca API key and secret.");
    credentials = { key: value.key, secret: value.secret };
    set({ enabled: true, epoch: get().epoch + 1, status: "connecting", message: "", symbols: [], omitted: [] });
  },
  disconnect() { credentials = null; set({ enabled: false, epoch: get().epoch + 1, status: "disconnected", message: "", symbols: [], omitted: [] }); },
  reconnect() { if (credentials) set({ epoch: get().epoch + 1, status: "connecting", message: "" }); },
}));
export function alpacaCredentials(): AlpacaCredentials {
  if (!credentials) throw new Error("Connect Alpaca in Market data connections. Credentials are required after every reload.");
  return { ...credentials };
}
