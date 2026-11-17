"use client";
import { useCallback, useEffect, useState } from "react";
import {
  canInstall,
  disablePush,
  enablePush,
  onInstallAvailable,
  promptInstall,
  pushState,
  registerServiceWorker,
  sendTestPush,
  type PushState,
} from "@/lib/pwa";
import { useServerStore } from "@/stores/useServerStore";
import { useChartStore } from "@/stores/useChartStore";

let started = false;

/** Registers the service worker once and exposes install / push controls. */
export function usePwa() {
  const [installable, setInstallable] = useState(false);
  const [push, setPush] = useState<PushState>("unsupported");
  const [busy, setBusy] = useState(false);
  const key = useServerStore((s) => s.key);
  useEffect(() => {
    if (!started) {
      started = true;
      void registerServiceWorker();
      navigator.serviceWorker?.addEventListener("message", (event) => {
        if (event.data?.type === "open-symbol" && typeof event.data.symbol === "string")
          useChartStore.getState().set({ symbol: event.data.symbol });
      });
    }
    setInstallable(canInstall());
    const off = onInstallAvailable(() => setInstallable(canInstall()));
    void pushState().then(setPush);
    return off;
  }, []);
  const togglePush = useCallback(async () => {
    const toast = useChartStore.getState().toast;
    if (!key) {
      toast("Connect the alert server first", "Add the server access key in an alert's server settings.", "error");
      return;
    }
    setBusy(true);
    try {
      if (push === "on") {
        await disablePush(key);
        toast("Background notifications off", "This browser will no longer receive pushes.", "info");
      } else {
        await enablePush(key);
        const { sent } = await sendTestPush(key);
        toast("Background notifications on", sent ? "A test notification was sent." : "Registered.", "success");
      }
    } catch (error) {
      toast("Notifications unavailable", error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
      setPush(await pushState());
    }
  }, [key, push]);
  return {
    installable,
    install: async () => {
      if (await promptInstall()) useChartStore.getState().toast("Installed", "Affentrader can now open like an app.", "success");
    },
    push,
    togglePush,
    busy,
  };
}
