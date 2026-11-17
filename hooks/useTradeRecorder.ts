"use client";
import { useEffect } from "react";
import { marketService } from "@/lib/market/service";
import { TradeRecorder } from "@/lib/orderflow/tradeRecorder";
import { tradeArchiveDb } from "@/lib/orderflow/tradeArchive";
import { useTradeArchiveStore } from "@/stores/useTradeArchiveStore";
export function useTradeRecorder() {
  useEffect(() => {
    let mounted = true;
    const recorder = new TradeRecorder(tradeArchiveDb, status => {
      if (!mounted) return;
      useTradeArchiveStore.setState({ status, ...(status.error ? { enabled: false } : {}) });
    });
    const offTicks = marketService.onTick(tick => { recorder.accept(tick); });
    const offStore = useTradeArchiveStore.subscribe((state, previous) => {
      if (state.enabled === previous.enabled) return;
      if (state.enabled) recorder.start(); else void recorder.pause();
    });
    if (useTradeArchiveStore.getState().enabled) recorder.start();
    const flush = () => { void recorder.flush(); };
    document.addEventListener("visibilitychange", flush); window.addEventListener("pagehide", flush);
    return () => { mounted = false; offTicks(); offStore(); document.removeEventListener("visibilitychange", flush); window.removeEventListener("pagehide", flush); void recorder.pause(); };
  }, []);
}
