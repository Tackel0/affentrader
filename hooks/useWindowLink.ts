"use client";
import { useEffect } from "react";
import { useChartStore } from "@/stores/useChartStore";
import { useLinkStore } from "@/stores/useLinkStore";
import { useAlertStore } from "@/stores/useAlertStore";
import { usePaperStore } from "@/stores/usePaperStore";
import { usePortfolioStore } from "@/stores/usePortfolioStore";
import { useReportStore } from "@/stores/useReportStore";
import { useScreenerStore } from "@/stores/useScreenerStore";
import { useServerStore } from "@/stores/useServerStore";
import { useStrategyStore } from "@/stores/useStrategyStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { useSetupJournal } from "@/stores/useSetupJournal";
import { accountScopedName, readWorkspaceProfile, workspaceProfile } from "@/lib/accountScope";
import { parseLinkMessage, type WorkspaceLinkAction } from "@/lib/windowLink";
import { receiveLinkedCrosshair, subscribeLinkedCrosshair } from "@/lib/chart/crosshairLink";
import type { CrosshairPoint } from "@/types/trading";
import { buildMissingOrderflowIndicators } from "@/lib/orderflow/equityOrderflow";
import { popoutId, pruneWindows, touchWindow } from "@/lib/windowScope";

const CHANNEL = accountScopedName("affentrader-link");

/** Broadcast an explicit workspace action (e.g. switch to Footprint + open Orderflow/Trading tab) to linked windows. */
export function broadcastWorkspaceAction(action: WorkspaceLinkAction): void {
  if (typeof BroadcastChannel === "undefined") return;
  const group = useLinkStore.getState().group;
  if (group === "off") return;
  const from = popoutId() ?? "main";
  const channel = new BroadcastChannel(CHANNEL);
  try {
    channel.postMessage({ ...action, type: "workspace", from, group });
  } finally {
    channel.close();
  }
}

/** Stores shared by every window of the app; the chart and layout stores are per-window. */
const SHARED: Record<string, { persist: { rehydrate: () => Promise<void> | void } }> = {
  "affentrader-alerts-v1": useAlertStore,
  "affentrader-paper-v1": usePaperStore,
  "affentrader-portfolio-v1": usePortfolioStore,
  "affentrader-strategy-reports-v1": useReportStore,
  "affentrader-screener-v1": useScreenerStore,
  "affentrader-server-v1": useServerStore,
  "affentrader-strategy-v1": useStrategyStore,
  "affentrader-watchlists-v1": useWatchlistStore,
  "affentrader-setups-v1": useSetupJournal,
};

/**
 * Multi-window support: windows in the same colour group follow each other's
 * symbol, interval, workspace actions and crosshair over a BroadcastChannel,
 * and shared stores (watchlists, alerts, paper account…) sync across tabs.
 */
export function useWindowLink() {
  useEffect(() => {
    const reloadProfile = () => { if (workspaceProfile() !== readWorkspaceProfile()) window.location.reload(); };
    window.addEventListener("focus", reloadProfile);
    window.addEventListener("pageshow", reloadProfile);
    document.addEventListener("visibilitychange", reloadProfile);
    const disposeProfile = () => {
      window.removeEventListener("focus", reloadProfile);
      window.removeEventListener("pageshow", reloadProfile);
      document.removeEventListener("visibilitychange", reloadProfile);
    };
    const me = popoutId() ?? "main";
    if (me === "main") pruneWindows();
    else {
      touchWindow();
    }
    const heartbeat = me === "main" ? null : setInterval(touchWindow, 60_000);

    const onStorage = (event: StorageEvent) => {
      const entry = event.key ? Object.keys(SHARED).find(key => accountScopedName(key) === event.key) : undefined;
      const store = entry ? SHARED[entry] : undefined;
      if (store && event.newValue !== null) void store.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);

    if (typeof BroadcastChannel === "undefined")
      return () => {
        disposeProfile();
        window.removeEventListener("storage", onStorage);
        if (heartbeat) clearInterval(heartbeat);
      };

    const channel = new BroadcastChannel(CHANNEL);
    let applying = false;
    let frame: number | null = null;
    let pending: CrosshairPoint | null = null;
    const cancelCrosshair = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
    };
    const post = (message: Record<string, unknown>) => {
      const group = useLinkStore.getState().group;
      if (group !== "off") channel.postMessage({ ...message, from: me, group });
    };

    const offChart = useChartStore.subscribe((state, previous) => {
      if (applying || useLinkStore.getState().group === "off") return;
      if (state.symbol !== previous.symbol || state.timeframe !== previous.timeframe)
        post({ type: "state", symbol: state.symbol, timeframe: state.timeframe });
    });
    const offCrosshair = subscribeLinkedCrosshair((point, remote) => {
      const group = useLinkStore.getState().group;
      if (remote || group === "off") return;
      pending = point;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        const latest = pending;
        frame = null;
        pending = null;
        if (group === useLinkStore.getState().group) post({ type: "crosshair",
          point: latest ? { time: latest.time, price: latest.price, symbol: latest.symbol } : null });
      });
    });
    const offGroup = useLinkStore.subscribe((state, previous) => {
      if (state.group !== previous.group) cancelCrosshair();
    });

    channel.onmessage = (event) => {
      const message = parseLinkMessage(event.data);
      if (!message || message.from === me || message.group !== useLinkStore.getState().group) return;
      applying = true;
      try {
        const store = useChartStore.getState();
        if (message.type === "state") {
          if (store.symbol !== message.symbol || store.timeframe !== message.timeframe)
            store.set({ symbol: message.symbol, timeframe: message.timeframe });
        } else if (message.type === "workspace") {
          const extras = message.addIndicators?.length
            ? buildMissingOrderflowIndicators(store.indicators, message.addIndicators)
            : [];
          store.set({
            ...(message.symbol !== undefined ? { symbol: message.symbol } : {}),
            ...(message.timeframe !== undefined ? { timeframe: message.timeframe } : {}),
            ...(message.chartType !== undefined ? { chartType: message.chartType } : {}),
            ...(message.bottomOpen !== undefined ? { bottomOpen: message.bottomOpen } : {}),
            ...(message.bottomTab !== undefined ? { bottomTab: message.bottomTab } : {}),
            ...(extras.length ? { indicators: [...store.indicators, ...extras] } : {}),
          });
          if (message.toast) {
            store.toast(message.toast.title, message.toast.message, message.toast.tone ?? "info");
          }
        } else {
          receiveLinkedCrosshair(message.point ? { ...message.point, source: `ext:${message.from}` } : null);
        }
      } finally {
        applying = false;
      }
    };

    return () => {
      disposeProfile();
      offChart();
      offCrosshair();
      offGroup();
      channel.close();
      cancelCrosshair();
      window.removeEventListener("storage", onStorage);
      if (heartbeat) clearInterval(heartbeat);
    };
  }, []);
}
