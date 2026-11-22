"use client";
import { accountScopedName } from "@/lib/accountScope";
import { create } from "zustand";

export const LINK_GROUPS = ["off", "red", "green", "blue", "yellow"] as const;
export type LinkGroup = (typeof LINK_GROUPS)[number];

const SESSION_KEY = accountScopedName("affentrader-link-group");

export function isLinkGroup(value: unknown): value is LinkGroup {
  return typeof value === "string" && (LINK_GROUPS as readonly string[]).includes(value);
}

function initialGroup(): LinkGroup {
  if (typeof window === "undefined") return "off";
  const fromUrl = new URLSearchParams(window.location.search).get("link");
  if (isLinkGroup(fromUrl)) return fromUrl;
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (isLinkGroup(stored)) return stored;
  } catch {
    /* session storage unavailable */
  }
  return "off";
}

interface LinkState {
  /** Windows in the same colour group share symbol, interval and crosshair. */
  group: LinkGroup;
  setGroup: (group: LinkGroup) => void;
}

/** Per-window and deliberately not persisted across browser sessions. */
export const useLinkStore = create<LinkState>()((set) => ({
  group: initialGroup(),
  setGroup: (group) => {
    try {
      sessionStorage.setItem(SESSION_KEY, group);
    } catch {
      /* session storage unavailable */
    }
    set({ group });
  },
}));
