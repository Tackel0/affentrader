"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RemoteInfo {
  revision: number;
  updatedAt: number;
  device: string;
}

interface SyncState {
  /** Secret that names this sync space; shared by typing it on another device. */
  key: string;
  /** Revision this browser last pushed or pulled. */
  revision: number;
  /** Fingerprint of the workspace at that moment, to tell local edits apart. */
  syncedFingerprint: string;
  device: string;
  auto: boolean;
  /** Set right after a pull: the next start adopts the restored workspace as the synced baseline. */
  adopt: boolean;
  lastSyncedAt: number;
  status: "off" | "idle" | "syncing" | "conflict" | "offline" | "error";
  remote: RemoteInfo | null;
  error: string;
  set: (patch: Partial<Omit<SyncState, "set">>) => void;
}

export function defaultDevice(): string {
  if (typeof navigator === "undefined") return "browser";
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      key: "",
      revision: 0,
      syncedFingerprint: "",
      device: "",
      auto: true,
      adopt: false,
      lastSyncedAt: 0,
      status: "off",
      remote: null,
      error: "",
      set,
    }),
    {
      name: "affentrader-sync-v1",
      partialize: (s) => ({
        key: s.key,
        revision: s.revision,
        syncedFingerprint: s.syncedFingerprint,
        device: s.device,
        auto: s.auto,
        adopt: s.adopt,
        lastSyncedAt: s.lastSyncedAt,
      }),
    },
  ),
);

export function newSyncKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
